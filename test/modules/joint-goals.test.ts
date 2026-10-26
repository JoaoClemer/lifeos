// Metas em conjunto: o saldo é de todos; cada pessoa tem o próprio aporte planejado e, no resumo dela, entram só os aportes dela.
// Pessoa 1 (fixture) cria a meta; pessoa 2 ("Ana", conectada) participa; pessoa 3 não está conectada.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addMonths } from "../../src/shared/month";
import { handleMcpRequest } from "../../src/worker/mcp/server";
import { removeConnection } from "../../src/worker/modules/connections/service";
import { getMonthBalance } from "../../src/worker/services/balance";
import * as goals from "../../src/worker/services/goals";
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

async function trip() {
  const g = await goals.createGoal(owner, { name: "Viagem de casal", target_cents: 600000, monthly_cents: 50000, start_month: "2026-09" });
  await goals.setGoalMembers(owner, g.id, [2]);
  await goals.setMyPlan(ana, g.id, { monthly_cents: 30000 });
  return g;
}

describe("meta em conjunto", () => {
  it("quem participa vê a meta, tem o próprio aporte planejado e o saldo é de todos", async () => {
    const g = await trip();
    await goals.addGoalEntry(ana, g.id, { kind: "contribution", amount_cents: 30000, month: MONTH });
    await goals.addGoalEntry(owner, g.id, { kind: "contribution", amount_cents: 20000, month: MONTH });

    const forAna = await goals.getGoal(ana, g.id, MONTH);
    expect(forAna).toMatchObject({ owner: { id: 1, name: "Dono" }, monthly_cents: 30000, balance_cents: 50000, month_contrib_cents: 30000, month_planned_cents: 30000 });
    expect(forAna.members.map((m) => [m.name, m.role, m.monthly_cents, m.month_contrib_cents])).toEqual([
      ["Dono", "owner", 50000, 20000],
      ["Ana Souza", "member", 30000, 30000],
    ]);
    const forOwner = await goals.getGoal(owner, g.id, MONTH);
    expect(forOwner).toMatchObject({ owner: null, monthly_cents: 50000, balance_cents: 50000, month_contrib_cents: 20000 });
    // Previsão com o aporte dos dois (80 mil/mês): faltam 5.500,00
    expect(forOwner.eta_month).toBe(addMonths(MONTH, Math.ceil(550000 / 80000) - 1));

    const entries = await goals.listGoalEntries(owner, g.id);
    expect(entries.map((e) => [e.amount_cents, e.author, e.mine])).toEqual(
      expect.arrayContaining([
        [30000, "Ana Souza", false],
        [20000, null, true],
      ]),
    );
  });

  it("no resumo de cada pessoa entram só os aportes dela, e o saldo acumulado usa a mesma regra", async () => {
    const ownerBefore = await getSummary(owner, MONTH);
    const g = await trip();
    await goals.addGoalEntry(ana, g.id, { kind: "contribution", amount_cents: 10000, month: MONTH });
    const s = await getSummary(ana, MONTH);
    expect([s.totals.goals_planned_cents, s.totals.goals_done_cents]).toEqual([30000, 10000]);
    expect(s.totals.leftover_cents).toBe(300000 - 30000);
    for (let m = "2026-09"; m <= "2027-03"; m = addMonths(m, 1)) {
      const [sum, bal] = await Promise.all([getSummary(ana, m), getMonthBalance(ana, m)]);
      expect(bal?.leftover_cents, m).toBe(sum.totals.leftover_cents);
    }
    // Para quem criou: entra o aporte dele (50 mil), não o da Ana
    const ownerAfter = await getSummary(owner, MONTH);
    expect(ownerAfter.totals.goals_planned_cents - ownerBefore.totals.goals_planned_cents).toBe(50000);
    expect(ownerAfter.totals.goals_done_cents).toBe(ownerBefore.totals.goals_done_cents);
    for (let m = "2026-09"; m <= "2027-03"; m = addMonths(m, 1)) {
      const [sum, bal] = await Promise.all([getSummary(owner, m), getMonthBalance(owner, m)]);
      expect(bal?.leftover_cents, m).toBe(sum.totals.leftover_cents);
    }
  });

  it("só quem criou altera, exclui e define quem participa; só pessoas conectadas", async () => {
    const g = await trip();
    await expect(goals.updateGoal(ana, g.id, { name: "Minha" })).rejects.toThrow("Só Dono");
    await expect(goals.deleteGoal(ana, g.id)).rejects.toThrow("Só Dono");
    await expect(goals.setGoalMembers(ana, g.id, [])).rejects.toThrow("Só Dono");
    await expect(goals.setGoalMembers(owner, g.id, [3])).rejects.toThrow("conectadas");
    await expect(goals.getGoal(third, g.id)).rejects.toThrow("não encontrada");
    const entry = await goals.addGoalEntry(owner, g.id, { kind: "contribution", amount_cents: 100 });
    await expect(goals.deleteGoalEntry(ana, entry.id)).rejects.toThrow("não encontrada");
  });

  it("sair ou desconectar tira o acesso; os aportes continuam no saldo", async () => {
    const g = await trip();
    await goals.addGoalEntry(ana, g.id, { kind: "contribution", amount_cents: 30000 });
    await goals.leaveGoal(ana, g.id);
    await expect(goals.getGoal(ana, g.id)).rejects.toThrow("não encontrada");
    expect((await goals.getGoal(owner, g.id)).balance_cents).toBe(30000);

    await goals.setGoalMembers(owner, g.id, [2]);
    expect((await goals.listGoals(ana, MONTH)).map((x) => x.name)).toEqual(["Viagem de casal"]);
    await removeConnection(owner, 2);
    expect(await goals.listGoals(ana, MONTH)).toEqual([]);
  });

  it("metas só suas continuam como sempre (sem membros, mesmos números)", async () => {
    const [reserva] = await goals.listGoals(owner, MONTH);
    expect(reserva).toMatchObject({ name: "Reserva", owner: null, members: [] });
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

  it("compartilha a meta, a outra pessoa define o aporte dela e registra", async () => {
    await mcp(1, "criar_meta", { nome: "Viagem de casal", valor_alvo: 6000, aporte_mensal: 500 });
    expect(await mcp(1, "compartilhar_meta", { meta: "Viagem de casal", adicionar: ["Ana Souza"] })).toContain("em conjunto com: Ana Souza");
    expect(await mcp(2, "compartilhar_meta", { meta: "Viagem de casal", meu_aporte_mensal: 300 })).toMatch(/Seu aporte mensal .*R\$\s300,00/);
    expect(await mcp(2, "registrar_aporte", { meta: "Viagem de casal", valor: 300 })).toContain("Viagem de casal");
    const list = await mcp(2, "listar_metas", {});
    expect(list).toContain("em conjunto (meta de Dono) com Dono");
    expect(await mcp(1, "listar_metas", {})).toContain("em conjunto com Ana Souza");
  });
});
