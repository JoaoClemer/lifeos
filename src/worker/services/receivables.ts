import { z } from "zod";
import { addMonths, DATE_RE, MONTH_RE, referenceMonth } from "../../shared/month";
import { isDue } from "../../shared/receivables";
import type { Account, Receivable } from "../../shared/types";
import { type Ctx, findByName, mustGet, normalize, updateRow, UserError } from "../lib";

const ReceivableFields = z.object({
  person: z.string().trim().min(1),
  description: z.string().trim().min(1),
  /** Valor (de cada parcela, se parcelado). */
  amount_cents: z.number().int().positive(),
  date: z.string().regex(DATE_RE).optional(),
  /** Mês de referência (da 1ª parcela, se parcelado). */
  month: z.string().regex(MONTH_RE).optional(),
  /** Se passou no seu cartão, informe a conta: o valor entra na fatura dela. */
  account_id: z.number().int().nullable().optional(),
});

export const ReceivableInput = ReceivableFields.extend({
  amount_cents: z.number().int().positive().optional(),
  /** Alternativa a amount_cents para parcelados: valor total, dividido sem perder centavos. */
  total_cents: z.number().int().positive().optional(),
  /** Número de parcelas (devedor parcelado). Omitido ou 1 = à vista. */
  installments: z.number().int().min(1).max(120).optional(),
  /** Para parcelamento já em andamento: parcela que cai no mês `month` (padrão: mês atual). */
  current_installment: z.number().int().min(1).optional(),
}).refine((v) => v.amount_cents || v.total_cents, { message: "Informe o valor" });

export const ReceivablePatch = ReceivableFields.partial().extend({
  received_at: z.string().regex(DATE_RE).nullable().optional(),
});

const COLS = "id, person, description, amount_cents, date, month, account_id, expense_id, received_at, installment_group, installment_no, installment_total";

export { isDue };

export interface ReceivableFilter {
  status?: "pending" | "received" | "all";
  person?: string;
  month?: string;
}

export async function listReceivables(ctx: Ctx, f: ReceivableFilter = {}): Promise<Receivable[]> {
  const where: string[] = ["user_id = ?"];
  const args: (string | number)[] = [ctx.userId];
  const status = f.status ?? "pending";
  if (status === "pending") where.push("received_at IS NULL");
  if (status === "received") where.push("received_at IS NOT NULL");
  if (f.month) (where.push("month = ?"), args.push(f.month));
  let rows = (
    await ctx.db
      .prepare(`SELECT ${COLS} FROM receivables WHERE ${where.join(" AND ")} ORDER BY date DESC, id DESC LIMIT 1000`)
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
  const row = await ctx.db.prepare(`SELECT ${COLS} FROM receivables WHERE id = ? AND user_id = ?`).bind(id, ctx.userId).first<Receivable>();
  if (!row) throw new UserError(`Devedor ${id} não encontrado`, 404);
  return row;
}

/**
 * Registra um devedor. Com `installments` > 1, cria uma linha por parcela (uma por mês),
 * todas ligadas pelo mesmo installment_group. Retorna as linhas criadas (1 se à vista).
 */
export async function createReceivable(ctx: Ctx, input: z.input<typeof ReceivableInput>): Promise<Receivable[]> {
  const r = ReceivableInput.parse(input);
  const date = r.date ?? ctx.today;
  const account = r.account_id ? await mustGet<Account>(ctx, "accounts", r.account_id, "Conta") : null;
  const person = await canonicalPerson(ctx, r.person);
  const n = r.installments ?? 1;

  if (n === 1) {
    const row = await ctx.db
      .prepare(
        `INSERT INTO receivables (user_id, person, description, amount_cents, date, month, account_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(ctx.userId, person, r.description, r.amount_cents ?? r.total_cents!, date, r.month ?? referenceMonth(date, account), account?.id ?? null)
      .first<{ id: number }>();
    return [await getReceivable(ctx, row!.id)];
  }

  const current = r.current_installment ?? 1;
  if (current > n) throw new UserError("Parcela atual maior que o total de parcelas");
  const firstMonth = r.current_installment
    ? addMonths(r.month ?? ctx.month, -(current - 1))
    : (r.month ?? referenceMonth(date, account));
  // Valor de cada parcela; com valor total, os centavos que sobram vão nas primeiras parcelas
  const amountOf = (k: number) => {
    if (r.amount_cents) return r.amount_cents;
    const base = Math.floor(r.total_cents! / n);
    return base + (k <= r.total_cents! - base * n ? 1 : 0);
  };
  const group = crypto.randomUUID();
  const stmts: D1PreparedStatement[] = [];
  // Parcelamento em andamento: as parcelas anteriores à atual não são criadas (já ficaram para trás)
  for (let k = current; k <= n; k++) {
    stmts.push(
      ctx.db
        .prepare(
          `INSERT INTO receivables (user_id, person, description, amount_cents, date, month, account_id, installment_group, installment_no, installment_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(ctx.userId, person, r.description, amountOf(k), date, addMonths(firstMonth, k - 1), account?.id ?? null, group, k, n),
    );
  }
  await ctx.db.batch(stmts);
  return (
    await ctx.db
      .prepare(`SELECT ${COLS} FROM receivables WHERE installment_group = ? AND user_id = ? ORDER BY installment_no`)
      .bind(group, ctx.userId)
      .all<Receivable>()
  ).results;
}

export async function updateReceivable(ctx: Ctx, id: number, patch: z.input<typeof ReceivablePatch>): Promise<Receivable> {
  const p = ReceivablePatch.parse(patch);
  if (p.account_id) await mustGet(ctx, "accounts", p.account_id, "Conta");
  await updateRow(ctx, "receivables", id, p, ["person", "description", "amount_cents", "date", "month", "account_id", "received_at"]);
  return getReceivable(ctx, id);
}

export async function deleteReceivable(ctx: Ctx, id: number): Promise<Receivable> {
  const cur = await getReceivable(ctx, id);
  await ctx.db.prepare("DELETE FROM receivables WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
  return cur;
}

/** Exclui as parcelas ainda não recebidas do parcelamento ao qual a linha `id` pertence. */
export async function deleteReceivableGroup(ctx: Ctx, id: number): Promise<{ deleted: Receivable[] }> {
  const cur = await getReceivable(ctx, id);
  if (!cur.installment_group) return { deleted: [await deleteReceivable(ctx, id)] };
  const pending = (
    await ctx.db
      .prepare(`SELECT ${COLS} FROM receivables WHERE installment_group = ? AND user_id = ? AND received_at IS NULL ORDER BY installment_no`)
      .bind(cur.installment_group, ctx.userId)
      .all<Receivable>()
  ).results;
  await ctx.db
    .prepare("DELETE FROM receivables WHERE installment_group = ? AND user_id = ? AND received_at IS NULL")
    .bind(cur.installment_group, ctx.userId)
    .run();
  return { deleted: pending };
}

/**
 * Marca como recebido por ids ou todos os pendentes de uma pessoa.
 * Por pessoa, parcelas futuras de devedores parcelados ficam de fora, a menos que `include_future`.
 */
export async function markReceived(
  ctx: Ctx,
  opts: { ids?: number[]; person?: string; date?: string; undo?: boolean; include_future?: boolean },
): Promise<Receivable[]> {
  let targets: Receivable[];
  if (opts.ids?.length) {
    targets = await Promise.all(opts.ids.map((id) => getReceivable(ctx, id)));
  } else if (opts.person) {
    const person = await resolvePerson(ctx, opts.person);
    targets = await listReceivables(ctx, { status: opts.undo ? "received" : "pending", person });
    if (!opts.undo && !opts.include_future) targets = targets.filter((t) => isDue(t, ctx.month));
  } else throw new UserError("Informe ids ou pessoa");
  if (targets.length === 0) return [];
  const value = opts.undo ? null : (opts.date ?? ctx.today);
  await ctx.db.batch(
    targets.map((t) => ctx.db.prepare("UPDATE receivables SET received_at = ? WHERE id = ? AND user_id = ?").bind(value, t.id, ctx.userId)),
  );
  return targets.map((t) => ({ ...t, received_at: value }));
}

/** Pessoas que já apareceram, unindo variações de acento/maiúsculas ("jose" e "José") pela grafia mais usada. */
export async function listPeople(ctx: Ctx): Promise<string[]> {
  const rows = (
    await ctx.db
      .prepare("SELECT person, COUNT(*) n, MAX(date) d FROM receivables WHERE user_id = ? GROUP BY person ORDER BY d DESC, n DESC")
      .bind(ctx.userId)
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
