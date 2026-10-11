import { Hono } from "hono";
import { idParam, limitParam, makeCtx, UserError } from "../../lib";
import * as tasks from "./service";

export const tasksRoutes = new Hono<{ Bindings: Env }>();
const ctxOf = (c: { env: Env }) => makeCtx(c.env);
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
