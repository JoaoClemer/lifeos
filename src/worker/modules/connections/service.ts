// Conexões entre pessoas: quem convidou e quem entrou já ficam conectados; outras pessoas se conectam por um link.
// Só pessoas conectadas podem ser ligadas a um nome dos seus devedores (e, nas próximas fases, convidadas para eventos,
// listas de tarefas e metas).
import { z } from "zod";
import type { Connection, PersonLink } from "../../../shared/connections";
import { personKey } from "../../../shared/receivables";
import type { CreatedLink } from "../../../shared/users";
import { randomToken, sha256Hex } from "../../auth";
import { type Ctx, findByName, UserError } from "../../lib";
import { canonicalPerson, spellingsOf } from "../../services/receivables";
import { INVITE_DAYS } from "../users/service";

export async function listConnections(ctx: Ctx): Promise<Connection[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT u.id AS user_id, u.name, c.created_at AS since FROM connections c
       JOIN users u ON u.id = CASE WHEN c.user_a = ?1 THEN c.user_b ELSE c.user_a END
       WHERE (c.user_a = ?1 OR c.user_b = ?1) AND u.disabled_at IS NULL
       ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(ctx.userId)
    .all<Connection>();
  return rows.results;
}

/** A pessoa precisa estar conectada a você (e ativa). */
export async function requireConnection(ctx: Ctx, otherId: number): Promise<Connection> {
  const c = (await listConnections(ctx)).find((x) => x.user_id === otherId);
  if (!c) throw new UserError("Essa pessoa não está conectada a você", 404);
  return c;
}

/** Pessoa conectada pelo nome (tolerante a acento e maiúsculas). */
export async function resolveConnection(ctx: Ctx, name: string): Promise<Connection> {
  return findByName(await listConnections(ctx), name, (c) => [c.name ?? `Pessoa ${c.user_id}`], "Pessoa conectada");
}

// ---------- link para conectar ----------

export async function createConnectionLink(ctx: Ctx, origin: string): Promise<CreatedLink> {
  const token = randomToken(32);
  const row = await ctx.db
    .prepare(`INSERT INTO connection_links (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', '+${INVITE_DAYS} days')) RETURNING expires_at`)
    .bind(await sha256Hex(token), ctx.userId)
    .first<{ expires_at: string }>();
  return { url: `${origin}/#/conectar/${token}`, expires_at: row!.expires_at };
}

export const LinkTokenInput = z.object({ token: z.string().min(1).max(200) });

async function findLink(ctx: Ctx, token: string) {
  const row = await ctx.db
    .prepare(
      `SELECT l.id, l.user_id, u.name FROM connection_links l JOIN users u ON u.id = l.user_id
       WHERE l.token_hash = ? AND l.used_at IS NULL AND l.expires_at > datetime('now') AND u.disabled_at IS NULL`,
    )
    .bind(await sha256Hex(token))
    .first<{ id: number; user_id: number; name: string | null }>();
  if (!row) throw new UserError("Este link de conexão não vale mais (já foi usado ou expirou). Peça um novo.", 410);
  if (row.user_id === ctx.userId) throw new UserError("Esse link é seu: mande para a pessoa que você quer conectar");
  return row;
}

/** Quem gerou o link (para confirmar antes de conectar). */
export async function inspectConnectionLink(ctx: Ctx, input: unknown): Promise<{ user_id: number; name: string | null }> {
  const { token } = LinkTokenInput.parse(input);
  const link = await findLink(ctx, token);
  return { user_id: link.user_id, name: link.name };
}

export async function acceptConnectionLink(ctx: Ctx, input: unknown): Promise<Connection> {
  const { token } = LinkTokenInput.parse(input);
  const link = await findLink(ctx, token);
  const claimed = await ctx.db.prepare("UPDATE connection_links SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL").bind(link.id).run();
  if (!claimed.meta.changes) throw new UserError("Este link acabou de ser usado. Peça um novo.", 410);
  await ctx.db
    .prepare("INSERT OR IGNORE INTO connections (user_a, user_b) VALUES (MIN(?1, ?2), MAX(?1, ?2))")
    .bind(ctx.userId, link.user_id)
    .run();
  return requireConnection(ctx, link.user_id);
}

/**
 * Desfaz a conexão. Os nomes ligados entre as duas pessoas são desligados: as dívidas continuam com quem tem a receber,
 * mas deixam de aparecer para quem deve.
 */
export async function removeConnection(ctx: Ctx, otherId: number): Promise<void> {
  await requireConnection(ctx, otherId);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM connections WHERE user_a = MIN(?1, ?2) AND user_b = MAX(?1, ?2)").bind(ctx.userId, otherId),
    ctx.db
      .prepare("DELETE FROM person_links WHERE (user_id = ?1 AND linked_user_id = ?2) OR (user_id = ?2 AND linked_user_id = ?1)")
      .bind(ctx.userId, otherId),
    ctx.db
      .prepare("UPDATE receivables SET debtor_user_id = NULL WHERE (user_id = ?1 AND debtor_user_id = ?2) OR (user_id = ?2 AND debtor_user_id = ?1)")
      .bind(ctx.userId, otherId),
  ]);
}

// ---------- nome dos devedores -> conta ----------

export async function listPersonLinks(ctx: Ctx): Promise<PersonLink[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT pl.person_key, pl.linked_user_id, u.name AS linked_name FROM person_links pl
       JOIN users u ON u.id = pl.linked_user_id WHERE pl.user_id = ? ORDER BY pl.person_key`,
    )
    .bind(ctx.userId)
    .all<PersonLink>();
  return rows.results;
}

export const PersonLinkInput = z.object({ person: z.string().trim().min(1), user_id: z.number().int() });

/**
 * Liga um nome dos seus devedores à conta de uma pessoa conectada: tudo o que esse nome te deve (inclusive o histórico)
 * passa a aparecer em "Devo" para ela, e os próximos lançamentos com esse nome também.
 */
export async function linkPerson(ctx: Ctx, input: z.input<typeof PersonLinkInput>): Promise<PersonLink> {
  const p = PersonLinkInput.parse(input);
  if (p.user_id === ctx.userId) throw new UserError("Não dá para ligar um devedor à sua própria conta");
  const other = await requireConnection(ctx, p.user_id);
  const key = personKey(await canonicalPerson(ctx, p.person));
  if (!key) throw new UserError("Nome inválido");
  const spellings = await spellingsOf(ctx, key);
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO person_links (user_id, person_key, linked_user_id) VALUES (?, ?, ?)
         ON CONFLICT (user_id, person_key) DO UPDATE SET linked_user_id = excluded.linked_user_id`,
      )
      .bind(ctx.userId, key, p.user_id),
    ...(spellings.length
      ? [
          ctx.db
            .prepare(`UPDATE receivables SET debtor_user_id = ? WHERE user_id = ? AND person IN (${spellings.map(() => "?").join(", ")})`)
            .bind(p.user_id, ctx.userId, ...spellings),
        ]
      : []),
  ]);
  return { person_key: key, linked_user_id: p.user_id, linked_name: other.name };
}

/** Desliga o nome da conta: as dívidas continuam suas, mas deixam de aparecer para a pessoa. */
export async function unlinkPerson(ctx: Ctx, person: string): Promise<void> {
  const key = personKey(person);
  const res = await ctx.db.prepare("DELETE FROM person_links WHERE user_id = ? AND person_key = ?").bind(ctx.userId, key).run();
  if (!res.meta.changes) throw new UserError(`"${person}" não está ligado a nenhuma conta`, 404);
  const spellings = await spellingsOf(ctx, key);
  if (spellings.length) {
    await ctx.db
      .prepare(`UPDATE receivables SET debtor_user_id = NULL WHERE user_id = ? AND person IN (${spellings.map(() => "?").join(", ")})`)
      .bind(ctx.userId, ...spellings)
      .run();
  }
}
