import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { api } from "./api";
import { checkMcpToken, createSession, safeEqual, SESSION_COOKIE, SESSION_MAX_AGE, verifySession } from "./auth";
import { UserError } from "./lib";
import { handleMcpRequest } from "./mcp/server";

z.config(z.locales.ptBR());

const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
  if (err instanceof UserError) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "JSON inválido" }, 400);
  console.error(err);
  return c.json({ error: "Erro interno" }, 500);
});

// ---- Login (senha única do app) ----
app.post("/api/login", async (c) => {
  const { password } = await c.req.json<{ password?: string }>();
  const expected = c.env.APP_PASSWORD;
  if (!expected) return c.json({ error: "APP_PASSWORD não configurada no servidor" }, 500);
  if (!password || !safeEqual(password, expected)) {
    await new Promise((r) => setTimeout(r, 800)); // dificulta força bruta
    return c.json({ error: "Senha incorreta" }, 401);
  }
  setCookie(c, SESSION_COOKIE, await createSession(expected), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return c.json({ ok: true });
});

app.post("/api/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  if (!(await verifySession(c.env.APP_PASSWORD, getCookie(c, SESSION_COOKIE)))) return c.json({ error: "Não autenticado" }, 401);
  await next();
});

app.get("/api/me", (c) => c.json({ ok: true }));
app.route("/api", api);

// ---- MCP: /mcp/<token> (conector do claude.ai) ou /mcp com "Authorization: Bearer <token>" ----
app.all("/mcp/:token", async (c) => {
  if (!checkMcpToken(c.env.MCP_TOKEN, c.req.param("token"))) return c.json({ error: "unauthorized" }, 401);
  return handleMcpRequest(c.req.raw, c.env);
});
app.all("/mcp", async (c) => {
  const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!checkMcpToken(c.env.MCP_TOKEN, bearer)) return c.json({ error: "unauthorized" }, 401);
  return handleMcpRequest(c.req.raw, c.env);
});

// Sem OAuth: descoberta retorna 404 para o cliente seguir sem autenticação (o token já vai na URL)
app.all("/.well-known/*", (c) => c.json({ error: "not found" }, 404));
app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
