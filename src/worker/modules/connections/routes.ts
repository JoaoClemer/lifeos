import { Hono } from "hono";
import { type AppEnv, ctxOf, idParam, UserError } from "../../lib";
import * as payables from "../../services/payables";
import * as connections from "./service";

// Conexões entre pessoas, nomes dos devedores ligados a contas e "Devo" (o que você deve a pessoas conectadas).
export const connectionsRoutes = new Hono<AppEnv>();

connectionsRoutes.get("/connections", async (c) => c.json(await connections.listConnections(ctxOf(c))));
connectionsRoutes.post("/connections/link", async (c) => c.json(await connections.createConnectionLink(ctxOf(c), new URL(c.req.url).origin), 201));
connectionsRoutes.post("/connections/inspect", async (c) => c.json(await connections.inspectConnectionLink(ctxOf(c), await c.req.json())));
connectionsRoutes.post("/connections/accept", async (c) => c.json(await connections.acceptConnectionLink(ctxOf(c), await c.req.json())));
connectionsRoutes.delete("/connections/:id", async (c) => {
  await connections.removeConnection(ctxOf(c), idParam(c.req.param("id")));
  return c.json({ ok: true });
});

connectionsRoutes.get("/person-links", async (c) => c.json(await connections.listPersonLinks(ctxOf(c))));
connectionsRoutes.put("/person-links", async (c) => c.json(await connections.linkPerson(ctxOf(c), await c.req.json())));
connectionsRoutes.delete("/person-links", async (c) => {
  const { person } = await c.req.json<{ person?: string }>();
  if (!person) throw new UserError("Informe a pessoa");
  await connections.unlinkPerson(ctxOf(c), person);
  return c.json({ ok: true });
});

connectionsRoutes.get("/payables", async (c) => {
  const status = c.req.query("status");
  return c.json(await payables.listPayables(ctxOf(c), { status: status === "all" || status === "received" ? status : "pending" }));
});
connectionsRoutes.post("/payables/mark-paid", async (c) => c.json(await payables.markPaid(ctxOf(c), await c.req.json())));
connectionsRoutes.put("/payables/:id/dispute", async (c) => {
  await payables.disputePayable(ctxOf(c), idParam(c.req.param("id")), await c.req.json());
  return c.json({ ok: true });
});
connectionsRoutes.delete("/payables/:id/dispute", async (c) => {
  await payables.disputePayable(ctxOf(c), idParam(c.req.param("id")), null);
  return c.json({ ok: true });
});
