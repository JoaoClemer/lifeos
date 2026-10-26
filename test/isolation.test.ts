// Isolamento entre pessoas: a pessoa 2 não vê nem altera nada da pessoa 1, por nenhuma rota da API nem ferramenta do MCP,
// mesmo usando os ids e os nomes dela. E a pessoa 1 não vê o que a pessoa 2 cria.
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../src/worker/api";
import { onAppError } from "../src/worker/errors";
import { type AppEnv, makeCtx } from "../src/worker/lib";
import { handleMcpRequest } from "../src/worker/mcp/server";
import { getSummary } from "../src/worker/services/summary";
import { MONTH, resetFinance, testCtx } from "./fixtures/finance";
import { resetLifeOS } from "./fixtures/lifeos";
import { OWNED_TABLES } from "./ownerGuard";

const OWNER = 1;
const OTHER = 2;

/** Dados da pessoa 1 no LifeOS, com textos marcados para detectar vazamento. Ids fixos (1, 2, 3) como na fixture de finanças. */
const LIFEOS_SEED = [
  "INSERT INTO projects (id, user_id, name) VALUES (1, 1, 'Projeto Segredo')",
  `INSERT INTO tasks (id, user_id, title, project_id, due_date, tags) VALUES (1, 1, 'Tarefa Segredo', 1, '2026-10-15', '["etiqueta-segredo"]')`,
  "INSERT INTO tasks (id, user_id, title, parent_id) VALUES (2, 1, 'Subtarefa Segredo', 1)",
  "INSERT INTO tasks (id, user_id, title, due_date, rrule) VALUES (3, 1, 'Rotina Segredo', '2026-10-15', 'FREQ=WEEKLY;BYDAY=MO')",
  `INSERT INTO events (id, user_id, title, start_at, end_at, category, location)
     VALUES (1, 1, 'Evento Segredo', '2026-10-15T10:00', '2026-10-15T11:00', 'categoria-segredo', 'Local Segredo')`,
  "INSERT INTO events (id, user_id, title, start_at, end_at, rrule) VALUES (2, 1, 'Série Segredo', '2026-10-01T08:00', '2026-10-01T09:00', 'FREQ=WEEKLY;BYDAY=TH')",
  `INSERT INTO events (id, user_id, title, start_at, end_at, series_id, original_start)
     VALUES (3, 1, 'Exceção Segredo', '2026-10-08T09:00', '2026-10-08T10:00', 2, '2026-10-08T08:00')`,
  "INSERT INTO training_sessions (id, user_id, sport, title, date, instructions) VALUES (1, 1, 'run', 'Treino Segredo', '2026-10-15', 'Instrução Segredo')",
  `INSERT INTO activity_log (user_id, source, action, detail) VALUES (1, 'app', 'teste', '{"nota":"Histórico Segredo"}')`,
  // Login da pessoa 1: uma passkey e um conector do Claude (id 1)
  "INSERT INTO passkeys (id, user_id, public_key, device) VALUES ('passkey-pessoa-1', 1, 'chave', 'Aparelho Segredo')",
  "INSERT INTO mcp_tokens (id, user_id, token_hash, name) VALUES (1, 1, 'hash-pessoa-1', 'Conector Segredo')",
];

beforeEach(async () => {
  await resetFinance(env.DB);
  await resetLifeOS(env.DB);
  await env.DB.batch([env.DB.prepare("DELETE FROM passkeys"), env.DB.prepare("DELETE FROM mcp_tokens"), env.DB.prepare("DELETE FROM invites")]);
  await env.DB.batch([
    ...LIFEOS_SEED.map((s) => env.DB.prepare(s)),
    env.DB.prepare("INSERT INTO users (id, name, role) VALUES (2, 'Outra pessoa', 'member')"),
  ]);
});

/** Tudo o que é de uma pessoa, tabela por tabela (com o perfil e os acessos dela). */
async function dataOf(userId: number): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of OWNED_TABLES) out[t] = (await env.DB.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY rowid`).bind(userId).all()).results;
  out.users = (await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).all()).results;
  for (const t of ["passkeys", "mcp_tokens"]) out[t] = (await env.DB.prepare(`SELECT * FROM ${t} WHERE user_id = ? ORDER BY rowid`).bind(userId).all()).results;
  return out;
}

const TEXT_COLUMNS = ["name", "description", "title", "person", "note", "notes", "institution", "location", "instructions", "category", "detail", "device"];
/** Textos que o próprio sistema grava (iguais para todo mundo). */
const SYSTEM_TEXTS = new Set(["Saldo inicial", "Atualização de saldo"]);

/** Textos da pessoa (nomes, descrições, títulos...) que não podem aparecer para outra pessoa. */
async function textsOf(userId: number): Promise<string[]> {
  const texts = new Set<string>();
  const { users: _profile, ...data } = await dataOf(userId);
  for (const rows of Object.values(data)) {
    for (const row of rows as Record<string, unknown>[]) {
      for (const col of TEXT_COLUMNS) {
        const v = row[col];
        if (typeof v !== "string" || v.length < 4) continue;
        // detail do histórico é JSON: confere os valores de texto dentro dele
        if (col === "detail") for (const m of v.matchAll(/"([^"]{4,})"/g)) texts.add(m[1]);
        else if (!SYSTEM_TEXTS.has(v)) texts.add(v);
      }
    }
  }
  return [...texts];
}

/** Falha se a resposta mostrar algum texto da outra pessoa (menos os que a própria chamada informou). */
function expectNoLeak(body: string, texts: string[], label: string, echoed: unknown[] = []) {
  const informed = new Set(echoed.filter((v): v is string => typeof v === "string"));
  const leaked = texts.filter((t) => !informed.has(t) && body.includes(t));
  expect(leaked, `${label} mostrou dados de outra pessoa`).toEqual([]);
}

/** A API autenticada como `userId` (a pessoa 1 é admin; as outras, não). */
function apiAs(userId: number) {
  const app = new Hono<AppEnv>();
  app.onError(onAppError);
  app.use(async (c, next) => {
    c.set("userId", userId);
    c.set("role", userId === OWNER ? "admin" : "member");
    c.set("timezone", null);
    await next();
  });
  app.route("/api", api);
  return app;
}

async function mcpAs(userId: number, name: string, args: Record<string, unknown>): Promise<string> {
  const req = new Request("http://test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const res = await handleMcpRequest(req, env, userId);
  const { result } = (await res.json()) as { result: { content: { text: string }[] } };
  return result.content.map((c) => c.text).join("\n");
}

const GET_QUERY = `?month=${MONTH}&from=2026-10-01&to=2026-10-31&date=2026-10-15&status=all&all=1`;

/**
 * Corpo de cada rota que altera dados e o status esperado para a pessoa 2.
 * Ids nas URLs são sempre 1 (existe em todas as tabelas da pessoa 1). Referências a dados da pessoa 1 no corpo: 404.
 */
const MUTATIONS: Record<string, { body?: unknown; status: number }> = {
  "PUT /settings": { body: { default_account_id: 1 }, status: 404 },
  "POST /accounts": { body: { name: "Conta da pessoa 2" }, status: 201 },
  "PATCH /accounts/:id": { body: { name: "x" }, status: 404 },
  "DELETE /accounts/:id": { status: 404 },
  "POST /expenses": { body: { description: "x", amount_cents: 100, account_id: 1 }, status: 404 },
  "PATCH /expenses/:id": { body: { description: "x" }, status: 404 },
  "DELETE /expenses/:id": { status: 404 },
  "POST /installments": { body: { description: "x", total_installments: 2, installment_cents: 100, account_id: 1 }, status: 404 },
  "PATCH /installments/:id": { body: { description: "x" }, status: 404 },
  "DELETE /installments/:id": { status: 404 },
  "POST /recurring": { body: { description: "x", amount_cents: 100, account_id: 1 }, status: 404 },
  "PATCH /recurring/:id": { body: { description: "x" }, status: 404 },
  "DELETE /recurring/:id": { status: 404 },
  "PUT /recurring/:id/months/:month": { body: { paid: true }, status: 404 },
  "POST /receivables": { body: { person: "Ana", description: "x", amount_cents: 100, account_id: 1 }, status: 404 },
  "POST /receivables/mark-received": { body: { ids: [1] }, status: 404 },
  "PATCH /receivables/:id": { body: { description: "x" }, status: 404 },
  "DELETE /receivables/:id": { status: 404 },
  // Saldo ajustado é por pessoa: a pessoa 2 ajusta o dela (o da pessoa 1 em 2026-11 continua igual)
  "PUT /balances/:month": { body: { opening_cents: 5 }, status: 200 },
  "DELETE /balances/:month": { status: 200 },
  "POST /incomes": { body: { description: "x", amount_cents: 100 }, status: 201 },
  "PATCH /incomes/:id": { body: { description: "x" }, status: 404 },
  "DELETE /incomes/:id": { status: 404 },
  "POST /goals": { body: { name: "x" }, status: 201 },
  "PATCH /goals/:id": { body: { name: "x" }, status: 404 },
  "DELETE /goals/:id": { status: 404 },
  "POST /goals/:id/entries": { body: { kind: "contribution", amount_cents: 100 }, status: 404 },
  "POST /goals/:id/balance": { body: { balance_cents: 100 }, status: 404 },
  "POST /goals/:id/check": { body: { month: MONTH }, status: 404 },
  "DELETE /goal-entries/:id": { status: 404 },
  "POST /tasks": { body: { title: "x", project_id: 1 }, status: 404 },
  "PATCH /tasks/:id": { body: { title: "x" }, status: 404 },
  "DELETE /tasks/:id": { status: 404 },
  "POST /projects": { body: { name: "x" }, status: 201 },
  "PATCH /projects/:id": { body: { name: "x" }, status: 404 },
  "DELETE /projects/:id": { status: 404 },
  "POST /events": { body: { title: "x", start: "2026-10-20T10:00", task_id: 1 }, status: 404 },
  "PATCH /events/:id": { body: { title: "x" }, status: 404 },
  "DELETE /events/:id": { status: 404 },
  "POST /training/copy-week": { body: { from: "2026-10-12", to: "2026-10-19" }, status: 201 },
  "POST /training": { body: { sport: "run", date: "2026-10-20" }, status: 201 },
  "PATCH /training/:id": { body: { title: "x" }, status: 404 },
  "DELETE /training/:id": { status: 404 },
  // Conta da própria pessoa (a 2 mexe só na dela)
  "PATCH /me": { body: { name: "Pessoa 2" }, status: 200 },
  "POST /me/logout-all": { status: 200 },
  "DELETE /me": { body: {}, status: 400 },
  "DELETE /me/passkeys/:id": { status: 404 },
  "POST /me/passkeys/options": { status: 200 },
  "POST /me/passkeys/verify": { body: { challengeId: "x", response: { id: "passkey-pessoa-1" } }, status: 401 },
  "POST /me/mcp-tokens": { body: { name: "Claude" }, status: 201 },
  "DELETE /me/mcp-tokens/:id": { status: 404 },
  // Conexões e dívidas conectadas: a pessoa 2 não está conectada à 1
  "POST /connections/link": { status: 201 },
  "POST /connections/inspect": { body: { token: "nao-existe" }, status: 410 },
  "POST /connections/accept": { body: { token: "nao-existe" }, status: 410 },
  "DELETE /connections/:id": { status: 404 },
  "PUT /person-links": { body: { person: "Ana", user_id: 1 }, status: 404 },
  "DELETE /person-links": { body: { person: "Ana" }, status: 404 },
  "POST /receivables/:id/resolve-dispute": { status: 404 },
  "POST /payables/mark-paid": { body: { ids: [1] }, status: 404 },
  "PUT /payables/:id/dispute": { body: { note: "não é meu" }, status: 404 },
  "DELETE /payables/:id/dispute": { status: 404 },
  // Administração: só admin
  "POST /admin/invites": { body: { name: "x" }, status: 403 },
  "DELETE /admin/invites/:id": { status: 403 },
  "POST /admin/users/:id/recovery": { status: 403 },
  "POST /admin/users/:id/disable": { status: 403 },
  "POST /admin/users/:id/enable": { status: 403 },
};

/** Outras referências a dados da pessoa 1 ao criar (além das de MUTATIONS). */
const FOREIGN_REFERENCES: [string, string, unknown][] = [
  ["POST", "/expenses", { description: "x", amount_cents: 100, budget_id: 5 }],
  ["PATCH", "/expenses/1", { account_id: 1 }],
  ["POST", "/tasks", { title: "x", parent_id: 1 }],
  ["POST", "/goals/2/entries", { kind: "contribution", amount_cents: 100 }],
];

const ROUTES = [...new Map(api.routes.filter((r) => r.method !== "ALL").map((r) => [`${r.method} ${r.path}`, r])).values()];

describe("isolamento entre pessoas", () => {
  it("o teste cobre todas as rotas da API", () => {
    const mutations = ROUTES.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.path}`);
    expect(mutations.filter((k) => !MUTATIONS[k]), "rota nova: inclua em MUTATIONS").toEqual([]);
  });

  it("pela API, a pessoa 2 não vê nem altera nada da pessoa 1", async () => {
    const before = await dataOf(OWNER);
    const texts = await textsOf(OWNER);
    const app = apiAs(OTHER);
    for (const r of ROUTES) {
      const key = `${r.method} ${r.path}`;
      const path = `/api${r.path.replace(":id", "1").replace(":month", "2026-11")}`;
      const m = MUTATIONS[key];
      const res =
        r.method === "GET"
          ? await app.request(path + GET_QUERY, {}, env)
          : await app.request(path, m.body === undefined ? { method: r.method } : { method: r.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(m.body) }, env);
      const expected = r.method === "GET" ? (r.path.startsWith("/admin") ? 403 : r.path.includes(":id") ? 404 : 200) : m.status;
      expect(res.status, key).toBe(expected);
      expectNoLeak(await res.text(), texts, key);
    }
    for (const [method, path, body] of FOREIGN_REFERENCES) {
      const res = await app.request(`/api${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
      expect(res.status, `${method} ${path} ${JSON.stringify(body)}`).toBe(404);
    }
    expect(await dataOf(OWNER)).toEqual(before);
  });

  it("pelo MCP, a pessoa 2 não vê nem altera nada da pessoa 1", async () => {
    const before = await dataOf(OWNER);
    const texts = await textsOf(OWNER);
    const calls: [string, Record<string, unknown>][] = [
      ["resumo_mes", { mes: MONTH }],
      ["listar_cadastros", {}],
      ["lancar_despesa", { descricao: "x", valor: 10, conta: "Cartão A" }],
      ["lancar_despesa", { descricao: "x", valor: 10, orcamento: "Almoço" }],
      ["lancar_parcelado", { descricao: "x", parcelas: 2, valor_parcela: 10, conta: "Cartão B" }],
      ["adicionar_fixo", { descricao: "x", valor: 10, conta: "Cartão A" }],
      ["ajustar_fixo", { fixo: "Streaming", pago: true }],
      ["registrar_devedor", { pessoa: "Pedro", descricao: "x", valor: 10, conta: "Cartão A" }],
      ["marcar_recebido", { pessoa: "Pedro" }],
      ["marcar_recebido", { ids: [1, 2] }],
      ["listar_devedores", {}],
      ["listar_devedores", { pessoa: "Pedro", incluir_recebidos: true }],
      ["ajustar_saldo", { mes: "2026-11", automatico: true }],
      ["listar_lancamentos", { mes: MONTH }],
      ["listar_lancamentos", { busca: "Notebook", tipo: "todos" }],
      ["listar_lancamentos", { conta: "Cartão A" }],
      ...(["avulso", "parcelado", "fixo", "devedor", "entrada"] as const).map((tipo): [string, Record<string, unknown>] => ["editar_lancamento", { tipo, id: 1, descricao: "x" }]),
      ...(["avulso", "parcelado", "fixo", "devedor", "entrada", "meta", "movimentacao_meta"] as const).map((tipo): [string, Record<string, unknown>] => [
        "remover_lancamento",
        { tipo, id: 1 },
      ]),
      ["listar_metas", { mes: MONTH }],
      ["registrar_aporte", { meta: "Reserva", valor: 10 }],
      ["atualizar_saldo_meta", { meta: "Viagem", saldo_atual: 10 }],
      ["revisao_diaria", {}],
      ["revisao_semanal", { data: "2026-10-15" }],
      ["agenda", { de: "2026-10-01", ate: "2026-10-31" }],
      ["criar_evento", { titulo: "x", data: "2026-10-20", hora_inicio: "10:00", tarefa: "Tarefa Segredo" }],
      ["editar_evento", { evento: 1, titulo: "x" }],
      ["editar_evento", { evento: 2, ocorrencia: "2026-10-15T08:00", alcance: "todas", titulo: "x" }],
      ["cancelar_evento", { evento: 1 }],
      ["cancelar_evento", { evento: 1, confirmar: true }],
      ["cancelar_evento", { evento: 3, alcance: "so_esta", confirmar: true }],
      ["listar_tarefas", { filtro: "abertas" }],
      ["listar_tarefas", { projeto: "Projeto Segredo" }],
      ["listar_tarefas", { etiqueta: "etiqueta-segredo" }],
      ["listar_tarefas", { busca: "Segredo" }],
      ["criar_tarefa", { titulo: "x", projeto: "Projeto Segredo" }],
      ["concluir_tarefa", { tarefa: "Tarefa Segredo" }],
      ["concluir_tarefa", { tarefa: "Rotina Segredo" }],
      ["editar_tarefa", { tarefa: "Tarefa Segredo", titulo: "x" }],
      ["remover_tarefa", { tarefa: "Tarefa Segredo" }],
      ["remover_tarefa", { tarefa: "Tarefa Segredo", confirmar: true }],
      ["criar_projeto", { nome: "Projeto da pessoa 2" }],
      ["treinos_semana", { data: "2026-10-15" }],
      ["planejar_treino", { modalidade: "corrida", data: "2026-10-21" }],
      ["registrar_treino", { treino_id: 1, duracao: 30 }],
      ["status_treino", { treino_id: 1, status: "nao_realizado" }],
      ["remover_treino", { treino_id: 1, confirmar: true }],
      ["registrar_entrada", { descricao: "x", valor: 10 }],
      ["criar_meta", { nome: "Meta da pessoa 2" }],
      ["cadastrar_conta", { nome: "Conta da pessoa 2", tipo: "pix" }],
      ["listar_minhas_dividas", { incluir_pagas: true }],
      ["marcar_paguei", { ids: [1] }],
      ["marcar_paguei", { pessoa: "Ana" }],
      ["contestar_divida", { id: 1, motivo: "não é meu" }],
      ["ligar_devedor", { pessoa: "Ana", conta: "Ana" }],
    ];
    const called = new Set(calls.map(([name]) => name));
    const listRes = await handleMcpRequest(
      new Request("http://test/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }),
      env,
      OTHER,
    );
    const all = ((await listRes.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(all.filter((n) => !called.has(n)), "ferramenta nova: inclua no teste de isolamento").toEqual([]);

    for (const [name, args] of calls) {
      const text = await mcpAs(OTHER, name, args);
      expectNoLeak(text, texts, `${name} ${JSON.stringify(args)}`, Object.values(args));
    }
    expect(await dataOf(OWNER)).toEqual(before);
  });

  it("a pessoa 1 não vê o que a pessoa 2 cria", async () => {
    const owner = apiAs(OWNER);
    const other = apiAs(OTHER);
    const summaryBefore = await getSummary(testCtx(env.DB), MONTH);
    const post = (path: string, body: unknown) =>
      other.request(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, env);
    const account = (await (await post("/accounts", { name: "Conta Dois Segredo", type: "credit", closing_day: 1, due_day: 10 })).json()) as { id: number };
    await post("/expenses", {
      description: "Gasto Dois Segredo",
      amount_cents: 5000,
      date: "2026-10-15",
      account_id: account.id,
      splits: [{ person: "Pessoa Dois Segredo", amount_cents: 2000 }],
    });
    await post("/installments", { description: "Parcelado Dois Segredo", total_installments: 3, installment_cents: 1000, first_month: MONTH });
    await post("/recurring", { description: "Fixo Dois Segredo", amount_cents: 1000 });
    await post("/incomes", { description: "Entrada Dois Segredo", amount_cents: 1000, date: "2026-10-15" });
    await post("/goals", { name: "Meta Dois Segredo", initial_cents: 1000 });
    const project = (await (await post("/projects", { name: "Projeto Dois Segredo" })).json()) as { id: number };
    await post("/tasks", { title: "Tarefa Dois Segredo", project_id: project.id, due_date: "2026-10-15", tags: ["etiqueta-dois"] });
    await post("/events", { title: "Evento Dois Segredo", start: "2026-10-15T15:00", category: "categoria-dois" });
    await post("/training", { sport: "run", date: "2026-10-15", title: "Treino Dois Segredo" });
    await other.request("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ income_cents: 999 }) }, env);

    const texts = await textsOf(OTHER);
    expect(texts).toContain("Gasto Dois Segredo");
    for (const r of ROUTES.filter((r) => r.method === "GET" && !r.path.includes(":"))) {
      const res = await owner.request(`/api${r.path}${GET_QUERY}`, {}, env);
      expect(res.status, r.path).toBe(200);
      expectNoLeak(await res.text(), texts, `pessoa 1: GET ${r.path}`);
    }
    for (const [name, args] of [
      ["resumo_mes", { mes: MONTH }],
      ["listar_cadastros", {}],
      ["listar_devedores", { incluir_recebidos: true }],
      ["listar_lancamentos", { mes: MONTH }],
      ["listar_metas", { mes: MONTH }],
      ["revisao_diaria", {}],
      ["revisao_semanal", { data: "2026-10-15" }],
      ["agenda", { de: "2026-10-01", ate: "2026-10-31" }],
      ["listar_tarefas", { filtro: "abertas" }],
      ["treinos_semana", { data: "2026-10-15" }],
    ] as [string, Record<string, unknown>][]) {
      expectNoLeak(await mcpAs(OWNER, name, args), texts, `pessoa 1: ${name}`);
    }
    // O resumo da pessoa 1 continua exatamente igual
    expect(await getSummary(testCtx(env.DB), MONTH)).toEqual(summaryBefore);
  });

  it("sem pessoa identificada não há contexto", () => {
    expect(() => makeCtx(env, 0)).toThrow();
    expect(() => makeCtx(env, undefined as unknown as number)).toThrow();
  });
});
