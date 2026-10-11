// Regras puras do financeiro: mês de referência (fatura), meses, dinheiro, divisão de gastos, devedores e metas.
import { describe, expect, it } from "vitest";
import { formatBRL, parseMoney, toCents } from "../../src/shared/money";
import { addMonths, monthDiff, referenceMonth, type CardCycle } from "../../src/shared/month";
import { isDue } from "../../src/shared/receivables";
import { splitAmounts } from "../../src/worker/mcp/tools";
import { decorateGoal, type GoalRow } from "../../src/worker/services/goals";

const credit = (closing_day: number | null, due_day: number | null, payment_day: number | null = null): CardCycle => ({
  type: "credit",
  closing_day,
  due_day,
  payment_day,
});

describe("referenceMonth (mês em que o dinheiro sai da conta)", () => {
  it("sem conta, débito, pix ou crédito sem fechamento: o mês da data", () => {
    expect(referenceMonth("2026-10-28")).toBe("2026-10");
    expect(referenceMonth("2026-10-28", null)).toBe("2026-10");
    expect(referenceMonth("2026-10-28", { type: "debit", closing_day: 5, due_day: 12 })).toBe("2026-10");
    expect(referenceMonth("2026-10-28", credit(null, null))).toBe("2026-10");
  });

  it("vence no mesmo mês do fechamento (fecha 5, vence 12)", () => {
    const card = credit(5, 12);
    expect(referenceMonth("2026-10-04", card)).toBe("2026-10");
    expect(referenceMonth("2026-10-05", card)).toBe("2026-11"); // no dia do fechamento já vai para a próxima
    expect(referenceMonth("2026-12-20", card)).toBe("2027-01"); // virada de ano
  });

  it("vence no mês seguinte ao fechamento (fecha 24, vence 1)", () => {
    const card = credit(24, 1);
    expect(referenceMonth("2026-10-10", card)).toBe("2026-11");
    expect(referenceMonth("2026-10-24", card)).toBe("2026-12");
    expect(referenceMonth("2026-12-24", card)).toBe("2027-02");
  });

  it("paga antes do vencimento, num dia maior (fecha 24, vence 1, paga 25): conta no mês em que paga", () => {
    const card = credit(24, 1, 25);
    expect(referenceMonth("2026-10-10", card)).toBe("2026-10");
    expect(referenceMonth("2026-10-24", card)).toBe("2026-11");
  });

  it("fecha 27, vence 3, paga 27", () => {
    const card = credit(27, 3, 27);
    expect(referenceMonth("2026-10-26", card)).toBe("2026-10");
    expect(referenceMonth("2026-10-27", card)).toBe("2026-11");
  });

  it("dia de pagamento menor ou igual ao vencimento não muda o mês", () => {
    expect(referenceMonth("2026-10-04", credit(5, 12, 10))).toBe("2026-10");
    expect(referenceMonth("2026-10-04", credit(5, 12, 12))).toBe("2026-10");
  });
});

describe("meses", () => {
  it("addMonths atravessa anos nos dois sentidos", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
  });

  it("monthDiff", () => {
    expect(monthDiff("2026-10", "2027-01")).toBe(3);
    expect(monthDiff("2027-01", "2026-10")).toBe(-3);
  });
});

describe("dinheiro", () => {
  it.each([
    ["32,50", 3250],
    ["10,5", 1050],
    ["1.234,56", 123456],
    ["1234.56", 123456],
    ["1,234.56", 123456],
    ["1.234", 123400],
    ["R$ 10", 1000],
    ["", null],
    ["abc", null],
  ])("parseMoney(%j) = %j", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it("toCents arredonda", () => {
    expect(toCents(32.5)).toBe(3250);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("formatBRL", () => {
    expect(formatBRL(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
  });
});

describe("splitAmounts (dividir um gasto)", () => {
  it("sem pessoas: nada", () => {
    expect(splitAmounts(10000, [])).toEqual([]);
  });

  it("divide igualmente entre você e quem não tem valor (arredonda para baixo)", () => {
    expect(splitAmounts(10000, [{ pessoa: "Ana" }])).toEqual([{ person: "Ana", amount_cents: 5000 }]);
    expect(splitAmounts(10000, [{ pessoa: "Ana" }, { pessoa: "Bia" }])).toEqual([
      { person: "Ana", amount_cents: 3333 },
      { person: "Bia", amount_cents: 3333 },
    ]);
  });

  it("valores informados são respeitados e o resto é dividido", () => {
    expect(splitAmounts(10000, [{ pessoa: "Ana", valor: 20 }, { pessoa: "Bia" }])).toEqual([
      { person: "Ana", amount_cents: 2000 },
      { person: "Bia", amount_cents: 4000 },
    ]);
  });
});

describe("isDue (parcelas de devedor parcelado)", () => {
  it("à vista sempre está vencido; parcela só a partir do mês dela", () => {
    expect(isDue({ installment_group: null, month: "2027-05" }, "2026-10")).toBe(true);
    expect(isDue({ installment_group: "g", month: "2026-10" }, "2026-10")).toBe(true);
    expect(isDue({ installment_group: "g", month: "2026-11" }, "2026-10")).toBe(false);
  });
});

describe("decorateGoal (metas)", () => {
  const base: GoalRow = {
    id: 1,
    name: "Meta",
    institution: null,
    target_cents: 120000,
    monthly_cents: 10000,
    deadline: null,
    start_month: "2026-01",
    color: null,
    archived: 0,
    balance_cents: 60000,
    month_contrib_cents: 0,
  };

  it("aporte planejado e previsão no ritmo do aporte mensal", () => {
    const g = decorateGoal(base, "2026-10");
    expect(g.month_planned_cents).toBe(10000);
    expect(g.eta_month).toBe("2027-03"); // faltam 60.000 = 6 aportes, o primeiro em outubro
  });

  it("o aporte do mês já feito não muda o planejado do mês", () => {
    const g = decorateGoal({ ...base, balance_cents: 70000, month_contrib_cents: 10000 }, "2026-10");
    expect(g.month_planned_cents).toBe(10000);
    expect(g.eta_month).toBe("2027-03");
  });

  it("meta atingida não tem aporte planejado; último aporte limitado ao que falta", () => {
    expect(decorateGoal({ ...base, balance_cents: 120000 }, "2026-10").month_planned_cents).toBe(0);
    expect(decorateGoal({ ...base, balance_cents: 115000 }, "2026-10").month_planned_cents).toBe(5000);
  });

  it("aporte necessário para cumprir o prazo; fora do período não há aporte planejado", () => {
    const g = decorateGoal({ ...base, deadline: "2026-12" }, "2026-10");
    expect(g.required_monthly_cents).toBe(20000); // 60.000 em 3 meses (out, nov, dez)
    expect(decorateGoal({ ...base, deadline: "2026-09" }, "2026-10").month_planned_cents).toBe(0);
    expect(decorateGoal({ ...base, start_month: "2026-11" }, "2026-10").month_planned_cents).toBe(0);
    expect(decorateGoal({ ...base, archived: 1 }, "2026-10").month_planned_cents).toBe(0);
  });
});
