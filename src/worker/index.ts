import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { api } from "./api";
import { authApi } from "./authApi";
import { checkMcpToken, createUserSession, failureDelay, readSession, safeEqual, SESSION_COOKIE, sessionKey, setSessionCookie } from "./auth";
import { debtorApi } from "./debtorApi";
import { onAppError } from "./errors";
import { type AppEnv, OWNER_USER_ID } from "./lib";
import { handleMcpRequest } from "./mcp/server";
import { loadActiveUser, type SessionUser, userOfMcpToken } from "./modules/users/service";

z.config(z.locales.ptBR());

const app = new Hono<AppEnv>();
app.onError(onAppError);

// ---- Senha do app (APP_PASSWORD): acesso do dono (admin), além da passkey ----
app.post("/api/login", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  const expected = c.env.APP_PASSWORD;
  if (!expected) return c.json({ error: "Entrada com senha desativada: use sua passkey" }, 400);
  if (!password || !safeEqual(password, expected)) {
    await failureDelay();
    return c.json({ error: "Senha incorreta" }, 401);
  }
  const owner = await loadActiveUser(c.env.DB, OWNER_USER_ID);
  if (!owner) return c.json({ error: "Conta do dono não encontrada" }, 500);
  setSessionCookie(c, await createUserSession(sessionKey(c.env)!, owner.id, owner.session_version));
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---- Passkeys, convites e recuperação: antes da sessão (quem chama ainda não entrou) ----
app.route("/api/auth", authApi);

// ---- Página dos devedores (/devedor): login próprio por pessoa, fora da sessão do app ----
app.route("/api/debtor", debtorApi);

// ---- Sessão: diz quem é a pessoa. Conta desativada ou sessões derrubadas (versão mudou) não entram ----
app.use("/api/*", async (c, next) => {
  const claim = await readSession(c.env, getCookie(c, SESSION_COOKIE));
  const user = claim && (await loadActiveUser(c.env.DB, claim.userId));
  // Sessão antiga (só senha, do dono) vale até a primeira vez que ele derrubar as sessões
  const current = user && (claim.version === null ? user.session_version === 0 : claim.version === user.session_version);
  if (!current) return c.json({ error: "Não autenticado" }, 401);
  c.set("userId", user.id);
  c.set("role", user.role);
  c.set("timezone", user.timezone);
  await next();
});
app.route("/api", api);

// ---- MCP: /mcp/<token> (conector do claude.ai) ou /mcp com "Authorization: Bearer <token>" ----
// Token da pessoa (mcp_tokens) ou, do dono, o MCP_TOKEN
async function mcpUser(env: Env, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  if (checkMcpToken(env.MCP_TOKEN, token)) return loadActiveUser(env.DB, OWNER_USER_ID);
  return userOfMcpToken(env.DB, token);
}
app.all("/mcp/:token", async (c) => {
  const user = await mcpUser(c.env, c.req.param("token"));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return handleMcpRequest(c.req.raw, c.env, user.id, user.timezone);
});
app.all("/mcp", async (c) => {
  const user = await mcpUser(c.env, c.req.header("Authorization")?.replace(/^Bearer\s+/i, ""));
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return handleMcpRequest(c.req.raw, c.env, user.id, user.timezone);
});

// Sem OAuth: descoberta retorna 404 para o cliente seguir sem autenticação (o token já vai na URL)
app.all("/.well-known/*", (c) => c.json({ error: "not found" }, 404));
app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
