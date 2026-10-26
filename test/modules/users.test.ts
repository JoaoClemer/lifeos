// Contas por pessoa: convite, passkey, recuperação, sessões, conectores do Claude, administração e exclusão da conta.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../../src/worker/index";
import { OWNED_TABLES } from "../../src/worker/owned";
import { resetFinance } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";
import { SoftAuthenticator } from "../fixtures/passkey";

beforeEach(async () => {
  await resetFinance(env.DB);
  await resetLifeOS(env.DB);
  await env.DB.batch(
    ["passkeys", "mcp_tokens", "invites", "auth_challenges"]
      .map((t) => env.DB.prepare(`DELETE FROM ${t}`))
      .concat(env.DB.prepare("UPDATE users SET session_version = 0, disabled_at = NULL, timezone = NULL WHERE id = 1")),
  );
});

type Json = Record<string, unknown>;

async function call(method: string, path: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const setCookie = res.headers.get("Set-Cookie");
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Json & { error?: string }, cookie: setCookie?.split(";")[0] };
}

async function ownerCookie(): Promise<string> {
  return (await call("POST", "/api/login", { password: env.APP_PASSWORD })).cookie!;
}

/** Token do link (vem depois de #/convite/). */
const tokenOf = (url: unknown) => String(url).split("#/convite/")[1];

/** Admin convida e a pessoa cria a conta com uma passkey. Devolve o cookie dela, o autenticador e o id. */
async function invitePerson(name = "Maria Clara") {
  const admin = await ownerCookie();
  const invite = await call("POST", "/api/admin/invites", { name: "Maria" }, admin);
  expect(invite.status).toBe(201);
  const token = tokenOf(invite.json.url);
  const opts = await call("POST", "/api/auth/invite/options", { token, name });
  const auth = await SoftAuthenticator.create();
  const done = await call("POST", "/api/auth/invite/verify", {
    token,
    name,
    challengeId: opts.json.challengeId,
    response: await auth.register(opts.json.options as never),
  });
  expect(done.status, JSON.stringify(done.json)).toBe(200);
  const me = await call("GET", "/api/me", undefined, done.cookie);
  return { cookie: done.cookie!, auth, token, id: (me.json.user as { id: number }).id, admin };
}

async function loginWith(auth: SoftAuthenticator) {
  const opts = await call("POST", "/api/auth/login/options", {});
  return call("POST", "/api/auth/login/verify", { challengeId: opts.json.challengeId, response: await auth.login(opts.json.options as never) });
}

describe("convite e passkey", () => {
  it("admin convida, a pessoa cria a conta com passkey e já entra", async () => {
    const admin = await ownerCookie();
    const invite = await call("POST", "/api/admin/invites", { name: "Maria" }, admin);
    expect(invite.json.url).toMatch(/^http:\/\/localhost\/#\/convite\/[\w-]{40,}$/);
    const token = tokenOf(invite.json.url);

    expect((await call("POST", "/api/auth/invite", { token })).json).toMatchObject({ kind: "invite", name: "Maria" });

    const p = await invitePerson("Maria Clara");
    const me = await call("GET", "/api/me", undefined, p.cookie);
    expect(me.json.user).toMatchObject({ name: "Maria Clara", role: "member" });
    // Conta nova começa vazia, com o saldo acumulado a partir do mês em que entrou
    const settings = await env.DB.prepare("SELECT key, value FROM user_settings WHERE user_id = ?").bind(p.id).all();
    expect(settings.results).toEqual([{ key: "balance_start_month", value: String(me.json.today).slice(0, 7) }]);
    expect((await call("GET", "/api/expenses", undefined, p.cookie)).json).toEqual([]);
    // Quem convidou e quem entrou já ficam conectados
    expect((await call("GET", "/api/connections", undefined, p.cookie)).json).toMatchObject([{ user_id: 1 }]);
  });

  it("o link vale uma vez só", async () => {
    const p = await invitePerson();
    expect((await call("POST", "/api/auth/invite", { token: p.token })).status).toBe(410);
    expect((await call("POST", "/api/auth/invite/options", { token: p.token, name: "Outra" })).status).toBe(410);
  });

  it("convite cancelado ou expirado não vale", async () => {
    const admin = await ownerCookie();
    const a = await call("POST", "/api/admin/invites", { name: "A" }, admin);
    const pending = (await call("GET", "/api/admin/invites", undefined, admin)).json as unknown as { id: number }[];
    expect((await call("DELETE", `/api/admin/invites/${pending[0].id}`, undefined, admin)).status).toBe(200);
    expect((await call("POST", "/api/auth/invite", { token: tokenOf(a.json.url) })).status).toBe(410);

    const b = await call("POST", "/api/admin/invites", { name: "B" }, admin);
    await env.DB.prepare("UPDATE invites SET expires_at = datetime('now', '-1 minute')").run();
    expect((await call("POST", "/api/auth/invite", { token: tokenOf(b.json.url) })).status).toBe(410);
  });

  it("entra com a passkey; desafio é de uso único e assinatura errada não passa", async () => {
    const p = await invitePerson();
    const ok = await loginWith(p.auth);
    expect(ok.status).toBe(200);
    expect((await call("GET", "/api/me", undefined, ok.cookie)).json.user).toMatchObject({ id: p.id });

    // Mesma resposta de novo (o desafio já foi usado)
    const opts = await call("POST", "/api/auth/login/options", {});
    const response = await p.auth.login(opts.json.options as never);
    expect((await call("POST", "/api/auth/login/verify", { challengeId: opts.json.challengeId, response })).status).toBe(200);
    expect((await call("POST", "/api/auth/login/verify", { challengeId: opts.json.challengeId, response })).status).toBe(401);

    // Assinatura adulterada (um byte trocado)
    const o0 = await call("POST", "/api/auth/login/options", {});
    const tampered = await p.auth.login(o0.json.options as never);
    const sig = tampered.response.signature;
    tampered.response.signature = sig.slice(0, -2) + (sig.slice(-2) === "AA" ? "AB" : "AA");
    expect((await call("POST", "/api/auth/login/verify", { challengeId: o0.json.challengeId, response: tampered })).status).toBe(401);

    // Passkey de outro aparelho que não foi cadastrado
    const stranger = await SoftAuthenticator.create();
    expect((await loginWith(stranger)).status).toBe(401);

    // Resposta assinada para outro desafio
    const o1 = await call("POST", "/api/auth/login/options", {});
    const o2 = await call("POST", "/api/auth/login/options", {});
    const forged = await call("POST", "/api/auth/login/verify", { challengeId: o2.json.challengeId, response: await p.auth.login(o1.json.options as never) });
    expect(forged.status).toBe(401);
  });

  it("link de recuperação cadastra uma passkey nova para quem perdeu o acesso", async () => {
    const p = await invitePerson();
    const rec = await call("POST", `/api/admin/users/${p.id}/recovery`, {}, p.admin);
    expect(rec.status).toBe(201);
    const token = tokenOf(rec.json.url);
    expect((await call("POST", "/api/auth/invite", { token })).json).toMatchObject({ kind: "recovery", name: "Maria Clara" });
    const opts = await call("POST", "/api/auth/invite/options", { token });
    const phone = await SoftAuthenticator.create();
    const done = await call("POST", "/api/auth/invite/verify", { token, challengeId: opts.json.challengeId, response: await phone.register(opts.json.options as never) });
    expect(done.status).toBe(200);
    expect((await call("GET", "/api/me", undefined, done.cookie)).json.user).toMatchObject({ id: p.id });
    expect((await loginWith(phone)).status).toBe(200);
    expect((await call("GET", "/api/me/passkeys", undefined, done.cookie)).json).toHaveLength(2);
  });

  it("cadastra outro aparelho já logado; a última passkey não pode ser removida", async () => {
    const p = await invitePerson();
    const keys = (await call("GET", "/api/me/passkeys", undefined, p.cookie)).json as unknown as { id: string }[];
    expect((await call("DELETE", `/api/me/passkeys/${keys[0].id}`, undefined, p.cookie)).status).toBe(400);

    const opts = await call("POST", "/api/me/passkeys/options", {}, p.cookie);
    const laptop = await SoftAuthenticator.create();
    expect((await call("POST", "/api/me/passkeys/verify", { challengeId: opts.json.challengeId, response: await laptop.register(opts.json.options as never) }, p.cookie)).status).toBe(201);
    expect((await call("DELETE", `/api/me/passkeys/${keys[0].id}`, undefined, p.cookie)).status).toBe(200);
    expect((await loginWith(p.auth)).status).toBe(401);
    expect((await loginWith(laptop)).status).toBe(200);
  });
});

describe("sessões", () => {
  it("sair de todos os aparelhos derruba as sessões", async () => {
    const p = await invitePerson();
    const other = (await loginWith(p.auth)).cookie!;
    expect((await call("POST", "/api/me/logout-all", {}, p.cookie)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, p.cookie)).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, other)).status).toBe(401);
    expect((await loginWith(p.auth)).status).toBe(200);
  });

  it("conta desativada não entra e perde as sessões; reativada volta a entrar", async () => {
    const p = await invitePerson();
    expect((await call("POST", `/api/admin/users/${p.id}/disable`, {}, p.admin)).status).toBe(200);
    expect((await call("GET", "/api/me", undefined, p.cookie)).status).toBe(401);
    expect((await loginWith(p.auth)).status).toBe(403);
    expect((await call("POST", `/api/admin/users/${p.id}/enable`, {}, p.admin)).status).toBe(200);
    expect((await loginWith(p.auth)).status).toBe(200);
    // O admin não pode se desativar
    expect((await call("POST", "/api/admin/users/1/disable", {}, p.admin)).status).toBe(400);
  });

  it("a senha do app e a sessão antiga continuam valendo para o dono", async () => {
    // Cookie do formato antigo (só a senha), de antes das contas por pessoa
    const issued = Date.now().toString();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.APP_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`session:${issued}`)))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const legacy = `fin_session=${issued}.${sig}`;
    expect((await call("GET", "/api/me", undefined, legacy)).json.user).toMatchObject({ id: 1, role: "admin" });
    // Depois de derrubar as sessões, a antiga também cai
    await call("POST", "/api/me/logout-all", {}, await ownerCookie());
    expect((await call("GET", "/api/me", undefined, legacy)).status).toBe(401);
    expect((await call("GET", "/api/me", undefined, await ownerCookie())).status).toBe(200);
  });

  it("cookie adulterado não entra", async () => {
    const p = await invitePerson();
    expect((await call("GET", "/api/me", undefined, p.cookie.replace(`u.${p.id}.`, "u.1."))).status).toBe(401);
  });
});

describe("perfil", () => {
  it("nome e fuso da pessoa; o fuso vale para o 'hoje' do app", async () => {
    const p = await invitePerson();
    const ok = await call("PATCH", "/api/me", { name: "Maria", timezone: "Asia/Tokyo" }, p.cookie);
    expect(ok.json).toMatchObject({ name: "Maria", timezone: "Asia/Tokyo" });
    expect((await call("GET", "/api/me", undefined, p.cookie)).json.timezone).toBe("Asia/Tokyo");
    expect((await call("PATCH", "/api/me", { timezone: "Lugar/Nenhum" }, p.cookie)).status).toBe(400);
  });
});

describe("conectores do Claude", () => {
  const rpc = (method: string, params: Json = {}) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  it("cada pessoa tem o próprio conector, que só vê os dados dela; revogado para de funcionar", async () => {
    const p = await invitePerson();
    const created = await call("POST", "/api/me/mcp-tokens", { name: "Claude do celular" }, p.cookie);
    expect(created.status).toBe(201);
    const path = new URL(String(created.json.url)).pathname;
    const res = await app.request(path, rpc("tools/call", { name: "listar_cadastros", arguments: {} }), env);
    const text = ((await res.json()) as { result: { content: { text: string }[] } }).result.content[0].text;
    expect(text).toContain("nenhuma");
    expect(text).not.toContain("Cartão A"); // conta da pessoa 1

    const list = (await call("GET", "/api/me/mcp-tokens", undefined, p.cookie)).json as unknown as { id: number; name: string }[];
    expect(list).toMatchObject([{ name: "Claude do celular" }]);
    expect(JSON.stringify(list)).not.toContain(path.split("/").pop()!); // o token não volta
    await call("DELETE", `/api/me/mcp-tokens/${list[0].id}`, undefined, p.cookie);
    expect((await app.request(path, rpc("ping"), env)).status).toBe(401);
  });

  it("o MCP_TOKEN continua sendo do dono e só o dono vê o link dele", async () => {
    const res = await app.request(`/mcp/${env.MCP_TOKEN}`, rpc("tools/call", { name: "listar_cadastros", arguments: {} }), env);
    expect(JSON.stringify(await res.json())).toContain("Cartão A");
    const p = await invitePerson();
    expect((await call("GET", "/api/mcp-info", undefined, p.cookie)).json).toEqual({ configured: false, url: null });
    expect((await call("GET", "/api/mcp-info", undefined, await ownerCookie())).json.configured).toBe(true);
  });
});

describe("administração e exclusão da conta", () => {
  it("só o admin vê e administra as pessoas", async () => {
    const p = await invitePerson();
    expect((await call("GET", "/api/admin/users", undefined, p.cookie)).status).toBe(403);
    expect((await call("POST", "/api/admin/invites", { name: "x" }, p.cookie)).status).toBe(403);
    const users = (await call("GET", "/api/admin/users", undefined, p.admin)).json as unknown as Json[];
    expect(users.map((u) => [u.id, u.role, u.passkeys])).toEqual([
      [1, "admin", 0],
      [p.id, "member", 1],
    ]);
  });

  it("a pessoa exclui a conta e todos os dados dela; o admin não pode se excluir", async () => {
    const p = await invitePerson();
    await call("POST", "/api/expenses", { description: "Gasto dela", amount_cents: 100 }, p.cookie);
    await call("POST", "/api/tasks", { title: "Tarefa dela" }, p.cookie);
    expect((await call("DELETE", "/api/me", { confirm: "sim" }, p.cookie)).status).toBe(400);
    expect((await call("DELETE", "/api/me", { confirm: "EXCLUIR" }, p.cookie)).status).toBe(200);
    for (const t of OWNED_TABLES) {
      expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(p.id).first<{ n: number }>())!.n, t).toBe(0);
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?").bind(p.id).first()).toEqual({ n: 0 });
    expect((await call("GET", "/api/me", undefined, p.cookie)).status).toBe(401);
    expect((await loginWith(p.auth)).status).toBe(401);
    // Os dados do dono continuam lá
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM expenses WHERE user_id = 1").first<{ n: number }>())!.n).toBe(9);
    expect((await call("DELETE", "/api/me", { confirm: "EXCLUIR" }, p.admin)).status).toBe(400);
  });
});
