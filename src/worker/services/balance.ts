// Saldo acumulado entre meses: saldo final = saldo inicial + sobra do mês;
// o saldo inicial de um mês é o final do anterior, a menos que tenha sido ajustado manualmente.
import { z } from "zod";
import { addMonths, MONTH_RE } from "../../shared/month";
import type { MonthBalance } from "../../shared/types";
import { type Ctx, UserError } from "../lib";
import { decorateGoal, type GoalRow } from "./goals";

export const OpeningInput = z.object({
  opening_cents: z.number().int(),
  note: z.string().trim().nullable().optional(),
});

/** Tudo o que é preciso para calcular a sobra de qualquer mês, carregado de uma vez (poucas consultas). */
interface Bulk {
  installments: { installment_cents: number; first_month: string; last_month: string }[];
  recurring: { id: number; amount_cents: number; is_budget: number; start_month: string; end_month: string | null }[];
  overrides: Map<string, number>; // `${recurring_id}|${month}` -> valor ajustado no mês
  expenseSums: Map<string, number>; // `${month}|${budget_id ?? ""}` -> soma
  incomes: Map<string, number>; // month -> entradas extras
  goals: Omit<GoalRow, "month_contrib_cents">[];
  goalContrib: Map<string, number>; // `${goal_id}|${month}` -> aportes - resgates
  salary: number | null;
  startSetting: string | null;
  manual: Map<string, { opening_cents: number; note: string | null }>;
}

async function loadBulk(ctx: Ctx): Promise<Bulk> {
  // Todas filtram pelo dono (?1)
  const sql = [
    "SELECT installment_cents, first_month, last_month FROM installments WHERE user_id = ?1",
    "SELECT id, amount_cents, is_budget, start_month, end_month FROM recurring WHERE user_id = ?1",
    "SELECT recurring_id, month, amount_cents FROM recurring_months WHERE user_id = ?1 AND amount_cents IS NOT NULL",
    "SELECT month, budget_id, SUM(amount_cents) AS total FROM expenses WHERE user_id = ?1 GROUP BY month, budget_id",
    "SELECT month, SUM(amount_cents) AS total FROM incomes WHERE user_id = ?1 GROUP BY month",
    `SELECT g.id, g.name, g.institution, g.target_cents, g.monthly_cents, g.deadline, g.start_month, g.color, g.archived,
       COALESCE((SELECT SUM(amount_cents) FROM goal_entries WHERE goal_id = g.id AND user_id = g.user_id), 0) AS balance_cents
     FROM goals g WHERE g.user_id = ?1 AND g.archived = 0`,
    "SELECT goal_id, month, SUM(amount_cents) AS total FROM goal_entries WHERE user_id = ?1 AND kind IN ('contribution', 'withdrawal') GROUP BY goal_id, month",
    "SELECT key, value FROM user_settings WHERE user_id = ?1 AND key IN ('income_cents', 'balance_start_month')",
    "SELECT month, opening_cents, note FROM user_month_balances WHERE user_id = ?1",
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (await ctx.db.batch(sql.map((s) => ctx.db.prepare(s).bind(ctx.userId)))).map((x) => x.results as any[]);
  const settings = Object.fromEntries(r[7].map((s: { key: string; value: string | null }) => [s.key, s.value]));
  return {
    installments: r[0],
    recurring: r[1],
    overrides: new Map(r[2].map((o) => [`${o.recurring_id}|${o.month}`, o.amount_cents])),
    expenseSums: new Map(r[3].map((e) => [`${e.month}|${e.budget_id ?? ""}`, e.total])),
    incomes: new Map(r[4].map((i) => [i.month, i.total])),
    goals: r[5],
    goalContrib: new Map(r[6].map((c) => [`${c.goal_id}|${c.month}`, c.total])),
    salary: settings.income_cents != null && settings.income_cents !== "" ? Number(settings.income_cents) : null,
    startSetting: settings.balance_start_month || null,
    manual: new Map(r[8].map((m) => [m.month, { opening_cents: m.opening_cents, note: m.note }])),
  };
}

/**
 * Sobra do mês com as mesmas regras do resumo (getSummary):
 * renda (salário + entradas) - (parcelados + fixos, orçamentos pelo maior entre previsto e gasto + avulsos) - aportes.
 * Sem renda configurada, conta como 0.
 */
function leftoverOf(b: Bulk, m: string): number {
  let total = 0;
  for (const i of b.installments) if (i.first_month <= m && i.last_month >= m) total += i.installment_cents;
  for (const r of b.recurring) {
    if (r.start_month > m || (r.end_month !== null && r.end_month < m)) continue;
    const amount = b.overrides.get(`${r.id}|${m}`) ?? r.amount_cents;
    total += r.is_budget ? Math.max(amount, b.expenseSums.get(`${m}|${r.id}`) ?? 0) : amount;
  }
  total += b.expenseSums.get(`${m}|`) ?? 0; // avulsos fora de orçamento
  const extra = b.incomes.get(m) ?? 0;
  const income = (b.salary ?? 0) + extra;
  let planned = 0;
  let done = 0;
  for (const g of b.goals) {
    const contrib = b.goalContrib.get(`${g.id}|${m}`) ?? 0;
    planned += decorateGoal({ ...g, month_contrib_cents: contrib }, m).month_planned_cents;
    done += Math.max(contrib, 0);
  }
  return income - total - Math.max(planned, done);
}

/** Saldo inicial/final do mês. Null para meses anteriores ao início do saldo acumulado. */
export async function getMonthBalance(ctx: Ctx, month: string): Promise<MonthBalance | null> {
  const b = await loadBulk(ctx);
  // Começa no mês configurado ou no ajuste manual mais antigo, o que vier primeiro
  const candidates = [b.startSetting, ...b.manual.keys()].filter((x): x is string => !!x).sort();
  const start = candidates[0] ?? ctx.month;
  if (month < start) return null;

  let prevClosing = 0;
  for (let m = start, guard = 0; guard < 1200; m = addMonths(m, 1), guard++) {
    const automatic = m === start ? 0 : prevClosing;
    const manual = b.manual.get(m);
    const opening = manual ? manual.opening_cents : automatic;
    const leftover = leftoverOf(b, m);
    const closing = opening + leftover;
    if (m === month) {
      return {
        start_month: start,
        opening_cents: opening,
        opening_source: manual ? "manual" : m === start ? "start" : "carried",
        automatic_opening_cents: automatic,
        note: manual?.note ?? null,
        leftover_cents: leftover,
        closing_cents: closing,
      };
    }
    prevClosing = closing;
  }
  return null;
}

/** Ajusta manualmente o saldo inicial de um mês (os meses seguintes continuam a partir dele). */
export async function setOpeningBalance(ctx: Ctx, month: string, input: z.input<typeof OpeningInput>): Promise<MonthBalance | null> {
  if (!MONTH_RE.test(month)) throw new UserError("mês inválido (use YYYY-MM)");
  const o = OpeningInput.parse(input);
  await ctx.db
    .prepare(
      `INSERT INTO user_month_balances (user_id, month, opening_cents, note, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id, month) DO UPDATE SET opening_cents = excluded.opening_cents, note = excluded.note, updated_at = excluded.updated_at`,
    )
    .bind(ctx.userId, month, o.opening_cents, o.note ?? null)
    .run();
  return getMonthBalance(ctx, month);
}

/** Remove o ajuste manual: o saldo inicial volta a vir do mês anterior. */
export async function clearOpeningBalance(ctx: Ctx, month: string): Promise<MonthBalance | null> {
  await ctx.db.prepare("DELETE FROM user_month_balances WHERE user_id = ? AND month = ?").bind(ctx.userId, month).run();
  return getMonthBalance(ctx, month);
}
