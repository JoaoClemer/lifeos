// Página dos devedores (/devedor): cada pessoa entra com o próprio código e só vê os próprios valores.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { personKey } from "../../src/shared/receivables";
import app from "../../src/worker/index";
import { debtorCodes, debtorStatement } from "../../src/worker/services/debtorAccess";
import { resetFinance, testCtx } from "../fixtures/finance";

beforeEach(() => resetFinance(env.DB));

const json = (method: string, body: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function login(person: string, code: string, e: Env = env) {
  return app.request("/api/debtor/login", json("POST", { person, code }), e);
}

async function cookieOf(person: string, code: string): Promise<string> {
  const res = await login(person, code);
  expect(res.status).toBe(200);
  return res.headers.get("Set-Cookie")!.split(";")[0];
}

describe("códigos de acesso", () => {
  it("a chave da pessoa ignora acento, maiúsculas e pontuação", () => {
    expect(personKey("María Clara")).toBe("MARIA_CLARA");
    expect(personKey("  josé-da silva ")).toBe("JOSE_DA_SILVA");
  });

  it("lê só as variáveis DEBTOR_CODE_* com código de 6+ caracteres", () => {
    const codes = debtorCodes({ DEBTOR_CODE_jose: " abcdef ", DEBTOR_CODE_CURTO: "12345", APP_PASSWORD: "x" } as unknown as Env);
    expect([...codes]).toEqual([["JOSE", "abcdef"]]);
  });
});

describe("extrato do devedor", () => {
  it("separa em aberto, parcelas futuras e pagos, juntando grafias diferentes do nome", async () => {
    await env.DB.prepare(
      "INSERT INTO receivables (person, description, amount_cents, date, month, received_at) VALUES ('ana', 'Cinema', 4000, '2026-09-02', '2026-09', '2026-09-10')",
    ).run();
    const ana = await debtorStatement(testCtx(env.DB), "ANA", "Ana");
    expect(ana).toEqual({
      person: "Ana",
      month: "2026-10",
      due: [
        { description: "Jantar", amount_cents: 9300, date: "2026-10-10", month: "2026-10", installment_no: null, installment_total: null, received_at: null },
      ],
      due_cents: 9300,
      upcoming: [],
      upcoming_cents: 0,
      paid: [
        { description: "Cinema", amount_cents: 4000, date: "2026-09-02", month: "2026-09", installment_no: null, installment_total: null, received_at: "2026-09-10" },
      ],
    });

    const pedro = await debtorStatement(testCtx(env.DB), "PEDRO", "Pedro");
    expect(pedro.due.map((i) => [i.installment_no, i.month])).toEqual([[1, "2026-10"]]);
    expect(pedro.upcoming.map((i) => [i.installment_no, i.month])).toEqual([
      [2, "2026-11"],
      [3, "2026-12"],
    ]);
    expect([pedro.due_cents, pedro.upcoming_cents]).toEqual([20000, 40000]);
  });

  it("pessoa com código mas sem nenhum devedor vê tudo zerado", async () => {
    const s = await debtorStatement(testCtx(env.DB), "MARIA_CLARA", "Maria Clara");
    expect(s).toMatchObject({ due: [], upcoming: [], paid: [], due_cents: 0, upcoming_cents: 0 });
  });
});

describe("API /api/debtor", () => {
  it("lista só quem tem código válido, com o nome escrito como nos devedores", async () => {
    const res = await app.request("/api/debtor/people", {}, env);
    expect(await res.json()).toEqual(["Ana", "Maria Clara", "Pedro"]);
  });

  it("recusa código errado, pessoa sem código e código de outra pessoa", async () => {
    expect((await login("Pedro", "errado-errado")).status).toBe(401);
    expect((await login("Bruno", "codigo-do-pedro")).status).toBe(401);
    expect((await login("Ana", "codigo-do-pedro")).status).toBe(401);
    expect((await login("Pedro", "")).status).toBe(400);
  });

  it("com o código, a pessoa vê só os próprios valores (sem cartão nem ids)", async () => {
    const res = await login("pedro", " codigo-do-pedro ");
    expect(res.headers.get("Set-Cookie")).toMatch(/Path=\/api\/debtor.*HttpOnly/);
    const cookie = res.headers.get("Set-Cookie")!.split(";")[0];
    const s = (await (await app.request("/api/debtor/statement", { headers: { Cookie: cookie } }, env)).json()) as Record<string, unknown> & {
      due: object[];
      upcoming: object[];
      due_cents: number;
      upcoming_cents: number;
    };
    expect(s.person).toBe("Pedro");
    // Quanto já venceu depende do mês atual; o total do parcelamento não
    expect(s.due_cents + s.upcoming_cents).toBe(60000);
    for (const item of [...s.due, ...s.upcoming]) {
      expect(Object.keys(item).sort()).toEqual(["amount_cents", "date", "description", "installment_no", "installment_total", "month", "received_at"]);
    }
  });

  it("sem cookie, cookie adulterado ou código trocado: não autenticado", async () => {
    expect((await app.request("/api/debtor/statement", {}, env)).status).toBe(401);
    const cookie = await cookieOf("Pedro", "codigo-do-pedro");
    // Mesmo cookie apontando para outra pessoa
    const forged = cookie.replace("=PEDRO.", "=ANA.");
    expect(forged).not.toBe(cookie);
    expect((await app.request("/api/debtor/statement", { headers: { Cookie: forged } }, env)).status).toBe(401);
    // Trocar o código derruba as sessões abertas com o antigo
    const changed = { ...env, DEBTOR_CODE_PEDRO: "codigo-novo-do-pedro" } as Env;
    expect((await app.request("/api/debtor/statement", { headers: { Cookie: cookie } }, changed)).status).toBe(401);
    // Remover o código também
    const removed = { ...env, DEBTOR_CODE_PEDRO: undefined } as unknown as Env;
    expect((await app.request("/api/debtor/statement", { headers: { Cookie: cookie } }, removed)).status).toBe(401);
  });

  it("a sessão do devedor não abre o app e a do app não abre a do devedor", async () => {
    const debtor = await cookieOf("Ana", "codigo-da-ana");
    expect((await app.request("/api/summary", { headers: { Cookie: debtor } }, env)).status).toBe(401);
    expect((await app.request("/api/receivables", { headers: { Cookie: debtor } }, env)).status).toBe(401);

    const owner = (await app.request("/api/login", json("POST", { password: env.APP_PASSWORD }), env)).headers.get("Set-Cookie")!.split(";")[0];
    expect((await app.request("/api/debtor/statement", { headers: { Cookie: owner } }, env)).status).toBe(401);
  });

  it("sair apaga o cookie", async () => {
    const res = await app.request("/api/debtor/logout", { method: "POST" }, env);
    expect(res.headers.get("Set-Cookie")).toMatch(/fin_debtor=;.*Max-Age=0.*Path=\/api\/debtor/);
  });

  it("o dono do app vê quem já tem acesso", async () => {
    const owner = (await app.request("/api/login", json("POST", { password: env.APP_PASSWORD }), env)).headers.get("Set-Cookie")!.split(";")[0];
    const res = await app.request("/api/receivables/access", { headers: { Cookie: owner } }, env);
    expect(await res.json()).toEqual(["Ana", "Maria Clara", "Pedro"]);
  });
});
