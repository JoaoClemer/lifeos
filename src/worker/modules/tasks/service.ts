// Tarefas e projetos. Regras: uma tarefa pode não ter prazo; prazo não ocupa horário na agenda;
// concluir registra a data e hora (e conclui as subtarefas abertas); reabrir limpa a conclusão, mas o histórico fica em activity_log.
import { z } from "zod";
import { isValidDate } from "../../../shared/datetime";
import { compareTasks, type Project, type Task, type TaskPriority } from "../../../shared/tasks";
import { activity } from "../../activity";
import { type Ctx, findByName, nn, updateRow, UserError } from "../../lib";

const dateArg = z.string().refine(isValidDate, "data inválida (use YYYY-MM-DD)");

export const TaskInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().nullable().optional(),
  status: z.enum(["todo", "doing", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  due_date: dateArg.nullable().optional(),
  estimate_minutes: z.number().int().positive().max(10_080).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  project_id: z.number().int().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
});
export const TaskPatch = TaskInput.partial();

export const ProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().nullable().optional(),
  status: z.enum(["active", "paused", "done", "archived"]).optional(),
  due_date: dateArg.nullable().optional(),
  color: z.string().nullable().optional(),
});
export const ProjectPatch = ProjectInput.partial();

type TaskRow = Omit<Task, "tags"> & { tags: string | null };

const SELECT = `SELECT t.id, t.title, t.notes, t.status, t.priority, t.due_date, t.estimate_minutes, t.tags, t.project_id, t.parent_id,
  t.completed_at, t.created_at, t.updated_at,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id) AS subtasks_total,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtasks_done
  FROM tasks t`;

const decorate = (r: TaskRow): Task => ({ ...r, tags: r.tags ? (JSON.parse(r.tags) as string[]) : [] });

/** Etiquetas sem repetição (ignorando maiúsculas) e na ordem em que foram informadas. */
function cleanTags(tags: string[] | undefined): string | null {
  if (!tags?.length) return null;
  const seen = new Map<string, string>();
  for (const t of tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return JSON.stringify([...seen.values()]);
}

export interface TaskFilter {
  /** Padrão: abertas (pendentes e em andamento). */
  status?: "open" | "done" | "all";
  project_id?: number;
  priority?: TaskPriority;
  tag?: string;
  search?: string;
  /** Prazo dentro do intervalo (inclusive). */
  due_from?: string;
  due_to?: string;
  /** Omitido: só tarefas principais. Número: subtarefas dessa tarefa. */
  parent_id?: number;
  ids?: number[];
  limit?: number;
}

export async function listTasks(ctx: Ctx, f: TaskFilter = {}): Promise<Task[]> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const status = f.status ?? "open";
  if (status === "open") where.push("t.status <> 'done'");
  if (status === "done") where.push("t.status = 'done'");
  if (f.ids) {
    if (!f.ids.length) return [];
    where.push(`t.id IN (${f.ids.map(() => "?").join(", ")})`);
    args.push(...f.ids);
  } else if (f.parent_id !== undefined) {
    where.push("t.parent_id = ?");
    args.push(f.parent_id);
  } else where.push("t.parent_id IS NULL");
  if (f.project_id) (where.push("t.project_id = ?"), args.push(f.project_id));
  if (f.priority) (where.push("t.priority = ?"), args.push(f.priority));
  if (f.tag) (where.push("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE lower(value) = lower(?))"), args.push(f.tag));
  if (f.search) (where.push("(t.title LIKE ? OR t.notes LIKE ?)"), args.push(`%${f.search}%`, `%${f.search}%`));
  if (f.due_from) (where.push("t.due_date >= ?"), args.push(f.due_from));
  if (f.due_to) (where.push("t.due_date <= ?"), args.push(f.due_to));
  const order = status === "done" ? "t.completed_at DESC, t.id DESC" : "t.id";
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${Math.min(f.limit ?? 500, 1000)}`;
  const tasks = (await ctx.db.prepare(sql).bind(...args).all<TaskRow>()).results.map(decorate);
  return status === "done" ? tasks : tasks.sort(compareTasks);
}

export async function getTask(ctx: Ctx, id: number): Promise<Task> {
  const row = await ctx.db.prepare(`${SELECT} WHERE t.id = ?`).bind(id).first<TaskRow>();
  if (!row) throw new UserError(`Tarefa ${id} não encontrada`, 404);
  return decorate(row);
}

async function checkRelations(ctx: Ctx, taskId: number | null, projectId: number | null | undefined, parentId: number | null | undefined) {
  if (projectId) await getProject(ctx, projectId);
  if (!parentId) return;
  if (parentId === taskId) throw new UserError("Uma tarefa não pode ser subtarefa dela mesma");
  const parent = await getTask(ctx, parentId);
  if (parent.parent_id) throw new UserError("Subtarefas têm um nível só: escolha uma tarefa principal");
  if (taskId) {
    const children = await ctx.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ?").bind(taskId).first<{ n: number }>();
    if (children?.n) throw new UserError("Esta tarefa tem subtarefas e não pode virar subtarefa de outra");
  }
}

export async function createTask(ctx: Ctx, input: z.input<typeof TaskInput>): Promise<Task> {
  const t = TaskInput.parse(input);
  await checkRelations(ctx, null, t.project_id, t.parent_id);
  const status = t.status ?? "todo";
  const row = await ctx.db
    .prepare(
      `INSERT INTO tasks (title, notes, status, priority, due_date, estimate_minutes, tags, project_id, parent_id, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      t.title,
      nn(t.notes),
      status,
      t.priority ?? "medium",
      nn(t.due_date),
      nn(t.estimate_minutes),
      cleanTags(t.tags),
      nn(t.project_id),
      nn(t.parent_id),
      status === "done" ? ctx.now : null,
    )
    .first<{ id: number }>();
  return getTask(ctx, row!.id);
}

/**
 * Edita a tarefa. Mudanças de status:
 * - concluir: grava completed_at, conclui as subtarefas abertas e registra no histórico;
 * - reabrir (de concluída para pendente/em andamento): limpa completed_at e registra no histórico.
 */
export async function updateTask(ctx: Ctx, id: number, patch: z.input<typeof TaskPatch>): Promise<Task> {
  const p = TaskPatch.parse(patch);
  const cur = await getTask(ctx, id);
  if (p.project_id !== undefined || p.parent_id !== undefined) await checkRelations(ctx, id, p.project_id, p.parent_id);

  const sets: Record<string, string | number | null> = {};
  for (const k of ["title", "notes", "priority", "due_date", "estimate_minutes", "project_id", "parent_id"] as const) {
    if (p[k] !== undefined) sets[k] = p[k];
  }
  if (p.tags !== undefined) sets.tags = cleanTags(p.tags);

  const extra: D1PreparedStatement[] = [];
  if (p.status && p.status !== cur.status) {
    sets.status = p.status;
    if (p.status === "done") {
      sets.completed_at = ctx.now;
      extra.push(
        ctx.db.prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = datetime('now') WHERE parent_id = ? AND status <> 'done'").bind(ctx.now, id),
        activity(ctx, "task.completed", "task", id, { open_subtasks: cur.subtasks_total - cur.subtasks_done }),
      );
    } else if (cur.status === "done") {
      sets.completed_at = null;
      extra.push(activity(ctx, "task.reopened", "task", id, { completed_at: cur.completed_at }));
    }
  }
  const keys = Object.keys(sets);
  if (!keys.length) return cur;
  await ctx.db.batch([
    ctx.db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...Object.values(sets), id),
    ...extra,
  ]);
  return getTask(ctx, id);
}

/** Exclui a tarefa e as subtarefas. Horários reservados para ela na agenda viram eventos comuns. */
export async function deleteTask(ctx: Ctx, id: number): Promise<Task> {
  const cur = await getTask(ctx, id);
  await ctx.db.batch([ctx.db.prepare("DELETE FROM tasks WHERE id = ?").bind(id), activity(ctx, "task.deleted", "task", id, { title: cur.title })]);
  return cur;
}

/** Resolve uma tarefa aberta pelo título (tolerante a acentos e maiúsculas). */
export async function resolveTask(ctx: Ctx, title: string, status: TaskFilter["status"] = "open"): Promise<Task> {
  const all = [...(await listTasks(ctx, { status })), ...(await listSubtasksOfOpen(ctx, status))];
  return findByName(all, title, (t) => [t.title], "Tarefa");
}

async function listSubtasksOfOpen(ctx: Ctx, status: TaskFilter["status"]): Promise<Task[]> {
  const sql = `${SELECT} WHERE t.parent_id IS NOT NULL${status === "open" ? " AND t.status <> 'done'" : status === "done" ? " AND t.status = 'done'" : ""} LIMIT 1000`;
  return (await ctx.db.prepare(sql).all<TaskRow>()).results.map(decorate);
}

/** Etiquetas já usadas, das mais frequentes para as menos. */
export async function listTags(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .prepare("SELECT j.value AS tag, COUNT(*) AS n FROM tasks t, json_each(t.tags) j GROUP BY lower(j.value) ORDER BY n DESC, tag LIMIT 50")
    .all<{ tag: string }>();
  return rows.results.map((r) => r.tag);
}

// ---------- projetos ----------

const PROJECT_SELECT = `SELECT p.id, p.name, p.description, p.status, p.due_date, p.color,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.status <> 'done') AS open_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.status = 'done') AS done_count
  FROM projects p`;

export async function listProjects(ctx: Ctx, includeArchived = false): Promise<Project[]> {
  const sql = `${PROJECT_SELECT} ${includeArchived ? "" : "WHERE p.status <> 'archived'"}
    ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, p.name COLLATE NOCASE`;
  return (await ctx.db.prepare(sql).all<Project>()).results;
}

export async function getProject(ctx: Ctx, id: number): Promise<Project> {
  const row = await ctx.db.prepare(`${PROJECT_SELECT} WHERE p.id = ?`).bind(id).first<Project>();
  if (!row) throw new UserError(`Projeto ${id} não encontrado`, 404);
  return row;
}

export async function createProject(ctx: Ctx, input: z.input<typeof ProjectInput>): Promise<Project> {
  const p = ProjectInput.parse(input);
  const row = await ctx.db
    .prepare("INSERT INTO projects (name, description, status, due_date, color) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .bind(p.name, nn(p.description), p.status ?? "active", nn(p.due_date), nn(p.color))
    .first<{ id: number }>();
  return getProject(ctx, row!.id);
}

export async function updateProject(ctx: Ctx, id: number, patch: z.input<typeof ProjectPatch>): Promise<Project> {
  const p = ProjectPatch.parse(patch);
  const updated_at = new Date().toISOString().replace("T", " ").slice(0, 19); // mesmo formato de datetime('now')
  await updateRow(ctx.db, "projects", id, { ...p, updated_at }, ["name", "description", "status", "due_date", "color", "updated_at"]);
  return getProject(ctx, id);
}

/** Exclui o projeto; as tarefas continuam, sem projeto. */
export async function deleteProject(ctx: Ctx, id: number): Promise<Project> {
  const cur = await getProject(ctx, id);
  await ctx.db.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  return cur;
}

export async function resolveProject(ctx: Ctx, name: string): Promise<Project> {
  return findByName(await listProjects(ctx, true), name, (p) => [p.name], "Projeto");
}
