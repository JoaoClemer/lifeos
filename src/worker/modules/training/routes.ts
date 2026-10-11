import { Hono } from "hono";
import { SPORTS, type Sport } from "../../../shared/training";
import { idParam, limitParam, makeCtx, UserError } from "../../lib";
import * as training from "./service";

export const trainingRoutes = new Hono<{ Bindings: Env }>();
const ctxOf = (c: { env: Env }) => makeCtx(c.env);
const sportParam = (v: string | undefined): Sport | undefined => {
  if (!v) return undefined;
  if (!(SPORTS as string[]).includes(v)) throw new UserError("modalidade inválida");
  return v as Sport;
};

trainingRoutes.get("/training", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await training.listSessions(ctx, c.req.query("from") ?? ctx.today, c.req.query("to") ?? ctx.today, sportParam(c.req.query("sport"))));
});
trainingRoutes.get("/training/week", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await training.weekStats(ctx, c.req.query("date") ?? ctx.today));
});
trainingRoutes.get("/training/history", async (c) =>
  c.json(
    await training.listHistory(ctxOf(c), {
      sport: sportParam(c.req.query("sport")),
      before: c.req.query("before") || undefined,
      limit: limitParam(c.req.query("limit")),
    }),
  ),
);
trainingRoutes.post("/training/copy-week", async (c) => {
  const { from, to } = await c.req.json<{ from?: string; to?: string }>();
  if (!from || !to) throw new UserError("Informe as semanas de origem (from) e destino (to)");
  return c.json(await training.copyWeek(ctxOf(c), from, to), 201);
});
trainingRoutes.get("/training/:id", async (c) => c.json(await training.getSession(ctxOf(c), idParam(c.req.param("id")))));
trainingRoutes.post("/training", async (c) => c.json(await training.createSession(ctxOf(c), await c.req.json()), 201));
trainingRoutes.patch("/training/:id", async (c) => c.json(await training.updateSession(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
trainingRoutes.delete("/training/:id", async (c) => c.json(await training.deleteSession(ctxOf(c), idParam(c.req.param("id")))));
