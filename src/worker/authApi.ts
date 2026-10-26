import { type Context, Hono } from "hono";
import { createUserSession, failureDelay, sessionKey, setSessionCookie } from "./auth";
import { onAppError } from "./errors";
import { UserError } from "./lib";
import { inspectInvite, inviteOptions, inviteVerify, loginOptions, loginVerify, relyingParty } from "./modules/users/passkeys";
import type { SessionUser } from "./modules/users/service";

// Rotas públicas de login: entrar com passkey e usar um link de convite ou de recuperação.
// Ficam fora da sessão (quem chama ainda não entrou). Falhas esperam um pouco antes de responder.
export const authApi = new Hono<{ Bindings: Env }>();

authApi.onError(async (err, c) => {
  if (err instanceof UserError && (err.status === 401 || err.status === 410)) await failureDelay();
  return onAppError(err, c);
});

async function startSession(c: Context<{ Bindings: Env }>, user: SessionUser) {
  const key = sessionKey(c.env);
  if (!key) throw new UserError("SESSION_SECRET não configurada no servidor", 400);
  setSessionCookie(c, await createUserSession(key, user.id, user.session_version));
  return c.json({ ok: true });
}

authApi.post("/login/options", async (c) => c.json(await loginOptions(c.env.DB, relyingParty(c.req.url))));
authApi.post("/login/verify", async (c) => startSession(c, await loginVerify(c.env.DB, relyingParty(c.req.url), await c.req.json())));

authApi.post("/invite", async (c) => c.json(await inspectInvite(c.env.DB, await c.req.json())));
authApi.post("/invite/options", async (c) => c.json(await inviteOptions(c.env.DB, relyingParty(c.req.url), await c.req.json())));
authApi.post("/invite/verify", async (c) =>
  startSession(
    c,
    await inviteVerify(c.env.DB, relyingParty(c.req.url), await c.req.json(), c.req.header("User-Agent") ?? null, c.env.TIMEZONE || "America/Sao_Paulo"),
  ),
);
