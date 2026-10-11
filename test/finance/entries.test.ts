// Lançamentos: gasto dividido, exclusão, devedor parcelado e ajuste de fixos.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createExpense, deleteExpense, getExpense } from "../../src/worker/services/expenses";
import { createReceivable, listReceivables, markReceived } from "../../src/worker/services/receivables";
import { getRecurring, setRecurringMonth } from "../../src/worker/services/recurring";
import { resetFinance, testCtx } from "../fixtures/finance";

const ctx = testCtx(env.DB);

beforeEach(() => resetFinance(env.DB));

describe("gasto dividido", () => {
  it("sua parte vira gasto e a dos outros vira devedor, no mesmo cartão e mês da fatura", async () => {
    const res = await createExpense(ctx, {
      description: "Pizza",
      amount_cents: 12000,
      date: "2026-10-26", // Cartão B fecha dia 5: vai para novembro
      account_id: 2,
      splits: [
        { person: "ana", amount_cents: 4000 }, // nome normalizado para o já cadastrado
        { person: "Carla", amount_cents: 4000 },
      ],
    });
    expect(res.month).toBe("2026-11");
    expect(res.my_share_cents).toBe(4000);
    expect(res.expense).toMatchObject({ amount_cents: 4000, month: "2026-11", account_id: 2, shared_cents: 8000 });
    const rows = await listReceivables(ctx, { status: "pending" });
    const created = rows.filter((r) => res.receivable_ids.includes(r.id));
    expect(created.map((r) => [r.person, r.amount_cents, r.month, r.account_id, r.expense_id])).toEqual([
      ["Carla", 4000, "2026-11", 2, res.expense!.id],
      ["Ana", 4000, "2026-11", 2, res.expense!.id],
    ]);
  });

  it("recusa quando a parte dos outros passa do total", async () => {
    await expect(
      createExpense(ctx, { description: "X", amount_cents: 1000, account_id: 3, splits: [{ person: "Ana", amount_cents: 1500 }] }),
    ).rejects.toThrow("maior que o valor total");
  });

  it("excluir o gasto remove só os devedores ainda não recebidos", async () => {
    const res = await createExpense(ctx, {
      description: "Bar",
      amount_cents: 9000,
      date: "2026-10-12",
      account_id: 3,
      splits: [
        { person: "Ana", amount_cents: 3000 },
        { person: "Bruno", amount_cents: 3000 },
      ],
    });
    const [anaId, brunoId] = res.receivable_ids;
    await markReceived(ctx, { ids: [brunoId] });
    await deleteExpense(ctx, res.expense!.id);
    await expect(getExpense(ctx, res.expense!.id)).rejects.toThrow("não encontrado");
    const ids = (await listReceivables(ctx, { status: "all" })).map((r) => r.id);
    expect(ids).not.toContain(anaId);
    expect(ids).toContain(brunoId);
  });
});

describe("devedor parcelado", () => {
  it("cria uma linha por parcela, a partir do mês informado", async () => {
    const rows = await createReceivable(ctx, {
      person: "Bruno",
      description: "Tênis",
      total_cents: 30001,
      installments: 3,
      month: "2026-10",
      account_id: 2,
    });
    expect(rows.map((r) => [r.installment_no, r.installment_total, r.month])).toEqual([
      [1, 3, "2026-10"],
      [2, 3, "2026-11"],
      [3, 3, "2026-12"],
    ]);
    expect(rows.reduce((s, r) => s + r.amount_cents, 0)).toBe(30001); // sem perder centavos
    expect(new Set(rows.map((r) => r.installment_group)).size).toBe(1);
  });

  it("'recebi tudo' de uma pessoa marca só as parcelas que já venceram", async () => {
    await markReceived(ctx, { person: "Pedro" });
    const pedro = await listReceivables(ctx, { status: "all", person: "Pedro" });
    const received = Object.fromEntries(pedro.map((r) => [r.installment_no, r.received_at !== null]));
    expect(received).toEqual({ 1: true, 2: false, 3: false });
  });
});

describe("fixos", () => {
  it("ajuste do mês, marcar como pago e voltar ao valor padrão", async () => {
    let r = await setRecurringMonth(ctx, 1, "2026-10", { amount_cents: 4590 });
    expect(r).toMatchObject({ month_amount_cents: 4590, overridden: true, paid: false });
    r = await setRecurringMonth(ctx, 1, "2026-10", { paid: true });
    expect(r).toMatchObject({ month_amount_cents: 4590, paid: true });
    r = await setRecurringMonth(ctx, 1, "2026-10", { amount_cents: null, paid: false });
    expect(r).toMatchObject({ month_amount_cents: 3990, overridden: false, paid: false });
    // O mês seguinte não é afetado
    expect(await getRecurring(ctx, 1, "2026-11")).toMatchObject({ month_amount_cents: 3990, overridden: false });
  });
});
