// Composição (Hoje e semana): os números vêm dos módulos donos, sem recalcular regras.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createEvent } from "../../src/worker/modules/agenda/service";
import { createTask, updateTask } from "../../src/worker/modules/tasks/service";
import { getFinance, getToday, getWeek } from "../../src/worker/modules/today/service";
import { createSession, updateSession } from "../../src/worker/modules/training/service";
import { createExpense } from "../../src/worker/services/expenses";
import { getSummary } from "../../src/worker/services/summary";
import { resetFinance, testCtx } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

const ctx = testCtx(env.DB, "2026-10-15", "09:00");

beforeEach(async () => {
  await resetFinance(env.DB);
  await resetLifeOS(env.DB);
});

describe("finanças em Hoje", () => {
  it("usa exatamente os valores do resumo do mês (getSummary)", async () => {
    const [finance, summary] = await Promise.all([getFinance(ctx), getSummary(ctx, "2026-10")]);
    expect(finance).toMatchObject({
      month: "2026-10",
      total_cents: summary.totals.total_cents,
      income_cents: summary.totals.income_cents,
      leftover_cents: summary.totals.leftover_cents,
      closing_cents: summary.balance!.closing_cents,
      receivable_pending_cents: summary.totals.receivable_pending_cents,
    });
    expect(finance.total_cents).toBe(265432);
    // Transporte estourou (178,90 de 150); Almoço está em 10%: só o primeiro pede atenção
    expect(finance.budgets_attention).toEqual([{ id: 6, description: "Transporte", spent_cents: 17890, limit_cents: 15000, remaining_cents: -2890 }]);
    expect((await getToday(ctx)).finance).toEqual(finance);
  });
});

describe("gastos de hoje", () => {
  it("lista os gastos com data de hoje, soma a sua parte e separa a dos outros", async () => {
    await createExpense(ctx, { description: "Café", amount_cents: 850, date: "2026-10-15", account_id: 3 });
    await createExpense(ctx, { description: "Almoço", amount_cents: 3200, date: "2026-10-15", account_id: 4, budget_id: 5 });
    // No Cartão B (fecha dia 5): fatura de novembro, mas é gasto de hoje; metade é de outra pessoa
    await createExpense(ctx, { description: "Jantar", amount_cents: 12000, date: "2026-10-15", account_id: 2, splits: [{ person: "Ana", amount_cents: 6000 }] });
    await createExpense(ctx, { description: "Ontem", amount_cents: 999, date: "2026-10-14", account_id: 3 });

    const { spending } = await getToday(ctx);
    expect(spending.items.map((e) => e.description).sort()).toEqual(["Almoço", "Café", "Jantar"]);
    expect(spending.total_cents).toBe(850 + 3200 + 6000);
    expect(spending.shared_cents).toBe(6000);
  });

  it("dia sem gastos", async () => {
    expect((await getToday(ctx)).spending).toEqual({ items: [], total_cents: 0, shared_cents: 0 });
  });
});

describe("semana", () => {
  it("compromissos, tarefas concluídas e com prazo na semana, atrasadas e treinos", async () => {
    await createEvent(ctx, { title: "Aula", start: "2026-10-12T19:00", rrule: "FREQ=WEEKLY;BYDAY=MO,WE" });
    await createEvent(ctx, { title: "Fora da semana", start: "2026-10-20T10:00" });
    const a = await createTask(ctx, { title: "Feita na semana", due_date: "2026-10-14" });
    await updateTask(ctx, a.id, { status: "done" });
    const old = await createTask(ctx, { title: "Feita antes" });
    await updateTask(testCtx(env.DB, "2026-10-09"), old.id, { status: "done" });
    await createTask(ctx, { title: "Prazo sexta", due_date: "2026-10-16" });
    await createTask(ctx, { title: "Atrasada", due_date: "2026-10-01" });
    const t = await createSession(ctx, { sport: "run", date: "2026-10-13", planned_duration_s: 1800 });
    await updateSession(ctx, t.id, { status: "done", as_planned: true });

    const w = await getWeek(ctx, "2026-10-15");
    expect(w).toMatchObject({ week_start: "2026-10-12", week_end: "2026-10-18", events: 2 });
    expect(w.tasks.done.map((x) => x.title)).toEqual(["Feita na semana"]);
    expect(w.tasks.due_open.map((x) => x.title)).toEqual(["Prazo sexta"]);
    expect(w.tasks.overdue).toBe(1);
    expect(w.training).toMatchObject({ planned: 1, done: 1, compliance_pct: 100 });
  });

  it("recusa data inválida", async () => {
    await expect(getWeek(ctx, "2026-13-01")).rejects.toThrow("Data inválida");
  });
});
