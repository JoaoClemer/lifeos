import { Hono } from "hono";
import { type AppEnv, ctxOf } from "../../lib";
import { getAgenda, getToday, getWeek } from "./service";

export const todayRoutes = new Hono<AppEnv>();

todayRoutes.get("/agenda", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await getAgenda(ctx, c.req.query("from") ?? ctx.today, c.req.query("to") ?? ctx.today));
});
todayRoutes.get("/today", async (c) => c.json(await getToday(ctxOf(c))));
todayRoutes.get("/week", async (c) => {
  const ctx = ctxOf(c);
  return c.json(await getWeek(ctx, c.req.query("date") ?? ctx.today));
});
