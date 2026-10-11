import { z } from "zod";
import type { AccountTotal, AccountType, Settings, Summary } from "../../shared/types";
import { type Ctx, normalize } from "../lib";
import { listAccounts } from "./accounts";
import { listExpenses } from "./expenses";
import { listGoals } from "./goals";
import { listInstallments } from "./installments";
import { getMonthBalance } from "./balance";
import { listIncomes } from "./incomes";
import { isDue, listPeople, listReceivables } from "./receivables";
import { listRecurring } from "./recurring";

export const SettingsPatch = z.object({
  income_cents: z.number().int().nonnegative().nullable().optional(),
  default_account_id: z.number().int().nullable().optional(),
});

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const rows = (await ctx.db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string | null }>()).results;
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const num = (k: string) => (map[k] != null && map[k] !== "" ? Number(map[k]) : null);
  return { income_cents: num("income_cents"), default_account_id: num("default_account_id") };
}

export async function updateSettings(ctx: Ctx, patch: z.input<typeof SettingsPatch>): Promise<Settings> {
  const p = SettingsPatch.parse(patch);
  const stmts = Object.entries(p)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) =>
      ctx.db
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
        .bind(k, v === null ? null : String(v)),
    );
  if (stmts.length) await ctx.db.batch(stmts);
  return getSettings(ctx);
}

/**
 * Visão consolidada do mês:
 * - total = parcelados + fixos (orçamentos contam pelo maior entre previsto e gasto) + avulsos fora de orçamento
 * - por conta = o que efetivamente cai em cada cartão/conta (inclui a parte dos devedores passada no cartão)
 */
export async function getSummary(ctx: Ctx, month: string): Promise<Summary> {
  const [accounts, installments, recurring, expenses, receivablesMonth, allPending, goals, settings, peopleNames, incomes, balance] = await Promise.all([
    listAccounts(ctx, true),
    listInstallments(ctx, month),
    listRecurring(ctx, month),
    listExpenses(ctx, { month, limit: 2000 }),
    listReceivables(ctx, { status: "all", month }),
    listReceivables(ctx, { status: "pending" }),
    listGoals(ctx, month),
    getSettings(ctx),
    listPeople(ctx),
    listIncomes(ctx, month),
    getMonthBalance(ctx, month),
  ]);

  // Parcelas de devedores parcelados só contam como pendentes a partir do mês delas
  const refMonth = month > ctx.month ? month : ctx.month;
  const pending = allPending.filter((r) => isDue(r, refMonth));
  const future = allPending.filter((r) => !isDue(r, refMonth));

  const byAccount = new Map<number | null, number>();
  const add = (id: number | null, cents: number) => byAccount.set(id, (byAccount.get(id) ?? 0) + cents);

  let installmentsTotal = 0;
  for (const i of installments) {
    installmentsTotal += i.installment_cents;
    add(i.account_id, i.installment_cents);
  }

  let recurringTotal = 0;
  let overflow = 0;
  const budgets = [];
  for (const r of recurring) {
    if (r.is_budget) {
      recurringTotal += Math.max(r.month_amount_cents, r.spent_cents);
      overflow += Math.max(r.spent_cents - r.month_amount_cents, 0);
      budgets.push({
        id: r.id,
        description: r.description,
        limit_cents: r.month_amount_cents,
        spent_cents: r.spent_cents,
        remaining_cents: r.month_amount_cents - r.spent_cents,
      });
    } else {
      recurringTotal += r.month_amount_cents;
      add(r.account_id, r.month_amount_cents);
    }
  }

  let oneOff = 0;
  for (const e of expenses) {
    if (!e.budget_id) oneOff += e.amount_cents;
    add(e.account_id, e.amount_cents); // gastos de orçamento também caem na conta usada
  }
  for (const r of receivablesMonth) if (r.account_id) add(r.account_id, r.amount_cents);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const by_account: AccountTotal[] = [...byAccount.entries()]
    .filter(([, total]) => total !== 0)
    .map(([id, total]) => {
      const a = id ? accountById.get(id) : undefined;
      return {
        account_id: id,
        name: a?.name ?? "Sem conta definida",
        type: (a?.type as AccountType) ?? null,
        due_day: a?.due_day ?? null,
        payment_day: a?.payment_day ?? null,
        total_cents: total,
      };
    })
    .sort((a, b) => (a.type === "credit" ? 0 : 1) - (b.type === "credit" ? 0 : 1) || b.total_cents - a.total_cents);

  const canonical = new Map(peopleNames.map((p) => [normalize(p), p]));
  const people = new Map<string, { person: string; total_cents: number; count: number }>();
  for (const r of pending) {
    const key = normalize(r.person);
    const p = people.get(key) ?? { person: canonical.get(key) ?? r.person, total_cents: 0, count: 0 };
    p.total_cents += r.amount_cents;
    p.count++;
    people.set(key, p);
  }

  const total = installmentsTotal + recurringTotal + oneOff;
  const incomeExtra = incomes.reduce((s, i) => s + i.amount_cents, 0);
  const income = settings.income_cents == null && incomeExtra === 0 ? null : (settings.income_cents ?? 0) + incomeExtra;
  const goalsPlanned = goals.reduce((s, g) => s + g.month_planned_cents, 0);
  const goalsDone = goals.reduce((s, g) => s + Math.max(g.month_contrib_cents, 0), 0);

  return {
    month,
    today: ctx.today,
    totals: {
      installments_cents: installmentsTotal,
      recurring_cents: recurringTotal,
      one_off_cents: oneOff,
      budget_overflow_cents: overflow,
      total_cents: total,
      receivable_month_cents: receivablesMonth.reduce((s, r) => s + r.amount_cents, 0),
      receivable_pending_cents: pending.reduce((s, r) => s + r.amount_cents, 0),
      receivable_future_cents: future.reduce((s, r) => s + r.amount_cents, 0),
      income_cents: income,
      income_base_cents: settings.income_cents,
      income_extra_cents: incomeExtra,
      goals_planned_cents: goalsPlanned,
      goals_done_cents: goalsDone,
      leftover_cents: income != null ? income - total - Math.max(goalsPlanned, goalsDone) : null,
    },
    by_account,
    budgets,
    pending_by_person: [...people.values()].sort((a, b) => b.total_cents - a.total_cents),
    balance,
  };
}

/** Backup completo em JSON. */
export async function exportAll(ctx: Ctx) {
  const tables = [
    "accounts", "recurring", "recurring_months", "installments", "expenses", "receivables", "incomes", "month_balances", "goals", "goal_entries", "settings",
    // LifeOS
    "projects", "tasks", "events", "activity_log",
  ];
  const results = await ctx.db.batch(tables.map((t) => ctx.db.prepare(`SELECT * FROM ${t}`)));
  return {
    exported_at: new Date().toISOString(),
    version: 4,
    tables: Object.fromEntries(tables.map((t, i) => [t, results[i].results])),
  };
}
