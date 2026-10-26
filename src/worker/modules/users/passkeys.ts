// Login com passkey (WebAuthn): entrar, criar a conta pelo convite, recuperar o acesso e cadastrar outro aparelho.
// Cada etapa tem um desafio de uso único guardado no banco (auth_challenges), válido por poucos minutos.
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import { todayIn } from "../../../shared/month";
import { deviceFromUserAgent, type InviteDetails } from "../../../shared/users";
import { base64url, fromBase64url, randomToken, sha256Hex } from "../../auth";
import { type Ctx, UserError } from "../../lib";
import { loadActiveUser, type SessionUser } from "./service";

/** Onde as passkeys valem: o domínio e a origem do próprio app. */
export interface RelyingParty {
  id: string;
  origin: string;
}

export function relyingParty(requestUrl: string): RelyingParty {
  const u = new URL(requestUrl);
  return { id: u.hostname, origin: u.origin };
}

const RP_NAME = "LifeOS";

interface Challenge {
  challenge: string;
  user_id: number | null;
  invite_id: number | null;
}

async function saveChallenge(db: D1Database, challenge: string, purpose: "login" | "register", userId: number | null, inviteId: number | null) {
  const id = randomToken(16);
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at < datetime('now')"),
    db
      .prepare(
        "INSERT INTO auth_challenges (id, challenge, purpose, user_id, invite_id, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now', '+5 minutes'))",
      )
      .bind(id, challenge, purpose, userId, inviteId),
  ]);
  return id;
}

/** Consome o desafio: depois disso ele não vale mais. */
async function takeChallenge(db: D1Database, id: string, purpose: "login" | "register"): Promise<Challenge> {
  const row = await db
    .prepare("DELETE FROM auth_challenges WHERE id = ? AND purpose = ? AND expires_at > datetime('now') RETURNING challenge, user_id, invite_id")
    .bind(id, purpose)
    .first<Challenge>();
  if (!row) throw new UserError("O tempo para confirmar acabou. Tente de novo.", 401);
  return row;
}

// ---------- entrar ----------

export async function loginOptions(db: D1Database, rp: RelyingParty): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  // Sem lista de credenciais: o aparelho mostra as passkeys salvas para este site (não precisa digitar nome)
  const options = await generateAuthenticationOptions({ rpID: rp.id, userVerification: "preferred" });
  return { challengeId: await saveChallenge(db, options.challenge, "login", null, null), options };
}

const ResponseJson = z.looseObject({ id: z.string().min(1) });
export const LoginVerifyInput = z.object({ challengeId: z.string().min(1), response: ResponseJson });

interface PasskeyRow {
  id: string;
  user_id: number;
  public_key: string;
  counter: number;
  transports: string | null;
}

/** Confere a assinatura da passkey e devolve a pessoa. */
export async function loginVerify(db: D1Database, rp: RelyingParty, input: unknown): Promise<SessionUser> {
  const { challengeId, response } = LoginVerifyInput.parse(input);
  const ch = await takeChallenge(db, challengeId, "login");
  const key = await db.prepare("SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id = ?").bind(response.id).first<PasskeyRow>();
  if (!key) throw new UserError("Passkey não reconhecida. Se você perdeu o acesso, peça um link de recuperação.", 401);
  let result: Awaited<ReturnType<typeof verifyAuthenticationResponse>> | null = null;
  try {
    result = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id: key.id, publicKey: fromBase64url(key.public_key), counter: key.counter, transports: JSON.parse(key.transports ?? "[]") },
      requireUserVerification: false,
    });
  } catch {
    result = null;
  }
  if (!result?.verified) throw new UserError("Não foi possível confirmar a passkey", 401);
  const user = await loadActiveUser(db, key.user_id);
  if (!user) throw new UserError("Esta conta está desativada", 403);
  await db.batch([
    db.prepare("UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE id = ?").bind(result.authenticationInfo.newCounter, key.id),
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id),
  ]);
  return user;
}

// ---------- convites e recuperação ----------

interface InviteRow {
  id: number;
  kind: "invite" | "recovery";
  name: string | null;
  user_id: number | null;
  created_by: number;
  expires_at: string;
}

async function findInvite(db: D1Database, token: string): Promise<InviteRow> {
  const row = token
    ? await db
        .prepare(
          `SELECT id, kind, name, user_id, created_by, expires_at FROM invites
           WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`,
        )
        .bind(await sha256Hex(token))
        .first<InviteRow>()
    : null;
  if (!row) throw new UserError("Este link não vale mais (já foi usado, foi cancelado ou expirou). Peça um novo.", 410);
  return row;
}

export const InviteTokenInput = z.object({ token: z.string().min(1).max(200) });

export async function inspectInvite(db: D1Database, input: unknown): Promise<InviteDetails> {
  const { token } = InviteTokenInput.parse(input);
  const inv = await findInvite(db, token);
  const by = await db.prepare("SELECT name FROM users WHERE id = ?").bind(inv.created_by).first<{ name: string | null }>();
  return { kind: inv.kind, name: inv.name, invited_by: by?.name ?? null, expires_at: inv.expires_at };
}

async function registrationOptions(
  db: D1Database,
  rp: RelyingParty,
  displayName: string,
  userId: number | null,
  inviteId: number | null,
): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
  const existing = userId
    ? (await db.prepare("SELECT id, transports FROM passkeys WHERE user_id = ?").bind(userId).all<{ id: string; transports: string | null }>()).results
    : [];
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: displayName,
    userDisplayName: displayName,
    // Mesmo identificador para a mesma pessoa: o aparelho troca a passkey antiga em vez de guardar duas
    userID: new Uint8Array(new TextEncoder().encode(userId ? `lifeos-user-${userId}` : `lifeos-new-${randomToken(12)}`)),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    excludeCredentials: existing.map((k) => ({ id: k.id, transports: JSON.parse(k.transports ?? "[]") })),
  });
  return { challengeId: await saveChallenge(db, options.challenge, "register", userId, inviteId), options };
}

interface NewCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports: string;
  backedUp: boolean;
}

async function verifyRegistration(rp: RelyingParty, ch: Challenge, response: z.output<typeof ResponseJson>): Promise<NewCredential> {
  let result: Awaited<ReturnType<typeof verifyRegistrationResponse>> | null = null;
  try {
    result = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
  } catch {
    result = null;
  }
  if (!result?.verified) throw new UserError("Não foi possível cadastrar a passkey", 400);
  const c = result.registrationInfo.credential;
  return {
    id: c.id,
    publicKey: base64url(c.publicKey),
    counter: c.counter,
    transports: JSON.stringify(c.transports ?? []),
    backedUp: result.registrationInfo.credentialBackedUp,
  };
}

const passkeyInsert = (db: D1Database, cred: NewCredential, device: string | null, userIdSql: string, ...userIdArgs: unknown[]) =>
  db
    .prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, transports, device, backed_up) VALUES (?, ${userIdSql}, ?, ?, ?, ?, ?)`)
    .bind(cred.id, ...userIdArgs, cred.publicKey, cred.counter, cred.transports, device, cred.backedUp ? 1 : 0);

export const InviteOptionsInput = InviteTokenInput.extend({ name: z.string().trim().min(1).max(60).optional() });

/** Começa o cadastro da passkey pelo link (convite: conta nova; recuperação: nova passkey de quem já tem conta). */
export async function inviteOptions(db: D1Database, rp: RelyingParty, input: unknown) {
  const { token, name } = InviteOptionsInput.parse(input);
  const inv = await findInvite(db, token);
  if (inv.kind === "recovery") {
    const user = await db.prepare("SELECT name FROM users WHERE id = ?").bind(inv.user_id).first<{ name: string | null }>();
    return registrationOptions(db, rp, user?.name ?? "LifeOS", inv.user_id, inv.id);
  }
  const displayName = name ?? inv.name;
  if (!displayName) throw new UserError("Informe seu nome");
  return registrationOptions(db, rp, displayName, null, inv.id);
}

export const InviteVerifyInput = InviteOptionsInput.extend({ challengeId: z.string().min(1), response: ResponseJson });

/** Termina o cadastro: cria a conta (convite) ou a nova passkey (recuperação) e devolve a pessoa, que já entra. */
export async function inviteVerify(db: D1Database, rp: RelyingParty, input: unknown, userAgent: string | null, defaultTimezone: string): Promise<SessionUser> {
  const { token, name, challengeId, response } = InviteVerifyInput.parse(input);
  const ch = await takeChallenge(db, challengeId, "register");
  const inv = await findInvite(db, token);
  if (ch.invite_id !== inv.id) throw new UserError("Este cadastro não é deste link. Abra o link de novo.", 400);
  const cred = await verifyRegistration(rp, ch, response);
  // O link vale uma vez só: marca como usado antes de criar qualquer coisa
  const claimed = await db
    .prepare("UPDATE invites SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')")
    .bind(inv.id)
    .run();
  if (!claimed.meta.changes) throw new UserError("Este link acabou de ser usado. Peça um novo.", 410);
  const device = deviceFromUserAgent(userAgent);

  if (inv.kind === "recovery") {
    await passkeyInsert(db, cred, device, "?", inv.user_id).run();
  } else {
    const displayName = name ?? inv.name;
    if (!displayName) throw new UserError("Informe seu nome");
    // Conta nova: pessoa, passkey e o início do saldo acumulado (o mês em que ela entra), tudo junto
    await db.batch([
      db.prepare("INSERT INTO users (name, role, invited_by) VALUES (?, 'member', ?)").bind(displayName, inv.created_by),
      passkeyInsert(db, cred, device, "last_insert_rowid()"),
      db
        .prepare("INSERT INTO user_settings (user_id, key, value) VALUES ((SELECT user_id FROM passkeys WHERE id = ?), 'balance_start_month', ?)")
        .bind(cred.id, todayIn(defaultTimezone).slice(0, 7)),
      db.prepare("UPDATE invites SET user_id = (SELECT user_id FROM passkeys WHERE id = ?) WHERE id = ?").bind(cred.id, inv.id),
      // Quem convidou e quem entrou já ficam conectados
      db
        .prepare("INSERT OR IGNORE INTO connections (user_a, user_b) SELECT MIN(user_id, ?1), MAX(user_id, ?1) FROM passkeys WHERE id = ?2")
        .bind(inv.created_by, cred.id),
    ]);
  }
  const owner = await db.prepare("SELECT user_id FROM passkeys WHERE id = ?").bind(cred.id).first<{ user_id: number }>();
  const user = owner && (await loadActiveUser(db, owner.user_id));
  if (!user) throw new UserError("Esta conta está desativada", 403);
  await db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run();
  return user;
}

// ---------- outro aparelho (já logado) ----------

export async function addPasskeyOptions(ctx: Ctx, rp: RelyingParty) {
  const me = await ctx.db.prepare("SELECT name FROM users WHERE id = ?").bind(ctx.userId).first<{ name: string | null }>();
  return registrationOptions(ctx.db, rp, me?.name ?? "LifeOS", ctx.userId, null);
}

export const AddPasskeyVerifyInput = z.object({ challengeId: z.string().min(1), response: ResponseJson });

export async function addPasskeyVerify(ctx: Ctx, rp: RelyingParty, input: unknown, userAgent: string | null): Promise<void> {
  const { challengeId, response } = AddPasskeyVerifyInput.parse(input);
  const ch = await takeChallenge(ctx.db, challengeId, "register");
  if (ch.user_id !== ctx.userId || ch.invite_id !== null) throw new UserError("Este cadastro não é seu. Tente de novo.", 400);
  const cred = await verifyRegistration(rp, ch, response);
  await passkeyInsert(ctx.db, cred, deviceFromUserAgent(userAgent), "?", ctx.userId).run();
}
