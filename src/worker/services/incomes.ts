import { z } from "zod";
import { DATE_RE, monthOf, MONTH_RE } from "../../shared/month";
import type { Income } from "../../shared/types";
import { type Ctx, nn, updateRow, UserError } from "../lib";

export const IncomeInput = z.object({
  description: z.string().trim().min(1),
  amount_cents: z.number().int().positive(),
  date: z.string().regex(DATE_RE).optional(),
  /** Mês em que a entrada conta (padrão: mês da data). */
  month: z.string().regex(MONTH_RE).optional(),
  notes: z.string().nullable().optional(),
});
export const IncomePatch = IncomeInput.partial();

const COLS = "id, description, amount_cents, date, month, notes";

export async function listIncomes(ctx: Ctx, month?: string): Promise<Income[]> {
  const stmt = month
    ? ctx.db.prepare(`SELECT ${COLS} FROM incomes WHERE user_id = ? AND month = ? ORDER BY date DESC, id DESC`).bind(ctx.userId, month)
    : ctx.db.prepare(`SELECT ${COLS} FROM incomes WHERE user_id = ? ORDER BY date DESC, id DESC LIMIT 500`).bind(ctx.userId);
  return (await stmt.all<Income>()).results;
}

export async function getIncome(ctx: Ctx, id: number): Promise<Income> {
  const row = await ctx.db.prepare(`SELECT ${COLS} FROM incomes WHERE id = ? AND user_id = ?`).bind(id, ctx.userId).first<Income>();
  if (!row) throw new UserError(`Entrada ${id} não encontrada`, 404);
  return row;
}

export async function createIncome(ctx: Ctx, input: z.input<typeof IncomeInput>): Promise<Income> {
  const i = IncomeInput.parse(input);
  const date = i.date ?? ctx.today;
  const row = await ctx.db
    .prepare(`INSERT INTO incomes (user_id, description, amount_cents, date, month, notes) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(ctx.userId, i.description, i.amount_cents, date, i.month ?? monthOf(date), nn(i.notes))
    .first<{ id: number }>();
  return getIncome(ctx, row!.id);
}

export async function updateIncome(ctx: Ctx, id: number, patch: z.input<typeof IncomePatch>): Promise<Income> {
  const p = IncomePatch.parse(patch);
  // Mudou a data sem informar o mês: o mês acompanha a data
  if (p.date !== undefined && p.month === undefined) p.month = monthOf(p.date);
  await updateRow(ctx, "incomes", id, p, ["description", "amount_cents", "date", "month", "notes"]);
  return getIncome(ctx, id);
}

export async function deleteIncome(ctx: Ctx, id: number): Promise<Income> {
  const cur = await getIncome(ctx, id);
  await ctx.db.prepare("DELETE FROM incomes WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
  return cur;
}
