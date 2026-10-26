import { Hono } from "hono";
import { type AppEnv, ctxOf, idParam, requireAdmin } from "../../lib";
import { addPasskeyOptions, addPasskeyVerify, relyingParty } from "./passkeys";
import * as users from "./service";

// Conta da pessoa logada (/api/me...) e administração das pessoas (/api/admin..., só admin).
export const usersRoutes = new Hono<AppEnv>();
const origin = (url: string) => new URL(url).origin;

usersRoutes.get("/me", async (c) => {
  const ctx = ctxOf(c);
  // "Hoje" e fuso da pessoa: o app usa os mesmos do MCP, independentemente do fuso do aparelho
  return c.json({ user: await users.getMe(ctx), today: ctx.today, timezone: ctx.timezone });
});
usersRoutes.patch("/me", async (c) => c.json(await users.updateMe(ctxOf(c), await c.req.json())));
usersRoutes.post("/me/logout-all", async (c) => {
  await users.logoutEverywhere(ctxOf(c));
  return c.json({ ok: true });
});
usersRoutes.delete("/me", async (c) => {
  await users.deleteMyAccount(ctxOf(c), await c.req.json().catch(() => ({})));
  return c.json({ ok: true });
});

usersRoutes.get("/me/passkeys", async (c) => c.json(await users.listPasskeys(ctxOf(c))));
usersRoutes.delete("/me/passkeys/:id", async (c) => {
  await users.deletePasskey(ctxOf(c), c.req.param("id"));
  return c.json({ ok: true });
});
usersRoutes.post("/me/passkeys/options", async (c) => c.json(await addPasskeyOptions(ctxOf(c), relyingParty(c.req.url))));
usersRoutes.post("/me/passkeys/verify", async (c) => {
  await addPasskeyVerify(ctxOf(c), relyingParty(c.req.url), await c.req.json(), c.req.header("User-Agent") ?? null);
  return c.json({ ok: true }, 201);
});

usersRoutes.get("/me/mcp-tokens", async (c) => c.json(await users.listMcpTokens(ctxOf(c))));
usersRoutes.post("/me/mcp-tokens", async (c) =>
  c.json(await users.createMcpToken(ctxOf(c), await c.req.json().catch(() => ({})), origin(c.req.url)), 201),
);
usersRoutes.delete("/me/mcp-tokens/:id", async (c) => {
  await users.revokeMcpToken(ctxOf(c), idParam(c.req.param("id")));
  return c.json({ ok: true });
});

// ---- admin ----
usersRoutes.get("/admin/users", async (c) => {
  requireAdmin(c);
  return c.json(await users.listUsers(ctxOf(c)));
});
usersRoutes.get("/admin/invites", async (c) => {
  requireAdmin(c);
  return c.json(await users.listPendingInvites(ctxOf(c)));
});
usersRoutes.post("/admin/invites", async (c) => {
  requireAdmin(c);
  return c.json(await users.createInvite(ctxOf(c), await c.req.json(), origin(c.req.url)), 201);
});
usersRoutes.delete("/admin/invites/:id", async (c) => {
  requireAdmin(c);
  await users.cancelInvite(ctxOf(c), idParam(c.req.param("id")));
  return c.json({ ok: true });
});
usersRoutes.post("/admin/users/:id/recovery", async (c) => {
  requireAdmin(c);
  return c.json(await users.createRecovery(ctxOf(c), idParam(c.req.param("id")), origin(c.req.url)), 201);
});
usersRoutes.post("/admin/users/:id/disable", async (c) => {
  requireAdmin(c);
  await users.setUserDisabled(ctxOf(c), idParam(c.req.param("id")), true);
  return c.json({ ok: true });
});
usersRoutes.post("/admin/users/:id/enable", async (c) => {
  requireAdmin(c);
  await users.setUserDisabled(ctxOf(c), idParam(c.req.param("id")), false);
  return c.json({ ok: true });
});
