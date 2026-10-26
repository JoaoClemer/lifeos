// Tarefas e projetos. Regras: uma tarefa pode não ter prazo; prazo não ocupa horário na agenda;
// concluir registra a data e hora (e conclui as subtarefas abertas); reabrir limpa a conclusão, mas o histórico fica em activity_log.
// Tarefa que se repete: ao concluir, a próxima é criada com o novo prazo (e as subtarefas abertas de novo);
// cada conclusão fica como uma tarefa concluída. Reabrir remove a próxima, se ela ainda não foi feita.
// Compartilhamento: uma tarefa é vista e editada por quem criou, pela pessoa designada e pelos membros da lista (projeto)
// em que está. Só quem criou ou o dono da lista exclui. Subtarefas seguem a tarefa principal (mesmo dono, lista e pessoa designada).
// Só o dono altera a lista e os membros dela.
import { z } from "zod";
import { isValidDate } from "../../../shared/datetime";
import { formatRRule, nextDateAfter, parseRRule } from "../../../shared/recurrence";
import { compareTasks, type Project, type ProjectMember, type Task, type TaskPriority } from "../../../shared/tasks";
import { activity } from "../../activity";
import { type Ctx, findByName, nn, updateRow, UserError } from "../../lib";
import { listConnections } from "../connections/service";

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
  /** Repetição (RRULE, ex.: FREQ=WEEKLY;BYDAY=MO). null = não repete. */
  rrule: z.string().nullable().optional(),
  /** Pessoa designada (você ou alguém conectado). null = ninguém. */
  assignee_user_id: z.number().int().nullable().optional(),
});
export const TaskPatch = TaskInput.partial();

// ---------- acesso ----------

/** Listas (projetos) que a pessoa vê: dela ou das quais é membro. Usa 2 parâmetros (a pessoa). */
const PROJECT_ACCESS = "(p.user_id = ? OR p.id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = ?))";

/** Tarefas que a pessoa vê e edita: criadas por ela, designadas a ela ou numa lista que ela vê. Usa 4 parâmetros (a pessoa). */
const taskAccess = (t: string) => `(${t}.user_id = ? OR ${t}.assignee_user_id = ? OR ${t}.project_id IN (SELECT p.id FROM projects p WHERE ${PROJECT_ACCESS}))`;
const me4 = (ctx: Ctx) => [ctx.userId, ctx.userId, ctx.userId, ctx.userId];

/** Valida a repetição de uma tarefa e devolve a forma canônica. Tarefas não aceitam COUNT (a série é de tarefas separadas). */
function taskRule(text: string): string {
  let r;
  try {
    r = parseRRule(text);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
  if (r.count) throw new UserError("Em tarefas, a repetição termina numa data (UNTIL), não num número de vezes");
  return formatRRule(r);
}

export const ProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().nullable().optional(),
  status: z.enum(["active", "paused", "done", "archived"]).optional(),
  due_date: dateArg.nullable().optional(),
  color: z.string().nullable().optional(),
});
export const ProjectPatch = ProjectInput.partial();

type TaskRow = Omit<Task, "tags" | "owner" | "assignee" | "can_delete"> & {
  tags: string | null;
  owner_id: number;
  owner_name: string | null;
  assignee_user_id: number | null;
  assignee_name: string | null;
  project_owner_id: number | null;
};

const SELECT = `SELECT t.id, t.title, t.notes, t.status, t.priority, t.due_date, t.estimate_minutes, t.tags, t.project_id, t.parent_id,
  t.completed_at, t.rrule, t.recurrence_of, t.created_at, t.updated_at,
  t.user_id AS owner_id, ou.name AS owner_name, t.assignee_user_id, au.name AS assignee_name, pr.user_id AS project_owner_id,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.user_id = t.user_id) AS subtasks_total,
  (SELECT COUNT(*) FROM tasks s WHERE s.parent_id = t.id AND s.user_id = t.user_id AND s.status = 'done') AS subtasks_done
  FROM tasks t LEFT JOIN users ou ON ou.id = t.user_id LEFT JOIN users au ON au.id = t.assignee_user_id LEFT JOIN projects pr ON pr.id = t.project_id`;

const decorateFor =
  (me: number) =>
  ({ owner_id, owner_name, assignee_user_id, assignee_name, project_owner_id, ...r }: TaskRow): Task => ({
    ...r,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    owner: owner_id === me ? null : { id: owner_id, name: owner_name },
    assignee: assignee_user_id ? { id: assignee_user_id, name: assignee_name } : null,
    can_delete: owner_id === me || project_owner_id === me,
  });

/** Dono da tarefa (quem criou a tarefa principal). */
const ownerOf = (ctx: Ctx, t: Task) => t.owner?.id ?? ctx.userId;

/** Pessoa designada válida: você ou alguém conectado. */
async function checkAssignee(ctx: Ctx, id: number | null | undefined): Promise<void> {
  if (!id || id === ctx.userId) return;
  if (!(await listConnections(ctx)).some((c) => c.user_id === id)) throw new UserError("Só dá para designar tarefas a pessoas conectadas a você", 404);
}

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
  /**
   * Sem lista nem ids: as tarefas da pessoa. Ficam de fora as de listas compartilhadas designadas a outra pessoa
   * por outra pessoa (aparecem ao filtrar pela lista).
   */
  project_id?: number;
  priority?: TaskPriority;
  tag?: string;
  search?: string;
  /** Prazo dentro do intervalo (inclusive). */
  due_from?: string;
  due_to?: string;
  /** Concluídas entre estes dias (inclusive). */
  completed_from?: string;
  completed_to?: string;
  /** Omitido: só tarefas principais. Número: subtarefas dessa tarefa. */
  parent_id?: number;
  ids?: number[];
  limit?: number;
}

export async function listTasks(ctx: Ctx, f: TaskFilter = {}): Promise<Task[]> {
  const where: string[] = [taskAccess("t")];
  const args: (string | number)[] = me4(ctx);
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
  else if (!f.ids && f.parent_id === undefined) {
    where.push("(t.assignee_user_id IS NULL OR t.assignee_user_id = ? OR t.user_id = ?)");
    args.push(ctx.userId, ctx.userId);
  }
  if (f.priority) (where.push("t.priority = ?"), args.push(f.priority));
  if (f.tag) (where.push("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE lower(value) = lower(?))"), args.push(f.tag));
  if (f.search) (where.push("(t.title LIKE ? OR t.notes LIKE ?)"), args.push(`%${f.search}%`, `%${f.search}%`));
  if (f.due_from) (where.push("t.due_date >= ?"), args.push(f.due_from));
  if (f.due_to) (where.push("t.due_date <= ?"), args.push(f.due_to));
  // completed_at é data e hora local ('YYYY-MM-DDTHH:MM'): compara pelo dia
  if (f.completed_from) (where.push("substr(t.completed_at, 1, 10) >= ?"), args.push(f.completed_from));
  if (f.completed_to) (where.push("substr(t.completed_at, 1, 10) <= ?"), args.push(f.completed_to));
  const order = status === "done" ? "t.completed_at DESC, t.id DESC" : "t.id";
  const sql = `${SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${Math.min(f.limit ?? 500, 1000)}`;
  const tasks = (await ctx.db.prepare(sql).bind(...args).all<TaskRow>()).results.map(decorateFor(ctx.userId));
  return status === "done" ? tasks : tasks.sort(compareTasks);
}

export async function getTask(ctx: Ctx, id: number): Promise<Task> {
  const row = await ctx.db.prepare(`${SELECT} WHERE t.id = ? AND ${taskAccess("t")}`).bind(id, ...me4(ctx)).first<TaskRow>();
  if (!row) throw new UserError(`Tarefa ${id} não encontrada`, 404);
  return decorateFor(ctx.userId)(row);
}

async function checkRelations(ctx: Ctx, taskId: number | null, projectId: number | null | undefined, parentId: number | null | undefined): Promise<Task | null> {
  if (projectId) await getProject(ctx, projectId);
  if (!parentId) return null;
  if (parentId === taskId) throw new UserError("Uma tarefa não pode ser subtarefa dela mesma");
  const parent = await getTask(ctx, parentId);
  if (parent.parent_id) throw new UserError("Subtarefas têm um nível só: escolha uma tarefa principal");
  if (taskId) {
    const children = await ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE parent_id = ? AND ${taskAccess("tasks")}`)
      .bind(taskId, ...me4(ctx))
      .first<{ n: number }>();
    if (children?.n) throw new UserError("Esta tarefa tem subtarefas e não pode virar subtarefa de outra");
  }
  return parent;
}

export async function createTask(ctx: Ctx, input: z.input<typeof TaskInput>): Promise<Task> {
  const t = TaskInput.parse(input);
  const parent = await checkRelations(ctx, null, t.project_id, t.parent_id);
  await checkAssignee(ctx, t.assignee_user_id);
  const status = t.status ?? "todo";
  const rrule = t.rrule ? taskRule(t.rrule) : null;
  if (rrule && t.parent_id) throw new UserError("Subtarefas não se repetem: defina a repetição na tarefa principal");
  // Subtarefa segue a principal: mesmo dono, mesma lista e mesma pessoa designada
  const owner = parent ? ownerOf(ctx, parent) : ctx.userId;
  const projectId = parent ? parent.project_id : nn(t.project_id);
  const assignee = parent ? (parent.assignee?.id ?? null) : nn(t.assignee_user_id);
  const row = await ctx.db
    .prepare(
      `INSERT INTO tasks (user_id, title, notes, status, priority, due_date, estimate_minutes, tags, project_id, parent_id, completed_at, rrule, assignee_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      owner,
      t.title,
      nn(t.notes),
      status,
      t.priority ?? "medium",
      // Tarefa que se repete precisa de prazo: sem um, começa hoje
      t.due_date ?? (rrule ? ctx.today : null),
      nn(t.estimate_minutes),
      cleanTags(t.tags),
      projectId,
      nn(t.parent_id),
      status === "done" ? ctx.now : null,
      rrule,
      assignee,
    )
    .first<{ id: number }>();
  return getTask(ctx, row!.id);
}

/** A próxima tarefa gerada pela conclusão desta (na repetição), se houver. */
export async function getSuccessor(ctx: Ctx, id: number): Promise<Task | null> {
  const row = await ctx.db
    .prepare(`${SELECT} WHERE t.recurrence_of = ? AND ${taskAccess("t")} ORDER BY t.id DESC LIMIT 1`)
    .bind(id, ...me4(ctx))
    .first<TaskRow>();
  return row ? decorateFor(ctx.userId)(row) : null;
}

/**
 * Edita a tarefa. Mudanças de status:
 * - concluir: grava completed_at, conclui as subtarefas abertas e registra no histórico;
 * - reabrir (de concluída para pendente/em andamento): limpa completed_at e registra no histórico.
 */
export async function updateTask(ctx: Ctx, id: number, patch: z.input<typeof TaskPatch>): Promise<Task> {
  const p = TaskPatch.parse(patch);
  const cur = await getTask(ctx, id);
  const owner = ownerOf(ctx, cur);
  const parent = p.project_id !== undefined || p.parent_id !== undefined ? await checkRelations(ctx, id, p.project_id, p.parent_id) : null;
  if (parent && ownerOf(ctx, parent) !== owner) throw new UserError("Só dá para mover para dentro de uma tarefa da mesma pessoa");
  if (p.assignee_user_id !== undefined) await checkAssignee(ctx, p.assignee_user_id);

  const sets: Record<string, string | number | null> = {};
  for (const k of ["title", "notes", "priority", "due_date", "estimate_minutes", "project_id", "parent_id", "assignee_user_id"] as const) {
    if (p[k] !== undefined) sets[k] = p[k];
  }
  // Virou subtarefa: segue a lista e a pessoa designada da principal
  if (parent) Object.assign(sets, { project_id: parent.project_id, assignee_user_id: parent.assignee?.id ?? null });
  if (p.tags !== undefined) sets.tags = cleanTags(p.tags);

  // Repetição: precisa de prazo (sem um, começa hoje) e não vale para subtarefas
  const rule = p.rrule === undefined ? cur.rrule : p.rrule ? taskRule(p.rrule) : null;
  if (p.rrule !== undefined) sets.rrule = rule;
  if (rule && (p.parent_id ?? cur.parent_id)) throw new UserError("Subtarefas não se repetem: defina a repetição na tarefa principal");
  if (rule && p.due_date === null) throw new UserError("Tarefa que se repete precisa de prazo. Para tirar o prazo, pare a repetição antes");
  if (rule && !cur.due_date && p.due_date === undefined) sets.due_date = ctx.today;
  const due = (sets.due_date as string | null | undefined) ?? cur.due_date;

  const extra: D1PreparedStatement[] = [];
  // Mudou a lista ou a pessoa designada da principal: as subtarefas vão junto
  if (!cur.parent_id && (sets.project_id !== undefined || sets.assignee_user_id !== undefined)) {
    extra.push(
      ctx.db
        .prepare("UPDATE tasks SET project_id = ?, assignee_user_id = ?, updated_at = datetime('now') WHERE parent_id = ? AND user_id = ?")
        .bind(
          sets.project_id !== undefined ? sets.project_id : cur.project_id,
          sets.assignee_user_id !== undefined ? sets.assignee_user_id : (cur.assignee?.id ?? null),
          id,
          owner,
        ),
    );
  }
  if (p.status && p.status !== cur.status) {
    sets.status = p.status;
    if (p.status === "done") {
      sets.completed_at = ctx.now;
      // Próxima da série: primeira data da regra depois do prazo atual ou de hoje (o que vier depois),
      // para não nascer atrasada nem pular uma vez quando concluída adiantada
      const next = rule && due && !cur.parent_id && !(await getSuccessor(ctx, id)) ? nextDateAfter(due, parseRRule(rule), due > ctx.today ? due : ctx.today) : null;
      extra.push(
        ctx.db
          .prepare("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = datetime('now') WHERE parent_id = ? AND user_id = ? AND status <> 'done'")
          .bind(ctx.now, id, owner),
        activity(ctx, "task.completed", "task", id, { open_subtasks: cur.subtasks_total - cur.subtasks_done, ...(next ? { next_due: next } : {}) }),
      );
      if (next) {
        // Copia a tarefa (já com as alterações deste patch) e as subtarefas, abertas
        extra.push(
          ctx.db
            .prepare(
              `INSERT INTO tasks (user_id, title, notes, priority, due_date, estimate_minutes, tags, project_id, rrule, recurrence_of, assignee_user_id)
               SELECT user_id, title, notes, priority, ?, estimate_minutes, tags, project_id, rrule, id, assignee_user_id FROM tasks WHERE id = ? AND user_id = ?`,
            )
            .bind(next, id, owner),
          ctx.db
            .prepare(
              `INSERT INTO tasks (user_id, title, notes, priority, estimate_minutes, tags, project_id, assignee_user_id, parent_id)
               SELECT s.user_id, s.title, s.notes, s.priority, s.estimate_minutes, s.tags, s.project_id, s.assignee_user_id,
                 (SELECT n.id FROM tasks n WHERE n.recurrence_of = ?1 AND n.user_id = ?2 ORDER BY n.id DESC LIMIT 1)
               FROM tasks s WHERE s.parent_id = ?1 AND s.user_id = ?2 ORDER BY s.id`,
            )
            .bind(id, owner),
        );
      }
    } else if (cur.status === "done") {
      sets.completed_at = null;
      // A próxima da série sai se ainda não foi feita (senão haveria duas abertas)
      extra.push(
        ctx.db.prepare("DELETE FROM tasks WHERE recurrence_of = ? AND user_id = ? AND status <> 'done'").bind(id, owner),
        activity(ctx, "task.reopened", "task", id, { completed_at: cur.completed_at }),
      );
    }
  }
  const keys = Object.keys(sets);
  if (!keys.length) return cur;
  await ctx.db.batch([
    ctx.db
      .prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .bind(...Object.values(sets), id, owner),
    ...extra,
  ]);
  return getTask(ctx, id);
}

/** Exclui a tarefa e as subtarefas (quem criou ou o dono da lista). Horários reservados para ela na agenda viram eventos comuns. */
export async function deleteTask(ctx: Ctx, id: number): Promise<Task> {
  const cur = await getTask(ctx, id);
  if (!cur.can_delete) throw new UserError("Só quem criou a tarefa ou o dono da lista pode excluí-la", 403);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM tasks WHERE id = ? AND user_id = ?").bind(id, ownerOf(ctx, cur)),
    activity(ctx, "task.deleted", "task", id, { title: cur.title }),
  ]);
  return cur;
}

/** Resolve uma tarefa aberta pelo título (tolerante a acentos e maiúsculas). */
export async function resolveTask(ctx: Ctx, title: string, status: TaskFilter["status"] = "open"): Promise<Task> {
  const all = [...(await listTasks(ctx, { status })), ...(await listSubtasksOfOpen(ctx, status))];
  return findByName(all, title, (t) => [t.title], "Tarefa");
}

async function listSubtasksOfOpen(ctx: Ctx, status: TaskFilter["status"]): Promise<Task[]> {
  const sql = `${SELECT} WHERE ${taskAccess("t")} AND t.parent_id IS NOT NULL${status === "open" ? " AND t.status <> 'done'" : status === "done" ? " AND t.status = 'done'" : ""} LIMIT 1000`;
  return (await ctx.db.prepare(sql).bind(...me4(ctx)).all<TaskRow>()).results.map(decorateFor(ctx.userId));
}

/** Tarefa com o mesmo título criada há pouco (evita duplicar quando o Claude repete uma chamada). */
export async function findRecentTask(ctx: Ctx, title: string, minutes = 10): Promise<Task | null> {
  const row = await ctx.db
    .prepare("SELECT id FROM tasks WHERE user_id = ? AND lower(title) = lower(?) AND parent_id IS NULL AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1")
    .bind(ctx.userId, title.trim(), `-${minutes} minutes`)
    .first<{ id: number }>();
  return row ? getTask(ctx, row.id) : null;
}

/** Etiquetas já usadas, das mais frequentes para as menos. */
export async function listTags(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .prepare(`SELECT j.value AS tag, COUNT(*) AS n FROM tasks t, json_each(t.tags) j WHERE ${taskAccess("t")} GROUP BY lower(j.value) ORDER BY n DESC, tag LIMIT 50`)
    .bind(...me4(ctx))
    .all<{ tag: string }>();
  return rows.results.map((r) => r.tag);
}

// ---------- projetos (listas) ----------

type ProjectRow = Omit<Project, "owner"> & { owner_id: number; owner_name: string | null };

const PROJECT_SELECT = `SELECT p.id, p.name, p.description, p.status, p.due_date, p.color, p.user_id AS owner_id, ou.name AS owner_name,
  (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id AND m.user_id <> p.user_id) AS members,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.status <> 'done') AS open_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.parent_id IS NULL AND t.status = 'done') AS done_count
  FROM projects p LEFT JOIN users ou ON ou.id = p.user_id`;

const projectFor =
  (me: number) =>
  ({ owner_id, owner_name, ...p }: ProjectRow): Project => ({ ...p, owner: owner_id === me ? null : { id: owner_id, name: owner_name } });

export async function listProjects(ctx: Ctx, includeArchived = false): Promise<Project[]> {
  const sql = `${PROJECT_SELECT} WHERE ${PROJECT_ACCESS} ${includeArchived ? "" : "AND p.status <> 'archived'"}
    ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, p.name COLLATE NOCASE`;
  return (await ctx.db.prepare(sql).bind(ctx.userId, ctx.userId).all<ProjectRow>()).results.map(projectFor(ctx.userId));
}

export async function getProject(ctx: Ctx, id: number): Promise<Project> {
  const row = await ctx.db.prepare(`${PROJECT_SELECT} WHERE p.id = ? AND ${PROJECT_ACCESS}`).bind(id, ctx.userId, ctx.userId).first<ProjectRow>();
  if (!row) throw new UserError(`Projeto ${id} não encontrado`, 404);
  return projectFor(ctx.userId)(row);
}

/** Só o dono altera a lista (nome, situação, membros) ou a exclui. */
async function ownProject(ctx: Ctx, id: number): Promise<Project> {
  const p = await getProject(ctx, id);
  if (p.owner) throw new UserError(`Só ${p.owner.name ?? "o dono"} pode alterar esta lista`, 403);
  return p;
}

export async function createProject(ctx: Ctx, input: z.input<typeof ProjectInput>): Promise<Project> {
  const p = ProjectInput.parse(input);
  const row = await ctx.db
    .prepare("INSERT INTO projects (user_id, name, description, status, due_date, color) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .bind(ctx.userId, p.name, nn(p.description), p.status ?? "active", nn(p.due_date), nn(p.color))
    .first<{ id: number }>();
  return getProject(ctx, row!.id);
}

export async function updateProject(ctx: Ctx, id: number, patch: z.input<typeof ProjectPatch>): Promise<Project> {
  const p = ProjectPatch.parse(patch);
  await ownProject(ctx, id);
  const updated_at = new Date().toISOString().replace("T", " ").slice(0, 19); // mesmo formato de datetime('now')
  await updateRow(ctx, "projects", id, { ...p, updated_at }, ["name", "description", "status", "due_date", "color", "updated_at"]);
  return getProject(ctx, id);
}

/** Exclui o projeto; as tarefas continuam, sem projeto (cada uma com quem a criou). */
export async function deleteProject(ctx: Ctx, id: number): Promise<Project> {
  const cur = await ownProject(ctx, id);
  await ctx.db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
  return cur;
}

export async function resolveProject(ctx: Ctx, name: string): Promise<Project> {
  return findByName(await listProjects(ctx, true), name, (p) => [p.name], "Projeto");
}

// ---------- membros da lista ----------

/** Dono e membros de uma lista que você vê. */
export async function listProjectMembers(ctx: Ctx, id: number): Promise<ProjectMember[]> {
  const project = await getProject(ctx, id);
  const ownerId = project.owner?.id ?? ctx.userId;
  const [owner, members] = await ctx.db.batch<{ id: number; name: string | null }>([
    ctx.db.prepare("SELECT id, name FROM users WHERE id = ?").bind(ownerId),
    ctx.db
      .prepare(
        `SELECT u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = ? AND pm.user_id <> ? ORDER BY u.name COLLATE NOCASE`,
      )
      .bind(id, ownerId),
  ]);
  return [...owner.results.map((u) => ({ ...u, role: "owner" as const })), ...members.results.map((u) => ({ ...u, role: "member" as const }))];
}

/** Define os membros da lista (só o dono; só pessoas conectadas). Quem sai continua com as tarefas que criou. */
export async function setProjectMembers(ctx: Ctx, id: number, userIds: number[]): Promise<ProjectMember[]> {
  await ownProject(ctx, id);
  const ids = [...new Set(userIds)].filter((u) => u !== ctx.userId);
  if (ids.length) {
    const connected = new Set((await listConnections(ctx)).map((c) => c.user_id));
    if (ids.some((u) => !connected.has(u))) throw new UserError("Só dá para compartilhar listas com pessoas conectadas a você", 404);
  }
  await ctx.db.batch([
    ctx.db
      .prepare(
        `DELETE FROM project_members WHERE project_id = ?1 AND user_id <> ?2 ${ids.length ? `AND user_id NOT IN (${ids.map(() => "?").join(", ")})` : ""}
         AND EXISTS (SELECT 1 FROM projects WHERE id = ?1 AND user_id = ?2)`,
      )
      .bind(id, ctx.userId, ...ids),
    ...ids.map((u) =>
      ctx.db
        .prepare("INSERT OR IGNORE INTO project_members (project_id, user_id) SELECT p.id, ? FROM projects p WHERE p.id = ? AND p.user_id = ?")
        .bind(u, id, ctx.userId),
    ),
  ]);
  return listProjectMembers(ctx, id);
}

/** Sair de uma lista compartilhada com você. Suas tarefas nela continuam suas. */
export async function leaveProject(ctx: Ctx, id: number): Promise<void> {
  const res = await ctx.db.prepare("DELETE FROM project_members WHERE project_id = ? AND user_id = ?").bind(id, ctx.userId).run();
  if (!res.meta.changes) throw new UserError("Você não participa desta lista", 404);
}
