import { todayIn, monthOf } from "../shared/month";

/** Erro "esperado" (validação, não encontrado...). Vira 400 na API e isError no MCP. */
export class UserError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export interface Ctx {
  db: D1Database;
  today: string;
  month: string;
  /** Fuso IANA do app (ex.: America/Sao_Paulo). */
  timezone: string;
}

export function makeCtx(env: Env): Ctx {
  const timezone = env.TIMEZONE || "America/Sao_Paulo";
  const today = todayIn(timezone);
  return { db: env.DB, today, month: monthOf(today), timezone };
}

/** D1 não aceita `undefined` em bind. */
export function nn<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

/** UPDATE apenas das colunas presentes em `patch` (e permitidas). */
export async function updateRow(
  db: D1Database,
  table: string,
  id: number,
  patch: Record<string, unknown>,
  allowed: readonly string[],
): Promise<void> {
  const keys = allowed.filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  const values = keys.map((k) => {
    const v = patch[k];
    return typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null);
  });
  const res = await db.prepare(sql).bind(...values, id).run();
  if (!res.meta.changes) throw new UserError(`Registro ${id} não encontrado`, 404);
}

export async function mustGet<T>(db: D1Database, table: string, id: number, label: string): Promise<T> {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(id).first<T>();
  if (!row) throw new UserError(`${label} ${id} não encontrado(a)`, 404);
  return row;
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
