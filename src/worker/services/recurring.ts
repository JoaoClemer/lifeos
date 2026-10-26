import { z } from "zod";
import { MONTH_RE } from "../../shared/month";
import type { Recurring } from "../../shared/types";
import { type Ctx, findByName, mustGet, nn, updateRow, UserError } from "../lib";

export const RecurringInput = z.object({
  description: z.string().trim().min(1),
  amount_cents: z.number().int().nonnegative(),
  account_id: z.number().int().nullable().optional(),
  is_budget: z.boolean().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  start_month: z.string().regex(MONTH_RE).optional(),
  end_month: z.string().regex(MONTH_RE).nullable().optional(),
});
export const RecurringPatch = RecurringInput.partial();

export const RecurringMonthInput = z.object({
  /** null remove o ajuste e volta ao valor padrão */
  amount_cents: z.number().int().nonnegative().nullable().optional(),
  paid: z.boolean().optional(),
});

const SELECT = `SELECT r.id, r.description, r.amount_cents, r.account_id, r.is_budget, r.day, r.start_month, r.end_month,
  COALESCE(rm.amount_cents, r.amount_cents) AS month_amount_cents,
  rm.amount_cents IS NOT NULL AS overridden,
  COALESCE(rm.paid, 0) AS paid,
  CASE WHEN r.is_budget = 1 THEN COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.budget_id = r.id AND e.month = ?1 AND e.user_id = r.user_id), 0) ELSE 0 END AS spent_cents
  FROM recurring r LEFT JOIN recurring_months rm ON rm.recurring_id = r.id AND rm.month = ?1 AND rm.user_id = r.user_id`;
// ?1 = mês, ?2 = dono, ?3 = id

type Row = Omit<Recurring, "overridden" | "paid"> & { overridden: number; paid: number };
const decorate = (r: Row): Recurring => ({ ...r, overridden: !!r.overridden, paid: !!r.paid });

/** Fixos ativos no mês (ou todos, com `all`), com o valor efetivo daquele mês. */
export async function listRecurring(ctx: Ctx, month: string, all = false): Promise<Recurring[]> {
  const active = all ? "" : "AND r.start_month <= ?1 AND (r.end_month IS NULL OR r.end_month >= ?1)";
  const sql = `${SELECT} WHERE r.user_id = ?2 ${active} ORDER BY r.is_budget, r.description COLLATE NOCASE`;
  return (await ctx.db.prepare(sql).bind(month, ctx.userId).all<Row>()).results.map(decorate);
}

export async function getRecurring(ctx: Ctx, id: number, month = ctx.month): Promise<Recurring> {
  const row = await ctx.db.prepare(`${SELECT} WHERE r.user_id = ?2 AND r.id = ?3`).bind(month, ctx.userId, id).first<Row>();
  if (!row) throw new UserError(`Fixo ${id} não encontrado`, 404);
  return decorate(row);
}

export async function createRecurring(ctx: Ctx, input: z.input<typeof RecurringInput>): Promise<Recurring> {
  const r = RecurringInput.parse(input);
  if (r.account_id) await mustGet(ctx, "accounts", r.account_id, "Conta");
  const row = await ctx.db
    .prepare(
      `INSERT INTO recurring (user_id, description, amount_cents, account_id, is_budget, day, start_month, end_month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(ctx.userId, r.description, r.amount_cents, nn(r.account_id), r.is_budget ? 1 : 0, nn(r.day), r.start_month ?? ctx.month, nn(r.end_month))
    .first<{ id: number }>();
  return getRecurring(ctx, row!.id, r.start_month ?? ctx.month);
}

export async function updateRecurring(ctx: Ctx, id: number, patch: z.input<typeof RecurringPatch>): Promise<Recurring> {
  const p = RecurringPatch.parse(patch);
  if (p.account_id) await mustGet(ctx, "accounts", p.account_id, "Conta");
  await updateRow(ctx, "recurring", id, p, ["description", "amount_cents", "account_id", "is_budget", "day", "start_month", "end_month"]);
  return getRecurring(ctx, id);
}

export async function deleteRecurring(ctx: Ctx, id: number): Promise<Recurring> {
  const cur = await getRecurring(ctx, id);
  await ctx.db.prepare("DELETE FROM recurring WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
  return cur;
}

/** Ajusta o valor de um fixo só em um mês (ex.: conta de luz) e/ou marca como pago. */
export async function setRecurringMonth(
  ctx: Ctx,
  id: number,
  month: string,
  input: z.input<typeof RecurringMonthInput>,
): Promise<Recurring> {
  const p = RecurringMonthInput.parse(input);
  await getRecurring(ctx, id, month);
  const existing = await ctx.db
    .prepare("SELECT amount_cents, paid FROM recurring_months WHERE recurring_id = ? AND month = ? AND user_id = ?")
    .bind(id, month, ctx.userId)
    .first<{ amount_cents: number | null; paid: number }>();
  const amount = p.amount_cents !== undefined ? p.amount_cents : (existing?.amount_cents ?? null);
  const paid = p.paid !== undefined ? (p.paid ? 1 : 0) : (existing?.paid ?? 0);
  if (amount === null && !paid) {
    await ctx.db.prepare("DELETE FROM recurring_months WHERE recurring_id = ? AND month = ? AND user_id = ?").bind(id, month, ctx.userId).run();
  } else {
    await ctx.db
      .prepare(
        `INSERT INTO recurring_months (user_id, recurring_id, month, amount_cents, paid) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (recurring_id, month) DO UPDATE SET amount_cents = excluded.amount_cents, paid = excluded.paid`,
      )
      .bind(ctx.userId, id, month, amount, paid)
      .run();
  }
  return getRecurring(ctx, id, month);
}

export async function resolveRecurring(ctx: Ctx, name: string, opts: { budgetOnly?: boolean; month?: string } = {}) {
  const items = (await listRecurring(ctx, opts.month ?? ctx.month)).filter((r) => !opts.budgetOnly || r.is_budget);
  return findByName(items, name, (r) => [r.description], opts.budgetOnly ? "Orçamento" : "Fixo");
}
