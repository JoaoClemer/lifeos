// Ferramentas do LifeOS chamadas pelo protocolo MCP, como o Claude faz (com o "hoje" real do servidor).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, startOfWeek } from "../../src/shared/datetime";
import { todayIn } from "../../src/shared/month";
import app from "../../src/worker/index";
import { resetFinance } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

const today = todayIn("America/Sao_Paulo");

beforeEach(async () => {
  await resetFinance(env.DB);
  await resetLifeOS(env.DB);
});

let rpcId = 0;
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const res = await app.request(
    `/mcp/${env.MCP_TOKEN}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) },
    env,
  );
  return ((await res.json()) as { result: Record<string, unknown> }).result;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await rpc("tools/call", { name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return { text: r.content[0].text, isError: !!r.isError };
}

const count = async (table: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
const idOf = (text: string, kind: string) => Number(new RegExp(`\\[${kind} (\\d+)`).exec(text)![1]);

describe("catálogo", () => {
  it("expõe as ferramentas do LifeOS com descrição e marca as de leitura e as destrutivas", async () => {
    const { tools } = (await rpc("tools/list")) as { tools: { name: string; description: string; annotations?: Record<string, boolean> }[] };
    const byName = new Map(tools.map((t) => [t.name, t]));
    const lifeos = [
      "revisao_diaria",
      "revisao_semanal",
      "agenda",
      "criar_evento",
      "editar_evento",
      "cancelar_evento",
      "responder_convite",
      "listar_tarefas",
      "criar_tarefa",
      "concluir_tarefa",
      "editar_tarefa",
      "remover_tarefa",
      "criar_projeto",
      "compartilhar_projeto",
      "treinos_semana",
      "planejar_treino",
      "registrar_treino",
      "status_treino",
      "remover_treino",
      // Dívidas conectadas (fase 3 do LifeOS para várias pessoas)
      "listar_minhas_dividas",
      "marcar_paguei",
      "contestar_divida",
      "ligar_devedor",
      "compartilhar_meta",
    ];
    expect(tools.map((t) => t.name).slice(19)).toEqual(lifeos);
    for (const n of ["revisao_diaria", "revisao_semanal", "agenda", "listar_tarefas", "treinos_semana", "listar_minhas_dividas"])
      expect(byName.get(n)!.annotations?.readOnlyHint).toBe(true);
    for (const n of ["cancelar_evento", "remover_tarefa", "remover_treino"]) expect(byName.get(n)!.annotations?.destructiveHint).toBe(true);
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
  });
});

describe("tarefas", () => {
  it("criar duas vezes seguidas não duplica; concluir e reabrir pelo título; tudo auditado como mcp", async () => {
    const first = await call("criar_tarefa", { titulo: "Pagar IPTU", prazo: "amanhã", prioridade: "alta", subtarefas: ["Emitir boleto"] });
    expect(first.text).toContain("✅ Tarefa criada");
    expect(first.text).toContain("subtarefas 0/1");
    const again = await call("criar_tarefa", { titulo: "pagar iptu" });
    expect(again.text).toContain("Já existia");
    expect(await count("tasks")).toBe(2); // a tarefa e a subtarefa

    expect((await call("concluir_tarefa", { tarefa: "pagar iptu" })).text).toContain("✅ Tarefa concluída");
    expect((await call("concluir_tarefa", { tarefa: "pagar iptu" })).text).toContain("já estava concluída");
    expect((await call("concluir_tarefa", { tarefa: "Pagar IPTU", reabrir: true })).text).toContain("reaberta");

    const history = await env.DB.prepare("SELECT action, source FROM activity_log WHERE entity = 'task' ORDER BY id").all();
    expect(history.results).toEqual([
      { action: "task.completed", source: "mcp" },
      { action: "task.reopened", source: "mcp" },
    ]);
    const audits = await env.DB.prepare("SELECT detail FROM activity_log WHERE action = 'mcp.call' ORDER BY id").all<{ detail: string }>();
    expect(audits.results.map((r) => JSON.parse(r.detail).tool)).toEqual(["criar_tarefa", "criar_tarefa", "concluir_tarefa", "concluir_tarefa", "concluir_tarefa"]);
  });

  it("tarefa que se repete: criar, concluir mostra a próxima, parar de repetir", async () => {
    const created = await call("criar_tarefa", { titulo: "Pagar a diarista", repetir: { frequencia: "semanal", dias_semana: ["sex"] } });
    expect(created.text).toContain("repete toda semana (sex)");
    const id = idOf(created.text, "tarefa");
    const done = await call("concluir_tarefa", { tarefa: String(id) });
    expect(done.text).toContain("✅ Tarefa concluída");
    expect(done.text).toMatch(/Próxima: \[tarefa \d+\] Pagar a diarista · prazo/);
    expect(await count("tasks")).toBe(2);
    const nextId = Number(/Próxima: \[tarefa (\d+)/.exec(done.text)![1]);
    expect((await call("editar_tarefa", { tarefa: String(nextId), parar_de_repetir: true })).text).not.toContain("repete");
    expect((await call("concluir_tarefa", { tarefa: String(nextId) })).text).not.toContain("Próxima");
    expect(await count("tasks")).toBe(2);
    expect((await call("criar_tarefa", { titulo: "X", repetir: { frequencia: "diaria", vezes: 3 } })).text).toContain("número de vezes");
  });

  it("remover exige confirmação: sem confirmar só mostra a prévia", async () => {
    const id = idOf((await call("criar_tarefa", { titulo: "Rascunho" })).text, "tarefa");
    const preview = await call("remover_tarefa", { tarefa: String(id) });
    expect(preview).toMatchObject({ isError: false });
    expect(preview.text).toContain("Confirmação necessária");
    expect(await count("tasks")).toBe(1);
    expect((await call("remover_tarefa", { tarefa: String(id), confirmar: true })).text).toContain("excluída");
    expect(await count("tasks")).toBe(0);
  });

  it("parâmetros inválidos voltam como erro claro e ficam na auditoria", async () => {
    const r = await call("criar_tarefa", { titulo: "X", prazo: "32/13" });
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toContain("Data inválida");
    const audit = await env.DB.prepare("SELECT detail FROM activity_log WHERE action = 'mcp.call'").first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toMatchObject({ tool: "criar_tarefa", ok: false });
    // Consultas não são auditadas
    await call("listar_tarefas");
    expect(await count("activity_log")).toBe(1);
  });
});

describe("agenda", () => {
  it("evento que se repete: listar ocorrências, editar só uma e cancelar com alcance e confirmação", async () => {
    const monday = addDays(startOfWeek(today), 7);
    const created = await call("criar_evento", {
      titulo: "Inglês",
      data: monday,
      hora_inicio: "19h",
      duracao_min: 90,
      repetir: { frequencia: "semanal", dias_semana: ["seg", "qua"] },
    });
    expect(created.text).toContain("repete: FREQ=WEEKLY;BYDAY=MO,WE");
    const id = idOf(created.text, "evento");
    expect((await call("criar_evento", { titulo: "Inglês", data: monday, hora_inicio: "19:00" })).text).toContain("Já existia");

    const wed = addDays(monday, 2);
    const agenda = await call("agenda", { de: monday, ate: wed });
    expect(agenda.text).toContain(`19:00–20:30 Inglês [evento ${id}, ocorrência ${wed}T19:00, repete]`);

    const noScope = await call("editar_evento", { evento: id, ocorrencia: `${wed}T19:00`, hora_inicio: "18h30" });
    expect(noScope.isError).toBe(true);
    expect(noScope.text).toContain("informe se a mudança vale");
    const edited = await call("editar_evento", { evento: id, ocorrencia: `${wed}T19:00`, alcance: "so_esta", hora_inicio: "18h30" });
    expect(edited.text).toContain("18:30–20:00");
    expect(edited.text).toContain("só esta ocorrência");

    const preview = await call("cancelar_evento", { evento: id, ocorrencia: `${monday}T19:00`, alcance: "todas" });
    expect(preview.text).toContain("Confirmação necessária: excluir todas as ocorrências");
    expect(await count("events")).toBe(2);
    await call("cancelar_evento", { evento: id, ocorrencia: `${monday}T19:00`, alcance: "todas", confirmar: true });
    expect(await count("events")).toBe(0);
  });

  it("reservar horário para uma tarefa liga o evento à tarefa (sem criar outra tarefa)", async () => {
    await call("criar_tarefa", { titulo: "Estudar para a prova" });
    const r = await call("criar_evento", { titulo: "Estudar", data: "amanhã", hora_inicio: "14h", hora_fim: "16h", tarefa: "estudar para a prova" });
    expect(r.text).toContain('horário para a tarefa "Estudar para a prova"');
    expect(await count("tasks")).toBe(1);
    expect((await call("agenda", { periodo: "amanha" })).text).toContain("14:00–16:00 Estudar — horário para a tarefa");
  });

  it("dia inteiro quando não há horário", async () => {
    expect((await call("criar_evento", { titulo: "Feriado", data: "hoje" })).text).toContain("dia inteiro");
  });
});

describe("treinos e revisões", () => {
  it("planejar, registrar no planejado sem duplicar e ver a semana", async () => {
    const plan = await call("planejar_treino", { modalidade: "corrida", data: "hoje", horario: "6h30", tipo: "leve", duracao_min: 50, distancia_km: 8 });
    expect(plan.text).toContain("✅ Treino planejado");
    expect((await call("planejar_treino", { modalidade: "corrida", data: "hoje", horario: "06:30" })).text).toContain("Já existia");

    const done = await call("registrar_treino", { modalidade: "corrida", duracao: "52:10", distancia_km: 8.2, esforco: 6 });
    expect(done.text).toContain("no treino planejado do dia");
    expect(done.text).toContain("6:22/km");
    expect(await count("training_sessions")).toBe(1);
    const extra = await call("registrar_treino", { modalidade: "natacao", duracao: 30, distancia_m: 1000 });
    expect(extra.text).toContain("(sem plano)");

    const week = await call("treinos_semana");
    expect(week.text).toContain("Corrida");
    expect(week.text).toContain("feito: 8,2 km, 52:10");
  });

  it("revisão do dia e da semana reúnem agenda, tarefas, treino e finanças", async () => {
    await call("criar_evento", { titulo: "Dentista", data: "hoje", hora_inicio: "23h" });
    await call("criar_tarefa", { titulo: "Ligar para o banco", prazo: "hoje" });
    const day = await call("revisao_diaria");
    expect(day.text).toContain("Dentista");
    expect(day.text).toContain("Ligar para o banco");
    expect(day.text).toContain("Treino de hoje:");
    expect(day.text).toMatch(/Finanças de .+: gastos R\$/);
    const week = await call("revisao_semanal");
    expect(week.text).toContain("Compromissos: 1");
    expect(week.text).toContain("Abertas com prazo na semana: 1");
  });
});
