import { Hono } from "hono";
import { MONTH_RE } from "../shared/month";
import { idParam, limitParam, makeCtx, UserError } from "./lib";
import { agendaRoutes } from "./modules/agenda/routes";
import { tasksRoutes } from "./modules/tasks/routes";
import { todayRoutes } from "./modules/today/routes";
import { trainingRoutes } from "./modules/training/routes";
import * as accounts from "./services/accounts";
import * as balance from "./services/balance";
import * as expenses from "./services/expenses";
import * as goals from "./services/goals";
import * as incomes from "./services/incomes";
import * as installments from "./services/installments";
import * as receivables from "./services/receivables";
import * as recurring from "./services/recurring";
import * as summary from "./services/summary";

type App = { Bindings: Env };
export const api = new Hono<App>();

const ctxOf = (c: { env: Env }) => makeCtx(c.env);
const monthQuery = (v: string | undefined, fallback: string) => {
  if (!v) return fallback;
  if (!MONTH_RE.test(v)) throw new UserError("mês inválido (use YYYY-MM)");
  return v;
};

// ---- Resumo / configurações ----
api.get("/summary", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await summary.getSummary(ctx, monthQuery(c.req.query("month"), ctx.month)));
});
api.get("/settings", async (c) => c.json(await summary.getSettings(ctxOf(c))));
api.put("/settings", async (c) => c.json(await summary.updateSettings(ctxOf(c), await c.req.json())));
api.get("/export", async (c) => {
  const ctx = ctxOf(c);
  c.header("Content-Disposition", `attachment; filename="financas-backup-${ctx.today}.json"`);
  return c.json(await summary.exportAll(ctx));
});
api.get("/mcp-info", (c) => {
  const origin = new URL(c.req.url).origin;
  const token = c.env.MCP_TOKEN;
  return c.json({ configured: !!token && token.length >= 16, url: token ? `${origin}/mcp/${token}` : null });
});

// ---- Contas / cartões ----
api.get("/accounts", async (c) => c.json(await accounts.listAccounts(ctxOf(c), c.req.query("all") === "1")));
api.post("/accounts", async (c) => c.json(await accounts.createAccount(ctxOf(c), await c.req.json()), 201));
api.patch("/accounts/:id", async (c) => c.json(await accounts.updateAccount(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
api.delete("/accounts/:id", async (c) => c.json(await accounts.deleteAccount(ctxOf(c), idParam(c.req.param("id")))));

// ---- Avulsos ----
api.get("/expenses", async (c) => {
  const ctx = ctxOf(c);
  const q = c.req.query();
  return c.json(
    await expenses.listExpenses(ctx, {
      month: q.month ? monthQuery(q.month, ctx.month) : undefined,
      account_id: q.account_id ? Number(q.account_id) : undefined,
      budget_id: q.budget_id ? Number(q.budget_id) : undefined,
      search: q.search || undefined,
      limit: limitParam(q.limit),
    }),
  );
});
api.post("/expenses", async (c) => c.json(await expenses.createExpense(ctxOf(c), await c.req.json()), 201));
api.patch("/expenses/:id", async (c) => c.json(await expenses.updateExpense(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
api.delete("/expenses/:id", async (c) => c.json(await expenses.deleteExpense(ctxOf(c), idParam(c.req.param("id")))));

// ---- Parcelados ----
api.get("/installments", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await installments.listInstallments(ctx, monthQuery(c.req.query("month"), ctx.month), c.req.query("all") === "1"));
});
api.post("/installments", async (c) => c.json(await installments.createInstallment(ctxOf(c), await c.req.json()), 201));
api.patch("/installments/:id", async (c) =>
  c.json(await installments.updateInstallment(ctxOf(c), idParam(c.req.param("id")), await c.req.json())),
);
api.delete("/installments/:id", async (c) => c.json(await installments.deleteInstallment(ctxOf(c), idParam(c.req.param("id")))));

// ---- Fixos / orçamentos ----
api.get("/recurring", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await recurring.listRecurring(ctx, monthQuery(c.req.query("month"), ctx.month), c.req.query("all") === "1"));
});
api.post("/recurring", async (c) => c.json(await recurring.createRecurring(ctxOf(c), await c.req.json()), 201));
api.patch("/recurring/:id", async (c) => c.json(await recurring.updateRecurring(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
api.delete("/recurring/:id", async (c) => c.json(await recurring.deleteRecurring(ctxOf(c), idParam(c.req.param("id")))));
api.put("/recurring/:id/months/:month", async (c) => {
  const ctx = ctxOf(c);
  const month = monthQuery(c.req.param("month"), ctx.month);
  return c.json(await recurring.setRecurringMonth(ctx, idParam(c.req.param("id")), month, await c.req.json()));
});

// ---- Devedores ----
api.get("/receivables", async (c) => {
  const status = c.req.query("status");
  return c.json(
    await receivables.listReceivables(ctxOf(c), {
      status: status === "all" || status === "received" ? status : "pending",
      person: c.req.query("person") || undefined,
    }),
  );
});
api.get("/people", async (c) => c.json(await receivables.listPeople(ctxOf(c))));
api.post("/receivables", async (c) => {
  const rows = await receivables.createReceivable(ctxOf(c), await c.req.json());
  // Mantém a resposta de antes (o devedor criado); parcelados devolvem a 1ª parcela + todas em `installments`
  return c.json(rows.length > 1 ? { ...rows[0], installments: rows } : rows[0], 201);
});
api.post("/receivables/mark-received", async (c) => c.json(await receivables.markReceived(ctxOf(c), await c.req.json())));
api.patch("/receivables/:id", async (c) =>
  c.json(await receivables.updateReceivable(ctxOf(c), idParam(c.req.param("id")), await c.req.json())),
);
api.delete("/receivables/:id", async (c) => {
  const id = idParam(c.req.param("id"));
  // ?group=1 exclui todas as parcelas pendentes do parcelamento
  return c.json(c.req.query("group") === "1" ? await receivables.deleteReceivableGroup(ctxOf(c), id) : await receivables.deleteReceivable(ctxOf(c), id));
});

// ---- Saldo acumulado: ajuste manual do saldo inicial de um mês ----
api.put("/balances/:month", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await balance.setOpeningBalance(ctx, monthQuery(c.req.param("month"), ctx.month), await c.req.json()));
});
api.delete("/balances/:month", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await balance.clearOpeningBalance(ctx, monthQuery(c.req.param("month"), ctx.month)));
});

// ---- Entradas extras (13º, bônus...) ----
api.get("/incomes", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await incomes.listIncomes(ctx, monthQuery(c.req.query("month"), ctx.month)));
});
api.post("/incomes", async (c) => c.json(await incomes.createIncome(ctxOf(c), await c.req.json()), 201));
api.patch("/incomes/:id", async (c) => c.json(await incomes.updateIncome(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
api.delete("/incomes/:id", async (c) => c.json(await incomes.deleteIncome(ctxOf(c), idParam(c.req.param("id")))));

// ---- Metas / investimentos ----
api.get("/goals", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await goals.listGoals(ctx, monthQuery(c.req.query("month"), ctx.month), c.req.query("all") === "1"));
});
api.post("/goals", async (c) => c.json(await goals.createGoal(ctxOf(c), await c.req.json()), 201));
api.patch("/goals/:id", async (c) => c.json(await goals.updateGoal(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
api.delete("/goals/:id", async (c) => c.json(await goals.deleteGoal(ctxOf(c), idParam(c.req.param("id")))));
api.get("/goals/:id/entries", async (c) => c.json(await goals.listGoalEntries(ctxOf(c), idParam(c.req.param("id")))));
api.post("/goals/:id/entries", async (c) => c.json(await goals.addGoalEntry(ctxOf(c), idParam(c.req.param("id")), await c.req.json()), 201));
api.post("/goals/:id/balance", async (c) => {
  const body = await c.req.json<{ balance_cents: number; note?: string }>();
  if (!Number.isInteger(body.balance_cents)) throw new UserError("balance_cents inválido");
  return c.json(await goals.setGoalBalance(ctxOf(c), idParam(c.req.param("id")), body.balance_cents, body.note));
});
api.post("/goals/:id/check", async (c) => {
  const ctx = ctxOf(c);
  const body = await c.req.json<{ month?: string; amount_cents?: number }>().catch(() => ({}) as { month?: string; amount_cents?: number });
  return c.json(await goals.checkGoalMonth(ctx, idParam(c.req.param("id")), monthQuery(body.month, ctx.month), body.amount_cents));
});
api.delete("/goal-entries/:id", async (c) => {
  await goals.deleteGoalEntry(ctxOf(c), idParam(c.req.param("id")));
  return c.json({ ok: true });
});

// ---- Módulos do LifeOS ----
api.route("/", tasksRoutes);
api.route("/", agendaRoutes);
api.route("/", trainingRoutes);
api.route("/", todayRoutes);
