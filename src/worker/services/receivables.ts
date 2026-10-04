import { z } from "zod";
import { DATE_RE, MONTH_RE, referenceMonth } from "../../shared/month";
import type { Account, Receivable } from "../../shared/types";
import { type Ctx, findByName, mustGet, normalize, updateRow, UserError } from "../lib";

export const ReceivableInput = z.object({
  person: z.string().trim().min(1),
  description: z.string().trim().min(1),
  amount_cents: z.number().int().positive(),
  date: z.string().regex(DATE_RE).optional(),
  month: z.string().regex(MONTH_RE).optional(),
  /** Se passou no seu cartão, informe a conta: o valor entra na fatura dela. */
  account_id: z.number().int().nullable().optional(),
});
export const ReceivablePatch = ReceivableInput.partial().extend({
  received_at: z.string().regex(DATE_RE).nullable().optional(),
});

const COLS = "id, person, description, amount_cents, date, month, account_id, expense_id, received_at";

export interface ReceivableFilter {
  status?: "pending" | "received" | "all";
  person?: string;
  month?: string;
}

export async function listReceivables(ctx: Ctx, f: ReceivableFilter = {}): Promise<Receivable[]> {
  const where: string[] = [];
  const args: string[] = [];
  const status = f.status ?? "pending";
  if (status === "pending") where.push("received_at IS NULL");
  if (status === "received") where.push("received_at IS NOT NULL");
  if (f.month) (where.push("month = ?"), args.push(f.month));
  let rows = (
    await ctx.db
      .prepare(`SELECT ${COLS} FROM receivables ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY date DESC, id DESC LIMIT 1000`)
      .bind(...args)
      .all<Receivable>()
  ).results;
  if (f.person) {
    const p = normalize(f.person);
    rows = rows.filter((r) => normalize(r.person) === p);
  }
  return rows;
}

export async function getReceivable(ctx: Ctx, id: number): Promise<Receivable> {
  const row = await ctx.db.prepare(`SELECT ${COLS} FROM receivables WHERE id = ?`).bind(id).first<Receivable>();
  if (!row) throw new UserError(`Devedor ${id} não encontrado`, 404);
  return row;
}

export async function createReceivable(ctx: Ctx, input: z.input<typeof ReceivableInput>): Promise<Receivable> {
  const r = ReceivableInput.parse(input);
  const date = r.date ?? ctx.today;
  const account = r.account_id ? await mustGet<Account>(ctx.db, "accounts", r.account_id, "Conta") : null;
  const person = await canonicalPerson(ctx, r.person);
  const row = await ctx.db
    .prepare(
      `INSERT INTO receivables (person, description, amount_cents, date, month, account_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(person, r.description, r.amount_cents, date, r.month ?? referenceMonth(date, account), account?.id ?? null)
    .first<{ id: number }>();
  return getReceivable(ctx, row!.id);
}

export async function updateReceivable(ctx: Ctx, id: number, patch: z.input<typeof ReceivablePatch>): Promise<Receivable> {
  const p = ReceivablePatch.parse(patch);
  await updateRow(ctx.db, "receivables", id, p, ["person", "description", "amount_cents", "date", "month", "account_id", "received_at"]);
  return getReceivable(ctx, id);
}

export async function deleteReceivable(ctx: Ctx, id: number): Promise<Receivable> {
  const cur = await getReceivable(ctx, id);
  await ctx.db.prepare("DELETE FROM receivables WHERE id = ?").bind(id).run();
  return cur;
}

/** Marca como recebido por ids ou todos os pendentes de uma pessoa. */
export async function markReceived(
  ctx: Ctx,
  opts: { ids?: number[]; person?: string; date?: string; undo?: boolean },
): Promise<Receivable[]> {
  let targets: Receivable[];
  if (opts.ids?.length) {
    targets = await Promise.all(opts.ids.map((id) => getReceivable(ctx, id)));
  } else if (opts.person) {
    const person = await resolvePerson(ctx, opts.person);
    targets = await listReceivables(ctx, { status: opts.undo ? "received" : "pending", person });
  } else throw new UserError("Informe ids ou pessoa");
  if (targets.length === 0) return [];
  const value = opts.undo ? null : (opts.date ?? ctx.today);
  await ctx.db.batch(targets.map((t) => ctx.db.prepare("UPDATE receivables SET received_at = ? WHERE id = ?").bind(value, t.id)));
  return targets.map((t) => ({ ...t, received_at: value }));
}

/** Pessoas que já apareceram, unindo variações de acento/maiúsculas ("jose" e "José") pela grafia mais usada. */
export async function listPeople(ctx: Ctx): Promise<string[]> {
  const rows = (
    await ctx.db
      .prepare("SELECT person, COUNT(*) n, MAX(date) d FROM receivables GROUP BY person ORDER BY d DESC, n DESC")
      .all<{ person: string; n: number }>()
  ).results;
  const best = new Map<string, { person: string; n: number }>();
  for (const r of rows) {
    const key = normalize(r.person);
    const cur = best.get(key);
    if (!cur) best.set(key, { person: r.person, n: r.n });
    else if (r.n > cur.n) best.set(key, { person: r.person, n: r.n + cur.n });
    else cur.n += r.n;
  }
  return [...best.values()].map((b) => b.person);
}

/** Reaproveita a grafia já usada para a pessoa ("jose" -> "José"); nomes novos ganham inicial maiúscula. */
export async function canonicalPerson(ctx: Ctx, person: string): Promise<string> {
  const p = normalize(person);
  const known = (await listPeople(ctx)).find((x) => normalize(x) === p);
  return known ?? person.trim().replace(/(^|\s)(\p{Ll})/gu, (_m, sp: string, ch: string) => sp + ch.toUpperCase());
}

export async function resolvePerson(ctx: Ctx, name: string): Promise<string> {
  return findByName(await listPeople(ctx), name, (p) => [p], "Pessoa");
}
