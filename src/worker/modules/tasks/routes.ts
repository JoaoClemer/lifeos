import { Hono } from "hono";
import { type AppEnv, ctxOf, idParam, limitParam, UserError } from "../../lib";
import * as tasks from "./service";

export const tasksRoutes = new Hono<AppEnv>();
const optionalId = (v: string | undefined) => (v ? idParam(v) : undefined);

tasksRoutes.get("/tasks", async (c) => {
  const q = c.req.query();
  const status = q.status ?? "open";
  if (!["open", "done", "all"].includes(status)) throw new UserError("status inválido (open, done ou all)");
  if (q.priority && !["low", "medium", "high"].includes(q.priority)) throw new UserError("prioridade inválida");
  return c.json(
    await tasks.listTasks(ctxOf(c), {
      status: status as "open" | "done" | "all",
      project_id: optionalId(q.project_id),
      priority: q.priority as "low" | "medium" | "high" | undefined,
      tag: q.tag || undefined,
      search: q.q || undefined,
      parent_id: optionalId(q.parent_id),
      limit: limitParam(q.limit),
    }),
  );
});
tasksRoutes.get("/tasks/tags", async (c) => c.json(await tasks.listTags(ctxOf(c))));
tasksRoutes.get("/tasks/:id", async (c) => c.json(await tasks.getTask(ctxOf(c), idParam(c.req.param("id")))));
tasksRoutes.post("/tasks", async (c) => c.json(await tasks.createTask(ctxOf(c), await c.req.json()), 201));
tasksRoutes.patch("/tasks/:id", async (c) => c.json(await tasks.updateTask(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
tasksRoutes.delete("/tasks/:id", async (c) => c.json(await tasks.deleteTask(ctxOf(c), idParam(c.req.param("id")))));

tasksRoutes.get("/projects", async (c) => c.json(await tasks.listProjects(ctxOf(c), c.req.query("all") === "1")));
tasksRoutes.post("/projects", async (c) => c.json(await tasks.createProject(ctxOf(c), await c.req.json()), 201));
tasksRoutes.patch("/projects/:id", async (c) => c.json(await tasks.updateProject(ctxOf(c), idParam(c.req.param("id")), await c.req.json())));
tasksRoutes.delete("/projects/:id", async (c) => c.json(await tasks.deleteProject(ctxOf(c), idParam(c.req.param("id")))));
// Lista compartilhada: membros (o dono define; quem participa pode sair)
tasksRoutes.get("/projects/:id/members", async (c) => c.json(await tasks.listProjectMembers(ctxOf(c), idParam(c.req.param("id")))));
tasksRoutes.put("/projects/:id/members", async (c) => {
  const { user_ids } = await c.req.json<{ user_ids?: unknown }>();
  if (!Array.isArray(user_ids) || !user_ids.every((u) => Number.isInteger(u))) throw new UserError("user_ids deve ser uma lista de ids");
  return c.json(await tasks.setProjectMembers(ctxOf(c), idParam(c.req.param("id")), user_ids as number[]));
});
tasksRoutes.post("/projects/:id/leave", async (c) => {
  await tasks.leaveProject(ctxOf(c), idParam(c.req.param("id")));
  return c.json({ ok: true });
});
