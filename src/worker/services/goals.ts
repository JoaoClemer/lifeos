import { z } from "zod";
import { addMonths, DATE_RE, monthDiff, monthOf, MONTH_RE } from "../../shared/month";
import type { Goal, GoalEntry } from "../../shared/types";
import { type Ctx, findByName, nn, updateRow, UserError } from "../lib";

export const GoalInput = z.object({
  name: z.string().trim().min(1),
  institution: z.string().trim().nullable().optional(),
  target_cents: z.number().int().positive().nullable().optional(),
  monthly_cents: z.number().int().positive().nullable().optional(),
  deadline: z.string().regex(MONTH_RE).nullable().optional(),
  start_month: z.string().regex(MONTH_RE).optional(),
  color: z.string().nullable().optional(),
  /** Quanto você já tem guardado/investido hoje. */
  initial_cents: z.number().int().nonnegative().optional(),
});
export const GoalPatch = GoalInput.omit({ initial_cents: true }).partial().extend({ archived: z.boolean().optional() });

export const GoalEntryInput = z.object({
  kind: z.enum(["contribution", "withdrawal", "adjustment"]),
  /** Para aporte/resgate: valor positivo. Para ajuste: variação com sinal. */
  amount_cents: z.number().int(),
  date: z.string().regex(DATE_RE).optional(),
  month: z.string().regex(MONTH_RE).optional(),
  note: z.string().nullable().optional(),
});

type Row = Omit<Goal, "month_planned_cents" | "eta_month" | "required_monthly_cents">;

const SELECT = `SELECT g.id, g.name, g.institution, g.target_cents, g.monthly_cents, g.deadline, g.start_month, g.color, g.archived,
  COALESCE((SELECT SUM(amount_cents) FROM goal_entries WHERE goal_id = g.id), 0) AS balance_cents,
  COALESCE((SELECT SUM(amount_cents) FROM goal_entries WHERE goal_id = g.id AND month = ?1 AND kind IN ('contribution', 'withdrawal')), 0) AS month_contrib_cents
  FROM goals g`;

function decorate(g: Row, month: string): Goal {
  const remaining = g.target_cents ? Math.max(g.target_cents - g.balance_cents, 0) : null;
  // Saldo no início do mês (desconsiderando os aportes deste mês) para saber se ainda havia aporte a fazer
  const remainingAtStart = remaining === null ? null : remaining + g.month_contrib_cents;
  const active = !g.archived && g.start_month <= month && (!g.deadline || g.deadline >= month);
  const month_planned_cents =
    active && g.monthly_cents && (remainingAtStart === null || remainingAtStart > 0)
      ? Math.min(g.monthly_cents, remainingAtStart ?? g.monthly_cents)
      : 0;
  let eta_month: string | null = null;
  if (remaining !== null && g.monthly_cents) {
    eta_month = remaining === 0 ? month : addMonths(month, Math.ceil(remaining / g.monthly_cents) - (g.month_contrib_cents >= g.monthly_cents ? 0 : 1));
  }
  let required_monthly_cents: number | null = null;
  if (remaining !== null && g.deadline) {
    const months = Math.max(monthDiff(month, g.deadline) + (g.month_contrib_cents > 0 ? 0 : 1), 1);
    required_monthly_cents = Math.ceil(remaining / months);
  }
  return { ...g, month_planned_cents, eta_month, required_monthly_cents };
}

export async function listGoals(ctx: Ctx, month: string, includeArchived = false): Promise<Goal[]> {
  const sql = `${SELECT} ${includeArchived ? "" : "WHERE g.archived = 0"} ORDER BY g.archived, g.id`;
  return (await ctx.db.prepare(sql).bind(month).all<Row>()).results.map((g) => decorate(g, month));
}

export async function getGoal(ctx: Ctx, id: number, month = ctx.month): Promise<Goal> {
  const row = await ctx.db.prepare(`${SELECT} WHERE g.id = ?2`).bind(month, id).first<Row>();
  if (!row) throw new UserError(`Meta ${id} não encontrada`, 404);
  return decorate(row, month);
}

export async function createGoal(ctx: Ctx, input: z.input<typeof GoalInput>): Promise<Goal> {
  const g = GoalInput.parse(input);
  const start = g.start_month ?? ctx.month;
  const row = await ctx.db
    .prepare(
      `INSERT INTO goals (name, institution, target_cents, monthly_cents, deadline, start_month, color) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(g.name, nn(g.institution), nn(g.target_cents), nn(g.monthly_cents), nn(g.deadline), start, nn(g.color))
    .first<{ id: number }>();
  if (g.initial_cents) {
    await ctx.db
      .prepare(`INSERT INTO goal_entries (goal_id, kind, amount_cents, month, date, note) VALUES (?, 'adjustment', ?, ?, ?, 'Saldo inicial')`)
      .bind(row!.id, g.initial_cents, ctx.month, ctx.today)
      .run();
  }
  return getGoal(ctx, row!.id);
}

export async function updateGoal(ctx: Ctx, id: number, patch: z.input<typeof GoalPatch>): Promise<Goal> {
  const p = GoalPatch.parse(patch);
  await updateRow(ctx.db, "goals", id, p, ["name", "institution", "target_cents", "monthly_cents", "deadline", "start_month", "color", "archived"]);
  return getGoal(ctx, id);
}

export async function deleteGoal(ctx: Ctx, id: number): Promise<Goal> {
  const cur = await getGoal(ctx, id);
  await ctx.db.prepare("DELETE FROM goals WHERE id = ?").bind(id).run();
  return cur;
}

export async function listGoalEntries(ctx: Ctx, goalId: number): Promise<GoalEntry[]> {
  return (
    await ctx.db
      .prepare("SELECT id, goal_id, kind, amount_cents, month, date, note FROM goal_entries WHERE goal_id = ? ORDER BY date DESC, id DESC")
      .bind(goalId)
      .all<GoalEntry>()
  ).results;
}

export async function addGoalEntry(ctx: Ctx, goalId: number, input: z.input<typeof GoalEntryInput>): Promise<GoalEntry> {
  const e = GoalEntryInput.parse(input);
  await getGoal(ctx, goalId);
  if (e.kind !== "adjustment" && e.amount_cents <= 0) throw new UserError("O valor deve ser positivo");
  const signed = e.kind === "withdrawal" ? -e.amount_cents : e.amount_cents;
  const date = e.date ?? ctx.today;
  const row = await ctx.db
    .prepare(
      `INSERT INTO goal_entries (goal_id, kind, amount_cents, month, date, note) VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, goal_id, kind, amount_cents, month, date, note`,
    )
    .bind(goalId, e.kind, signed, e.month ?? monthOf(date), date, nn(e.note))
    .first<GoalEntry>();
  return row!;
}

export async function deleteGoalEntry(ctx: Ctx, entryId: number): Promise<void> {
  const res = await ctx.db.prepare("DELETE FROM goal_entries WHERE id = ?").bind(entryId).run();
  if (!res.meta.changes) throw new UserError(`Movimentação ${entryId} não encontrada`, 404);
}

/** Atualiza o saldo atual (ex.: com rendimentos) lançando um ajuste pela diferença. */
export async function setGoalBalance(ctx: Ctx, goalId: number, balanceCents: number, note?: string): Promise<Goal> {
  const g = await getGoal(ctx, goalId);
  const diff = balanceCents - g.balance_cents;
  if (diff !== 0) await addGoalEntry(ctx, goalId, { kind: "adjustment", amount_cents: diff, note: note ?? "Atualização de saldo" });
  return getGoal(ctx, goalId);
}

/** "Dar check" no aporte do mês: lança o que falta do aporte planejado. */
export async function checkGoalMonth(ctx: Ctx, goalId: number, month: string, amountCents?: number): Promise<Goal> {
  const g = await getGoal(ctx, goalId, month);
  const amount = amountCents ?? g.month_planned_cents - g.month_contrib_cents;
  if (amount <= 0) throw new UserError(`O aporte de ${g.name} neste mês já foi feito`, 409);
  const date = month === ctx.month ? ctx.today : `${month}-01`;
  await addGoalEntry(ctx, goalId, { kind: "contribution", amount_cents: amount, month, date });
  return getGoal(ctx, goalId, month);
}

export async function resolveGoal(ctx: Ctx, name: string): Promise<Goal> {
  return findByName(await listGoals(ctx, ctx.month), name, (g) => [g.name, ...(g.institution ? [g.institution] : [])], "Meta");
}
