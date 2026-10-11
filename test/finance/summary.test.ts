// Resumo do mês e saldo acumulado com a fixture. Os valores esperados foram calculados à mão (ver comentários).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addMonths } from "../../src/shared/month";
import { clearOpeningBalance, getMonthBalance, setOpeningBalance } from "../../src/worker/services/balance";
import { exportAll, getSummary } from "../../src/worker/services/summary";
import { resetFinance, testCtx } from "../fixtures/finance";

const ctx = testCtx(env.DB);

beforeEach(() => resetFinance(env.DB));

describe("getSummary", () => {
  it("outubro/2026: totais", async () => {
    const { totals: t } = await getSummary(ctx, "2026-10");
    // Parcelados: Notebook 450 + Fone 120 + Passagem 389,90
    expect(t.installments_cents).toBe(95990);
    // Fixos: Streaming 39,90 + Internet 99,90 + Academia 89,90 (último mês) + Luz ajustada 212,37
    // + Almoço (previsto 600 > gasto 61,40) + Transporte (gasto 178,90 > previsto 150)
    expect(t.recurring_cents).toBe(122097);
    expect(t.budget_overflow_cents).toBe(2890);
    // Avulsos fora de orçamento: Mercado 230,45 + Gasolina 150 + Jantar (sua parte) 93
    expect(t.one_off_cents).toBe(47345);
    expect(t.total_cents).toBe(265432);
    // Renda: salário 6.500 + Freela 800
    expect(t.income_base_cents).toBe(650000);
    expect(t.income_extra_cents).toBe(80000);
    expect(t.income_cents).toBe(730000);
    // Metas: Reserva 500 + Viagem 1.000 planejados; feito: Reserva 500
    expect(t.goals_planned_cents).toBe(150000);
    expect(t.goals_done_cents).toBe(50000);
    // Sobra = 7.300 - 2.654,32 - 1.500
    expect(t.leftover_cents).toBe(314568);
    // Devedores: Ana 93 + 1ª parcela do Pedro 200 (as outras 2 parcelas ainda não venceram; Bruno já pagou)
    expect(t.receivable_month_cents).toBe(29300);
    expect(t.receivable_pending_cents).toBe(29300);
    expect(t.receivable_future_cents).toBe(40000);
  });

  it("outubro/2026: faturas por cartão incluem a parte dos devedores", async () => {
    const s = await getSummary(ctx, "2026-10");
    const byName = Object.fromEntries(s.by_account.map((a) => [a.name, a.total_cents]));
    expect(byName).toEqual({
      "Cartão B": 146015, // Notebook + Passagem + Internet + Academia + Mercado + parcela do Pedro
      "Cartão A": 49590, // Fone + Streaming + Gasolina + Jantar (sua parte + parte da Ana)
      Pix: 39127, // Luz ajustada + Ubers do orçamento de transporte
      VR: 6140, // Almoços do orçamento
    });
    expect(s.by_account.map((a) => a.type)).toEqual(["credit", "credit", "pix", "voucher"]);
  });

  it("outubro/2026: orçamentos e devedores por pessoa", async () => {
    const s = await getSummary(ctx, "2026-10");
    expect(s.budgets).toEqual([
      { id: 5, description: "Almoço", limit_cents: 60000, spent_cents: 6140, remaining_cents: 53860 },
      { id: 6, description: "Transporte", limit_cents: 15000, spent_cents: 17890, remaining_cents: -2890 },
    ]);
    expect(s.pending_by_person).toEqual([
      { person: "Pedro", total_cents: 20000, count: 1 },
      { person: "Ana", total_cents: 9300, count: 1 },
    ]);
  });

  it("setembro, outubro e novembro/2026: retrato completo", async () => {
    for (const month of ["2026-09", "2026-10", "2026-11"]) {
      expect(await getSummary(ctx, month)).toMatchSnapshot(month);
    }
  });
});

describe("saldo acumulado", () => {
  it("começa em setembro com 0, passa a sobra adiante e respeita o ajuste manual de novembro", async () => {
    const sep = await getMonthBalance(ctx, "2026-09");
    // Setembro: 6.500 - (959,90 parcelados + 1.139,70 fixos + 300 avulsos) - 1.500 metas
    expect(sep).toMatchObject({ start_month: "2026-09", opening_source: "start", opening_cents: 0, leftover_cents: 260040, closing_cents: 260040 });

    const oct = await getMonthBalance(ctx, "2026-10");
    expect(oct).toMatchObject({ opening_source: "carried", opening_cents: 260040, leftover_cents: 314568, closing_cents: 574608 });

    const nov = await getMonthBalance(ctx, "2026-11");
    expect(nov).toMatchObject({ opening_source: "manual", opening_cents: 100000, automatic_opening_cents: 574608, note: "Conferido no banco" });

    const dec = await getMonthBalance(ctx, "2026-12");
    expect(dec).toMatchObject({ opening_source: "carried", opening_cents: nov!.closing_cents });

    expect(await getMonthBalance(ctx, "2026-08")).toBeNull();
  });

  it("remover o ajuste manual volta ao saldo automático", async () => {
    await clearOpeningBalance(ctx, "2026-11");
    expect(await getMonthBalance(ctx, "2026-11")).toMatchObject({ opening_source: "carried", opening_cents: 574608 });
    await setOpeningBalance(ctx, "2026-10", { opening_cents: -5000, note: null });
    expect(await getMonthBalance(ctx, "2026-10")).toMatchObject({ opening_source: "manual", opening_cents: -5000, closing_cents: -5000 + 314568 });
  });

  it("a sobra do saldo acumulado é a mesma do resumo em todos os meses (as duas contas precisam concordar)", async () => {
    for (let m = "2026-09"; m <= "2027-08"; m = addMonths(m, 1)) {
      const [summary, balance] = await Promise.all([getSummary(ctx, m), getMonthBalance(ctx, m)]);
      expect(balance?.leftover_cents, m).toBe(summary.totals.leftover_cents);
    }
  });
});

describe("backup", () => {
  it("exportAll inclui todas as tabelas do banco", async () => {
    const backup = await exportAll(ctx);
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
    ).all<{ name: string }>();
    expect(Object.keys(backup.tables).sort()).toEqual(results.map((r) => r.name).sort());
    expect(backup.tables.expenses).toHaveLength(9);
  });
});
