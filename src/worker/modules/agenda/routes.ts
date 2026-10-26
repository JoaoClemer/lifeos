import { Hono } from "hono";
import { type AppEnv, ctxOf, idParam } from "../../lib";
import * as agenda from "./service";

export const agendaRoutes = new Hono<AppEnv>();

agendaRoutes.get("/events", async (c) => {
  const ctx = ctxOf(c);
  const taskId = c.req.query("task_id");
  if (taskId) return c.json(await agenda.listTaskEvents(ctx, idParam(taskId)));
  return c.json(await agenda.listOccurrences(ctx, c.req.query("from") ?? ctx.today, c.req.query("to") ?? ctx.today));
});
agendaRoutes.get("/events/categories", async (c) => c.json(await agenda.listCategories(ctxOf(c))));
agendaRoutes.get("/events/:id", async (c) => c.json(await agenda.getEvent(ctxOf(c), idParam(c.req.param("id")))));
agendaRoutes.post("/events", async (c) => c.json(await agenda.createEvent(ctxOf(c), await c.req.json()), 201));
// Em séries, o corpo leva também `scope` (this | following | all) e `occurrence_start`
agendaRoutes.patch("/events/:id", async (c) => {
  const { scope, occurrence_start, ...patch } = await c.req.json();
  return c.json(await agenda.updateEvent(ctxOf(c), idParam(c.req.param("id")), patch, agenda.ScopeInput.parse({ scope, occurrence_start })));
});
agendaRoutes.delete("/events/:id", async (c) => {
  const q = c.req.query();
  return c.json(await agenda.deleteEvent(ctxOf(c), idParam(c.req.param("id")), agenda.ScopeInput.parse({ scope: q.scope, occurrence_start: q.occurrence_start })));
});
