// Dividir parcelados e fixos com outras pessoas, e o acerto (o que a pessoa te deve menos o que você deve a ela).
// Pessoa 1 (dona da fixture) lança; pessoa 2 ("Ana", conectada e ligada ao nome) deve.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleMcpRequest } from "../../src/worker/mcp/server";
import * as connections from "../../src/worker/modules/connections/service";
import { createInstallment, deleteInstallment, getInstallment } from "../../src/worker/services/installments";
import * as payables from "../../src/worker/services/payables";
import { createReceivable, listReceivables, markReceived } from "../../src/worker/services/receivables";
import { createRecurring, deleteRecurring, getRecurring, updateRecurring } from "../../src/worker/services/recurring";
import { getSummary } from "../../src/worker/services/summary";
import { MONTH, resetFinance, testCtx, TODAY } from "../fixtures/finance";

const owner = testCtx(env.DB);
const ana = testCtx(env.DB, TODAY, "10:00", 2);

beforeEach(async () => {
  await resetFinance(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET name = 'Dono' WHERE id = 1"),
    env.DB.prepare("INSERT INTO users (id, name, role) VALUES (2, 'Ana Souza', 'member')"),
    env.DB.prepare("INSERT INTO connections (user_a, user_b) VALUES (1, 2)"),
  ]);
  await connections.linkPerson(owner, { person: "Ana", user_id: 2 });
});

const of = <T extends { description: string }>(rows: T[], description: string) => rows.filter((r) => r.description === description);

async function mcp(userId: number, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const req = new Request("https://x/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await handleMcpRequest(req, env, userId, null);
  const body = (await res.json()) as { result: { content: { text: string }[] } };
  // formatBRL usa espaço não separável entre "R$" e o valor
  return body.result.content[0].text.replace(/\u00a0/g, " ");
}

describe("parcelado dividido", () => {
  it("o parcelado fica com a sua parte e a da pessoa vira devedor parcelado, nos mesmos meses e cartão", async () => {
    // Cartão B fecha dia 5: compra em 15/10 cai na fatura de novembro
    const i = await createInstallment(owner, {
      description: "Sofá",
      installment_cents: 30000,
      total_installments: 3,
      account_id: 2,
      purchase_date: TODAY,
      splits: [{ person: "ana", amount_cents: 10000 }],
    });
    expect(i).toMatchObject({ installment_cents: 20000, first_month: "2026-11", last_month: "2027-01" });
    expect((await getInstallment(owner, i.id, "2026-11")).shared_cents).toBe(10000);

    const rows = of(await listReceivables(owner, { status: "all" }), "Sofá");
    expect(rows.map((r) => [r.person, r.amount_cents, r.month, r.installment_no, r.account_id, r.installment_id, r.debtor_user_id]).sort()).toEqual([
      ["Ana", 10000, "2026-11", 1, 2, i.id, 2],
      ["Ana", 10000, "2026-12", 2, 2, i.id, 2],
      ["Ana", 10000, "2027-01", 3, 2, i.id, 2],
    ]);
    // Na fatura de novembro entram as duas partes; nos seus gastos, só a sua
    const before = await getSummary(owner, "2026-12");
    expect(of(await payables.listPayables(ana, { status: "all" }), "Sofá")).toHaveLength(3);

    // Excluir o parcelado leva as parcelas ainda não recebidas da pessoa
    await markReceived(owner, { ids: [rows.find((r) => r.installment_no === 1)!.id] });
    await deleteInstallment(owner, i.id);
    expect(of(await listReceivables(owner, { status: "all" }), "Sofá").map((r) => r.installment_no)).toEqual([1]);
    const after = await getSummary(owner, "2026-12");
    expect(before.totals.installments_cents - after.totals.installments_cents).toBe(20000);
    expect(before.by_account.find((a) => a.account_id === 2)!.total_cents - after.by_account.find((a) => a.account_id === 2)!.total_cents).toBe(30000);
  });

  it("com valor total, divide o total sem perder centavos; a parte dos outros não pode passar do valor", async () => {
    const i = await createInstallment(owner, {
      description: "TV",
      total_cents: 100000,
      total_installments: 3,
      account_id: 2,
      purchase_date: TODAY,
      splits: [{ person: "Ana", amount_cents: 50000 }],
    });
    expect(i.installment_cents).toBe(16667);
    expect(of(await listReceivables(owner, { status: "all" }), "TV").map((r) => r.amount_cents).sort()).toEqual([16666, 16667, 16667]);
    await expect(
      createInstallment(owner, { description: "X", installment_cents: 1000, total_installments: 2, splits: [{ person: "Ana", amount_cents: 2000 }] }),
    ).rejects.toThrow(/maior que o valor/);
  });

  it("parcelamento em andamento: só as parcelas a partir da atual viram devedor", async () => {
    const i = await createInstallment(owner, {
      description: "Curso",
      installment_cents: 20000,
      total_installments: 5,
      current_installment: 3,
      splits: [{ person: "Ana", amount_cents: 5000 }],
    });
    expect(i).toMatchObject({ installment_cents: 15000, first_month: "2026-08", current: 3 });
    expect(of(await listReceivables(owner, { status: "all" }), "Curso").map((r) => [r.installment_no, r.month]).sort()).toEqual([
      [3, "2026-10"],
      [4, "2026-11"],
      [5, "2026-12"],
    ]);
  });
});

describe("fixo dividido", () => {
  it("o fixo fica com a sua parte e todo mês a parte da pessoa vira um devedor (sem duplicar)", async () => {
    const r = await createRecurring(owner, { description: "Plano família", amount_cents: 6000, account_id: 1, day: 31, splits: [{ person: "ana", amount_cents: 2000 }] });
    expect(r).toMatchObject({ amount_cents: 4000, shared_cents: 2000, splits: [{ person: "Ana", amount_cents: 2000 }] });

    const first = of(await listReceivables(owner), "Plano família");
    expect(first.map((x) => [x.person, x.amount_cents, x.month, x.date, x.account_id, x.recurring_id, x.debtor_user_id])).toEqual([["Ana", 2000, MONTH, "2026-10-31", 1, r.id, 2]]);
    await listReceivables(testCtx(env.DB));
    expect(of(await listReceivables(testCtx(env.DB)), "Plano família")).toHaveLength(1);

    // Dois meses depois, quem deve abre o "Devo" antes de quem tem a receber: novembro e dezembro já estão lá
    const anaDec = testCtx(env.DB, "2026-12-03", "10:00", 2);
    expect(of(await payables.listPayables(anaDec), "Plano família").map((p) => [p.month, p.date, p.amount_cents]).sort()).toEqual([
      ["2026-10", "2026-10-31", 2000],
      ["2026-11", "2026-11-30", 2000],
      ["2026-12", "2026-12-31", 2000],
    ]);
    // Conta nos gastos dela no mês e na fatura do cartão de quem lançou
    expect((await getSummary(anaDec, "2026-12")).totals.payables_month_cents).toBe(2000);
  });

  it("no resumo, a sua parte entra nos fixos e a fatura do cartão leva o valor todo (também nos meses futuros)", async () => {
    const base = await getSummary(owner, MONTH);
    const baseNext = await getSummary(owner, "2026-12");
    await createRecurring(owner, { description: "Plano família", amount_cents: 6000, account_id: 1, splits: [{ person: "Ana", amount_cents: 2000 }] });
    for (const [month, b] of [
      [MONTH, base],
      ["2026-12", baseNext],
    ] as const) {
      const s = await getSummary(owner, month);
      expect(s.totals.recurring_cents - b.totals.recurring_cents).toBe(4000);
      expect(s.by_account.find((a) => a.account_id === 1)!.total_cents - b.by_account.find((a) => a.account_id === 1)!.total_cents).toBe(6000);
    }
  });

  it("editar a divisão vale a partir deste mês; encerrar o fixo para de gerar; excluir mantém o que já era devido", async () => {
    const r = await createRecurring(owner, { description: "Plano família", amount_cents: 6000, splits: [{ person: "Ana", amount_cents: 2000 }] });
    await updateRecurring(owner, r.id, { amount_cents: 3000, splits: [{ person: "Ana", amount_cents: 3000 }], end_month: "2026-11" });
    expect(await getRecurring(owner, r.id)).toMatchObject({ amount_cents: 3000, shared_cents: 3000 });
    expect(of(await listReceivables(owner), "Plano família").map((x) => x.amount_cents)).toEqual([3000]);

    const jan = testCtx(env.DB, "2027-01-10");
    expect(of(await listReceivables(jan), "Plano família").map((x) => x.month).sort()).toEqual(["2026-10", "2026-11"]);

    await updateRecurring(jan, r.id, { splits: [] });
    expect((await getRecurring(jan, r.id)).splits).toEqual([]);
    await deleteRecurring(jan, r.id);
    expect(of(await listReceivables(jan), "Plano família")).toHaveLength(2);
  });

  it("orçamento não é dividido", async () => {
    await expect(createRecurring(owner, { description: "Almoço 2", amount_cents: 1000, is_budget: true, splits: [{ person: "Ana", amount_cents: 500 }] })).rejects.toThrow(/Orçamento/);
  });
});

describe("acerto com pessoa conectada", () => {
  it("o que a pessoa te deve menos o que você deve a ela, só com o que já venceu", async () => {
    // Ana deve o Jantar da fixture (93,00); o dono deve 50,00 a ela, mais uma parcela futura que ainda não conta
    await connections.linkPerson(ana, { person: "Dono", user_id: 1 });
    await createReceivable(ana, { person: "Dono", description: "Cinema", amount_cents: 5000 });
    await createReceivable(ana, { person: "Dono", description: "Presente", amount_cents: 4000, installments: 2, month: "2027-03" });

    expect((await payables.netByPerson(owner)).get(2)).toEqual({ user_id: 2, they_owe_cents: 9300, i_owe_cents: 5000, net_cents: 4300 });
    expect((await payables.netByPerson(ana)).get(1)).toEqual({ user_id: 1, they_owe_cents: 5000, i_owe_cents: 9300, net_cents: -4300 });

    expect(await mcp(1, "listar_devedores")).toContain("Acerto com Ana: te deve R$ 93,00 e você deve R$ 50,00 a ela → Ana te deve R$ 43,00.");
    expect(await mcp(2, "listar_minhas_dividas")).toContain("Acerto: Dono te deve R$ 50,00 → você deve R$ 43,00 a Dono.");
  });

  it("o mês do valor aparece quando é diferente do mês da compra", async () => {
    // Cartão A fecha dia 24: compra em 28/10 só entra em novembro
    await createReceivable(owner, { person: "Ana", description: "Farmácia", amount_cents: 2500, date: "2026-10-28", account_id: 1 });
    const text = await mcp(2, "listar_minhas_dividas");
    expect(text).toMatch(/Farmácia: R\$ 25,00 \(28\/10\/2026, mês nov\/26\)/);
    expect(text).toMatch(/Jantar: R\$ 93,00 \(10\/10\/2026\)/);
  });
});
