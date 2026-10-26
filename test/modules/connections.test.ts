// Conexões e dívidas conectadas: o nome dos seus devedores ligado à conta de uma pessoa conectada.
// A pessoa 1 (dona da fixture) tem a receber; a pessoa 2 ("Ana", conectada) deve; a pessoa 3 não está conectada.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addMonths } from "../../src/shared/month";
import { handleMcpRequest } from "../../src/worker/mcp/server";
import * as connections from "../../src/worker/modules/connections/service";
import { getMonthBalance } from "../../src/worker/services/balance";
import { createExpense } from "../../src/worker/services/expenses";
import * as payables from "../../src/worker/services/payables";
import { createReceivable, listReceivables, markReceived, resolveDispute, updateReceivable } from "../../src/worker/services/receivables";
import { getSummary } from "../../src/worker/services/summary";
import { MONTH, resetFinance, testCtx, TODAY } from "../fixtures/finance";

const owner = testCtx(env.DB);
const ana = testCtx(env.DB, TODAY, "10:00", 2);
const third = testCtx(env.DB, TODAY, "10:00", 3);

beforeEach(async () => {
  await resetFinance(env.DB);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET name = 'Dono' WHERE id = 1"),
    env.DB.prepare("INSERT INTO users (id, name, role) VALUES (2, 'Ana Souza', 'member'), (3, 'Terceira', 'member')"),
    env.DB.prepare("INSERT INTO connections (user_a, user_b) VALUES (1, 2)"),
    env.DB.prepare("INSERT INTO user_settings (user_id, key, value) VALUES (2, 'income_cents', '300000'), (2, 'balance_start_month', '2026-09')"),
  ]);
});

const link = () => connections.linkPerson(owner, { person: "Ana", user_id: 2 });

describe("ligar devedor à conta", () => {
  it("o histórico e os próximos lançamentos com o nome aparecem para quem deve, sem dados internos", async () => {
    expect(await payables.listPayables(ana)).toEqual([]);
    expect(await link()).toEqual({ person_key: "ANA", linked_user_id: 2, linked_name: "Ana Souza" });

    const [jantar] = await payables.listPayables(ana);
    expect(jantar).toEqual({
      id: 1,
      creditor_id: 1,
      creditor_name: "Dono",
      description: "Jantar",
      amount_cents: 9300,
      date: "2026-10-10",
      month: "2026-10",
      installment_no: null,
      installment_total: null,
      received_at: null,
      paid_claimed_at: null,
      disputed_at: null,
      dispute_note: null,
      due: true,
    });

    // Lançamentos novos com o nome (qualquer grafia) já nascem ligados
    await createExpense(owner, { description: "Pizza", amount_cents: 6000, account_id: 1, splits: [{ person: "ana", amount_cents: 3000 }] });
    await createReceivable(owner, { person: "ANA", description: "Show", total_cents: 30000, installments: 3, account_id: 2 });
    const all = await payables.listPayables(ana);
    expect(all.filter((p) => p.description === "Pizza").map((p) => p.amount_cents)).toEqual([3000]);
    expect(all.filter((p) => p.description === "Show").map((p) => [p.installment_no, p.amount_cents])).toEqual(
      expect.arrayContaining([
        [1, 10000],
        [2, 10000],
        [3, 10000],
      ]),
    );
    // Parcelas de meses futuros ainda não venceram
    expect(all.filter((p) => p.description === "Show" && p.month > MONTH).every((p) => !p.due)).toBe(true);
    // Outras pessoas da dona continuam invisíveis
    expect(all.some((p) => p.description === "Celular")).toBe(false);
  });

  it("só dá para ligar a uma pessoa conectada", async () => {
    await expect(connections.linkPerson(owner, { person: "Ana", user_id: 3 })).rejects.toThrow("não está conectada");
    await expect(connections.linkPerson(owner, { person: "Ana", user_id: 1 })).rejects.toThrow("sua própria conta");
  });

  it("desligar, mudar o nome do item ou desconectar escondem os itens de quem deve", async () => {
    await link();
    await updateReceivable(owner, 1, { person: "Pedro" });
    expect(await payables.listPayables(ana)).toEqual([]);
    await updateReceivable(owner, 1, { person: "Ana" });
    expect(await payables.listPayables(ana)).toHaveLength(1);

    await connections.unlinkPerson(owner, "Ana");
    expect(await payables.listPayables(ana)).toEqual([]);

    await link();
    await connections.removeConnection(ana, 1);
    expect(await payables.listPayables(ana)).toEqual([]);
    expect(await connections.listPersonLinks(owner)).toEqual([]);
    // A dívida continua com quem tem a receber
    expect((await listReceivables(owner, { person: "Ana" })).map((r) => r.amount_cents)).toEqual([9300]);
  });
});

describe("o que se deve conta nos gastos de quem deve", () => {
  it("entra no total do mês da fatura e no saldo acumulado; o resumo de quem tem a receber não muda", async () => {
    const ownerBefore = await getSummary(owner, MONTH);
    const before = await getSummary(ana, MONTH);
    expect(before.totals.total_cents).toBe(0);

    await link();
    await createReceivable(owner, { person: "Ana", description: "Show", total_cents: 30000, installments: 3, account_id: 2 });
    const s = await getSummary(ana, MONTH);
    // Jantar (9300, out/26) + 1ª parcela do show (10000) no mês da fatura do cartão B
    const showMonth = (await payables.listPayables(ana)).find((p) => p.description === "Show" && p.installment_no === 1)!.month;
    const expected = 9300 + (showMonth === MONTH ? 10000 : 0);
    expect(s.totals.payables_month_cents).toBe(expected);
    expect(s.totals.total_cents).toBe(expected);
    expect(s.totals.leftover_cents).toBe(300000 - expected);
    expect(s.owed_by_person).toEqual([{ user_id: 1, person: "Dono", total_cents: expected, count: expected === 9300 ? 1 : 2 }]);

    // O saldo acumulado usa a mesma regra
    for (let m = "2026-09"; m <= "2027-02"; m = addMonths(m, 1)) {
      const [sum, bal] = await Promise.all([getSummary(ana, m), getMonthBalance(ana, m)]);
      expect(bal?.leftover_cents, m).toBe(sum.totals.leftover_cents);
    }
    // Quem tem a receber: só ganhou o devedor novo (o resumo dela não muda por ligar o nome)
    const ownerAfter = await getSummary(owner, MONTH);
    expect(ownerAfter.totals.total_cents).toBe(ownerBefore.totals.total_cents);
  });
});

describe("paguei, confirmação e contestação", () => {
  it("quem deve marca que pagou, quem tem a receber confirma; voltar para pendente desfaz o paguei", async () => {
    await link();
    const [claimed] = await payables.markPaid(ana, { ids: [1] });
    expect(claimed.paid_claimed_at).toBe(TODAY);
    expect((await listReceivables(owner, { person: "Ana" }))[0].paid_claimed_at).toBe(TODAY);

    await markReceived(owner, { ids: [1] });
    expect(await payables.listPayables(ana)).toEqual([]);
    expect((await payables.listPayables(ana, { status: "received" }))[0].received_at).toBe(TODAY);
    // Recebido não aceita mais "paguei" nem contestação
    await expect(payables.markPaid(ana, { ids: [1] })).rejects.toThrow("não encontrada");
    await expect(payables.disputePayable(ana, 1, { note: "x" })).rejects.toThrow("não encontrada");

    await markReceived(owner, { ids: [1], undo: true });
    expect((await payables.listPayables(ana))[0].paid_claimed_at).toBeNull();
  });

  it("paguei tudo com uma pessoa marca só o que já venceu", async () => {
    await link();
    await createReceivable(owner, { person: "Ana", description: "Show", total_cents: 30000, installments: 3, current_installment: 1, month: MONTH });
    const done = await payables.markPaid(ana, { creditor_id: 1 });
    expect(done.map((d) => d.description).sort()).toEqual(["Jantar", "Show"]);
    expect((await payables.listPayables(ana)).filter((p) => !p.paid_claimed_at)).toHaveLength(2);
  });

  it("quem deve contesta com um motivo; quem tem a receber vê e resolve", async () => {
    await link();
    await payables.disputePayable(ana, 1, { note: "Foi 80, não 93" });
    const [r] = await listReceivables(owner, { person: "Ana" });
    expect([r.disputed_at !== null, r.dispute_note]).toEqual([true, "Foi 80, não 93"]);
    await resolveDispute(owner, 1);
    expect((await payables.listPayables(ana))[0].dispute_note).toBeNull();
  });

  it("quem deve não altera valores nem vê dívidas de outros; quem não está ligado não vê nada", async () => {
    await link();
    await expect(updateReceivable(ana, 1, { amount_cents: 1 })).rejects.toThrow("não encontrado");
    await expect(payables.markPaid(ana, { ids: [2] })).rejects.toThrow("não encontrada"); // Pedro
    expect(await payables.listPayables(third)).toEqual([]);
    await expect(payables.disputePayable(third, 1, { note: "x" })).rejects.toThrow("não encontrada");
  });
});

describe("link de conexão", () => {
  it("conecta duas pessoas que já têm conta; vale uma vez e não serve para si mesmo", async () => {
    const created = await connections.createConnectionLink(third, "http://localhost");
    const token = created.url.split("#/conectar/")[1];
    await expect(connections.inspectConnectionLink(third, { token })).rejects.toThrow("é seu");
    expect(await connections.inspectConnectionLink(ana, { token })).toEqual({ user_id: 3, name: "Terceira" });
    expect(await connections.acceptConnectionLink(ana, { token })).toMatchObject({ user_id: 3, name: "Terceira" });
    expect((await connections.listConnections(ana)).map((c) => c.user_id)).toEqual([1, 3].sort());
    await expect(connections.acceptConnectionLink(owner, { token })).rejects.toThrow("não vale mais");
  });
});

describe("pelo MCP", () => {
  const mcp = async (userId: number, name: string, args: Record<string, unknown>) => {
    const req = new Request("http://test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const { result } = (await (await handleMcpRequest(req, env, userId)).json()) as { result: { content: { text: string }[] } };
    return result.content[0].text;
  };

  it("liga, lista o que deve, marca paguei e quem tem a receber vê que está aguardando", async () => {
    expect(await mcp(1, "ligar_devedor", { pessoa: "Ana", conta: "Ana Souza" })).toContain("ligado(a) à conta de Ana Souza");
    expect(await mcp(2, "listar_minhas_dividas", {})).toContain("Jantar");
    expect(await mcp(2, "marcar_paguei", { pessoa: "Dono" })).toContain("Agora Dono precisa confirmar");
    expect(await mcp(1, "listar_devedores", {})).toContain("Ana disse que pagou");
    // formatBRL usa espaço não separável entre "R$" e o valor
    expect(await mcp(2, "resumo_mes", { mes: MONTH })).toMatch(/Devo a pessoas: R\$\s93,00/);
    // Para quem não deve nada, o resumo não ganha linhas novas
    expect(await mcp(1, "resumo_mes", { mes: MONTH })).not.toContain("Devo a pessoas");
  });
});
