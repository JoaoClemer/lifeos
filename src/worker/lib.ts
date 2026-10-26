import type { Context } from "hono";
import { nowIn } from "../shared/datetime";
import type { Role } from "../shared/users";
import { monthOf } from "../shared/month";

/** Erro "esperado" (validação, não encontrado...). Vira 400 na API e isError no MCP. */
export class UserError extends Error {
  constructor(
    message: string,
    public status: 400 | 401 | 403 | 404 | 409 | 410 = 400,
  ) {
    super(message);
  }
}

/**
 * Pessoa dona dos dados acessados com a senha do app (APP_PASSWORD), o MCP_TOKEN e os códigos de devedor.
 * Até a fase 2 (login por pessoa), esses acessos são todos do dono atual.
 */
export const OWNER_USER_ID = 1;

/** Variáveis do Hono: quem está usando. Vem só da autenticação, nunca do corpo ou da URL da requisição. */
export type AppEnv = { Bindings: Env; Variables: { userId: number; role: Role; timezone: string | null } };

export interface Ctx {
  db: D1Database;
  /** Dono dos dados: toda consulta filtra e todo INSERT grava este user_id. */
  userId: number;
  today: string;
  month: string;
  /** Fuso IANA do app (ex.: America/Sao_Paulo). */
  timezone: string;
  /** Data e hora local agora ('YYYY-MM-DDTHH:MM'). */
  now: string;
  /** Quem fez a ação: o app (API) ou o Claude (MCP). Vai para o histórico. */
  source: "app" | "mcp";
}

/** `timezone`: fuso da pessoa (null = o padrão do app, TIMEZONE). */
export function makeCtx(env: Env, userId: number, source: Ctx["source"] = "app", timezone?: string | null): Ctx {
  // Sem dono identificado não há consulta: falha fechado
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("Pessoa não identificada");
  timezone ||= env.TIMEZONE || "America/Sao_Paulo";
  const now = nowIn(timezone);
  const today = now.slice(0, 10);
  return { db: env.DB, userId, today, month: monthOf(today), timezone, now, source };
}

/** Ctx de uma requisição autenticada da API. */
export const ctxOf = (c: Context<AppEnv>): Ctx => makeCtx(c.env, c.get("userId"), "app", c.get("timezone"));

/** Só o admin (quem administra o LifeOS e convida as pessoas). */
export function requireAdmin(c: Context<AppEnv>): void {
  if (c.get("role") !== "admin") throw new UserError("Só quem administra o LifeOS pode fazer isso", 403);
}

/** Id numérico vindo da URL. */
export function idParam(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UserError("id inválido");
  return n;
}

/** Limite de itens vindo da URL (?limit=): inteiro positivo; vazio = padrão do service. */
export function limitParam(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new UserError("limit inválido (use um número inteiro positivo)");
  return n;
}

/** D1 não aceita `undefined` em bind. */
export function nn<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

/** UPDATE apenas das colunas presentes em `patch` (e permitidas), só em linha da pessoa. */
export async function updateRow(
  ctx: Ctx,
  table: string,
  id: number,
  patch: Record<string, unknown>,
  allowed: readonly string[],
): Promise<void> {
  const keys = allowed.filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND user_id = ?`;
  const values = keys.map((k) => {
    const v = patch[k];
    return typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null);
  });
  const res = await ctx.db.prepare(sql).bind(...values, id, ctx.userId).run();
  if (!res.meta.changes) throw new UserError(`Registro ${id} não encontrado`, 404);
}

/** Linha da pessoa pelo id (sem a coluna user_id). De outra pessoa ou inexistente: 404. */
export async function mustGet<T>(ctx: Ctx, table: string, id: number, label: string): Promise<T> {
  const row = await ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, ctx.userId).first<T & { user_id: number }>();
  if (!row) throw new UserError(`${label} ${id} não encontrado(a)`, 404);
  const { user_id: _owner, ...rest } = row;
  return rest as T;
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Encontra um item pelo nome de forma tolerante (sem acento/maiúsculas):
 * exato > começa com > contém > todas as palavras presentes.
 */
export function findByName<T>(items: T[], query: string, getNames: (item: T) => string[], label: string): T {
  const q = normalize(query);
  const words = q.split(" ");
  const tiers: ((name: string) => boolean)[] = [
    (n) => n === q,
    (n) => n.startsWith(q),
    (n) => n.includes(q),
    (n) => words.every((w) => n.includes(w)),
  ];
  for (const test of tiers) {
    const hits = items.filter((it) => getNames(it).some((n) => test(normalize(n))));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      throw new UserError(
        `"${query}" é ambíguo. ${label} possíveis: ${hits.map((h) => getNames(h)[0]).join(", ")}`,
      );
    }
  }
  const options = items.map((it) => getNames(it)[0]).join(", ") || "(nenhum cadastrado)";
  throw new UserError(`${label} "${query}" não encontrado(a). Opções: ${options}`, 404);
}
