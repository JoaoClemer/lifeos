// Autenticação da API e do MCP, contrato das ferramentas financeiras e texto do resumo via MCP.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../../src/worker/index";
import { TOOLS } from "../../src/worker/mcp/tools";
import { resetFinance, testCtx } from "../fixtures/finance";

beforeEach(() => resetFinance(env.DB));

const rpc = (method: string, params: Record<string, unknown> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
});

describe("API", () => {
  it("exige sessão", async () => {
    const res = await app.request("/api/summary", {}, env);
    expect(res.status).toBe(401);
  });

  it("login com a senha libera a API e informa hoje e o fuso", async () => {
    const login = await app.request(
      "/api/login",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: env.APP_PASSWORD }) },
      env,
    );
    expect(login.status).toBe(200);
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0];
    const me = await app.request("/api/me", { headers: { Cookie: cookie } }, env);
    expect(await me.json()).toMatchObject({
      user: { id: 1, role: "admin" },
      timezone: "America/Sao_Paulo",
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    const summary = await app.request("/api/summary?month=2026-10", { headers: { Cookie: cookie } }, env);
    expect(((await summary.json()) as { totals: { total_cents: number } }).totals.total_cents).toBe(265432);
  });
});

describe("MCP", () => {
  it("recusa token inválido, na URL e no header", async () => {
    expect((await app.request("/mcp/token-errado-0123456789", rpc("tools/list"), env)).status).toBe(401);
    const init = rpc("tools/list");
    expect((await app.request("/mcp", { ...init, headers: { ...init.headers, Authorization: "Bearer errado" } }, env)).status).toBe(401);
  });

  it("aceita o token na URL e no header Bearer", async () => {
    const byUrl = await app.request(`/mcp/${env.MCP_TOKEN}`, rpc("initialize", { protocolVersion: "2025-06-18" }), env);
    expect(await byUrl.json()).toMatchObject({ result: { protocolVersion: "2025-06-18", serverInfo: { name: "lifeos" } } });
    const init = rpc("ping");
    const byHeader = await app.request("/mcp", { ...init, headers: { ...init.headers, Authorization: `Bearer ${env.MCP_TOKEN}` } }, env);
    expect(await byHeader.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  it("as ferramentas financeiras (nomes, descrições e parâmetros) não mudam", async () => {
    const res = await app.request(`/mcp/${env.MCP_TOKEN}`, rpc("tools/list"), env);
    const { result } = (await res.json()) as { result: { tools: { name: string }[] } };
    // As do LifeOS vêm depois; as 19 primeiras são as de finanças, iguais ao snapshot gravado antes do LifeOS
    const finance = result.tools.slice(0, 19);
    expect(finance.map((t) => t.name)).toEqual([
      "resumo_mes",
      "listar_cadastros",
      "lancar_despesa",
      "lancar_parcelado",
      "adicionar_fixo",
      "ajustar_fixo",
      "registrar_devedor",
      "marcar_recebido",
      "listar_devedores",
      "ajustar_saldo",
      "registrar_entrada",
      "listar_lancamentos",
      "editar_lancamento",
      "remover_lancamento",
      "listar_metas",
      "criar_meta",
      "registrar_aporte",
      "atualizar_saldo_meta",
      "cadastrar_conta",
    ]);
    expect(finance).toMatchSnapshot();
  });

  it("resumo_mes descreve o mês como antes", async () => {
    const tool = TOOLS.find((t) => t.name === "resumo_mes")!;
    const text = await tool.run({ mes: "2026-10" }, testCtx(env.DB));
    expect(text).toContain("Total de gastos do mês: R$ 2.654,32");
    expect(text).toMatchSnapshot();
  });
});
