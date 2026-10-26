// Pessoas: perfil, passkeys cadastradas, conectores do Claude, convites, recuperação de acesso e exclusão da conta.
// O login com passkey (WebAuthn) fica em passkeys.ts.
import { z } from "zod";
import type { AdminUser, CreatedLink, McpTokenInfo, Me, PasskeyInfo, PendingInvite, Role } from "../../../shared/users";
import { randomToken, sha256Hex } from "../../auth";
import { type Ctx, nn, UserError } from "../../lib";
import { OWNED_TABLES } from "../../owned";

/** Validade dos links de convite e de recuperação. */
export const INVITE_DAYS = 7;

export interface SessionUser {
  id: number;
  role: Role;
  timezone: string | null;
  session_version: number;
}

/** Pessoa ativa (não desativada) pelo id, com o que a sessão precisa conferir. */
export async function loadActiveUser(db: D1Database, id: number): Promise<SessionUser | null> {
  return db.prepare("SELECT id, role, timezone, session_version FROM users WHERE id = ? AND disabled_at IS NULL").bind(id).first<SessionUser>();
}

// ---------- perfil ----------

const timezoneField = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "fuso inválido (ex.: America/Sao_Paulo)");

export const MePatch = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  timezone: timezoneField.nullable().optional(),
});

export async function getMe(ctx: Ctx): Promise<Me> {
  const me = await ctx.db.prepare("SELECT id, name, role, timezone, created_at FROM users WHERE id = ?").bind(ctx.userId).first<Me>();
  if (!me) throw new UserError("Conta não encontrada", 404);
  return me;
}

export async function updateMe(ctx: Ctx, patch: z.input<typeof MePatch>): Promise<Me> {
  const p = MePatch.parse(patch);
  const sets = Object.entries(p).filter(([, v]) => v !== undefined);
  if (sets.length) {
    await ctx.db
      .prepare(`UPDATE users SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .bind(...sets.map(([, v]) => nn(v)), ctx.userId)
      .run();
  }
  return getMe(ctx);
}

/** Derruba todas as sessões da pessoa (todos os aparelhos). */
export async function logoutEverywhere(ctx: Ctx): Promise<void> {
  await ctx.db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").bind(ctx.userId).run();
}

// ---------- passkeys ----------

export async function listPasskeys(ctx: Ctx): Promise<PasskeyInfo[]> {
  const rows = await ctx.db
    .prepare("SELECT id, device, backed_up, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
    .bind(ctx.userId)
    .all<Omit<PasskeyInfo, "backed_up"> & { backed_up: number }>();
  return rows.results.map((r) => ({ ...r, backed_up: !!r.backed_up }));
}

/** Remove uma passkey. A última não sai (a pessoa ficaria sem como entrar). */
export async function deletePasskey(ctx: Ctx, id: string): Promise<void> {
  const keys = await listPasskeys(ctx);
  if (!keys.some((k) => k.id === id)) throw new UserError("Passkey não encontrada", 404);
  if (keys.length === 1) throw new UserError("Essa é sua única passkey: cadastre outra antes de remover esta");
  await ctx.db.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
}

// ---------- conectores do Claude ----------

export const McpTokenInput = z.object({ name: z.string().trim().min(1).max(60).default("Claude") });

export async function listMcpTokens(ctx: Ctx): Promise<McpTokenInfo[]> {
  const rows = await ctx.db
    .prepare("SELECT id, name, created_at, last_used_at FROM mcp_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY id")
    .bind(ctx.userId)
    .all<McpTokenInfo>();
  return rows.results;
}

/** Cria um conector. O link (com o token) só aparece agora; no banco fica só o hash. */
export async function createMcpToken(ctx: Ctx, input: z.input<typeof McpTokenInput>, origin: string): Promise<McpTokenInfo & { url: string }> {
  const { name } = McpTokenInput.parse(input);
  const token = randomToken(32);
  const row = await ctx.db
    .prepare("INSERT INTO mcp_tokens (user_id, token_hash, name) VALUES (?, ?, ?) RETURNING id, name, created_at, last_used_at")
    .bind(ctx.userId, await sha256Hex(token), name)
    .first<McpTokenInfo>();
  return { ...row!, url: `${origin}/mcp/${token}` };
}

export async function revokeMcpToken(ctx: Ctx, id: number): Promise<void> {
  const res = await ctx.db
    .prepare("UPDATE mcp_tokens SET revoked_at = datetime('now') WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .bind(id, ctx.userId)
    .run();
  if (!res.meta.changes) throw new UserError("Conector não encontrado", 404);
}

/** Dono de um token do MCP (ativo, de pessoa ativa). Registra o uso no máximo uma vez por hora. */
export async function userOfMcpToken(db: D1Database, token: string): Promise<SessionUser | null> {
  if (token.length < 16) return null;
  const hash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT t.id AS token_id, u.id, u.role, u.timezone, u.session_version FROM mcp_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled_at IS NULL`,
    )
    .bind(hash)
    .first<SessionUser & { token_id: number }>();
  if (!row) return null;
  await db
    .prepare("UPDATE mcp_tokens SET last_used_at = datetime('now') WHERE id = ? AND (last_used_at IS NULL OR last_used_at < datetime('now', '-1 hour'))")
    .bind(row.token_id)
    .run();
  const { token_id: _, ...user } = row;
  return user;
}

// ---------- convites e recuperação (admin) ----------

export const InviteInput = z.object({ name: z.string().trim().min(1).max(60) });

async function createLink(ctx: Ctx, kind: "invite" | "recovery", name: string | null, userId: number | null, origin: string): Promise<CreatedLink> {
  const token = randomToken(32);
  const row = await ctx.db
    .prepare(
      `INSERT INTO invites (token_hash, kind, name, user_id, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, datetime('now', '+${INVITE_DAYS} days')) RETURNING expires_at`,
    )
    .bind(await sha256Hex(token), kind, name, userId, ctx.userId)
    .first<{ expires_at: string }>();
  // O token vai no fragmento (#): não chega a servidores nem a logs ao abrir o link
  return { url: `${origin}/#/convite/${token}`, expires_at: row!.expires_at };
}

/** Convite para uma pessoa nova criar a conta dela. */
export async function createInvite(ctx: Ctx, input: z.input<typeof InviteInput>, origin: string): Promise<CreatedLink> {
  const { name } = InviteInput.parse(input);
  return createLink(ctx, "invite", name, null, origin);
}

/** Link para quem perdeu o acesso cadastrar uma passkey nova. */
export async function createRecovery(ctx: Ctx, userId: number, origin: string): Promise<CreatedLink> {
  const user = await ctx.db.prepare("SELECT id, name FROM users WHERE id = ?").bind(userId).first<{ id: number; name: string | null }>();
  if (!user) throw new UserError(`Pessoa ${userId} não encontrada`, 404);
  return createLink(ctx, "recovery", user.name, user.id, origin);
}

export async function listPendingInvites(ctx: Ctx): Promise<PendingInvite[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT id, kind, name, user_id, expires_at, created_at FROM invites
       WHERE used_at IS NULL AND expires_at > datetime('now') ORDER BY id DESC`,
    )
    .all<PendingInvite>();
  return rows.results;
}

/** Cancela um convite ou link de recuperação ainda não usado. */
export async function cancelInvite(ctx: Ctx, id: number): Promise<void> {
  const res = await ctx.db.prepare("UPDATE invites SET expires_at = datetime('now', '-1 second') WHERE id = ? AND used_at IS NULL").bind(id).run();
  if (!res.meta.changes) throw new UserError("Convite não encontrado", 404);
}

export async function listUsers(ctx: Ctx): Promise<AdminUser[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT u.id, u.name, u.role, u.created_at, u.last_login_at, u.disabled_at, i.name AS invited_by_name,
         (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys
       FROM users u LEFT JOIN users i ON i.id = u.invited_by ORDER BY u.id`,
    )
    .all<AdminUser>();
  return rows.results;
}

/** Desativa (ou reativa) uma pessoa. Desativar derruba as sessões dela; os dados ficam. */
export async function setUserDisabled(ctx: Ctx, userId: number, disabled: boolean): Promise<void> {
  if (userId === ctx.userId) throw new UserError("Você não pode desativar a própria conta");
  const res = await ctx.db
    .prepare(
      disabled
        ? "UPDATE users SET disabled_at = datetime('now'), session_version = session_version + 1 WHERE id = ? AND disabled_at IS NULL"
        : "UPDATE users SET disabled_at = NULL WHERE id = ? AND disabled_at IS NOT NULL",
    )
    .bind(userId)
    .run();
  if (!res.meta.changes) throw new UserError(`Pessoa ${userId} não encontrada ou já ${disabled ? "desativada" : "ativa"}`, 404);
}

// ---------- exclusão da conta ----------

export const DeleteAccountInput = z.object({ confirm: z.literal("EXCLUIR", { error: 'Para confirmar, envie confirm: "EXCLUIR"' }) });

/** Apaga a conta e todos os dados da pessoa. Quem administra o LifeOS não pode se excluir. */
export async function deleteMyAccount(ctx: Ctx, input: unknown): Promise<void> {
  DeleteAccountInput.parse(input);
  const me = await getMe(ctx);
  if (me.role === "admin") throw new UserError("Quem administra o LifeOS não pode excluir a própria conta");
  await ctx.db.batch([
    ...OWNED_TABLES.map((t) => ctx.db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(ctx.userId)),
    // passkeys, conectores e convites saem junto (ON DELETE CASCADE)
    ctx.db.prepare("DELETE FROM users WHERE id = ?").bind(ctx.userId),
  ]);
}
