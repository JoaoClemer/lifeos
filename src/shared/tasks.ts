// Tarefas e projetos: formatos da API e regras puras usadas no Worker e no app.

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type ProjectStatus = "active" | "paused" | "done" | "archived";

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "Pendente", doing: "Em andamento", done: "Concluída" };
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { high: "Alta", medium: "Média", low: "Baixa" };
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = { active: "Ativo", paused: "Pausado", done: "Concluído", archived: "Arquivado" };

export interface Task {
  id: number;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** Prazo (dia). Não ocupa horário na agenda. */
  due_date: string | null;
  estimate_minutes: number | null;
  tags: string[];
  project_id: number | null;
  parent_id: number | null;
  /** Data e hora local da conclusão. */
  completed_at: string | null;
  /** Repetição (RRULE): ao concluir, a próxima tarefa é criada com o novo prazo. */
  rrule: string | null;
  /** Tarefa concluída que gerou esta (na repetição). */
  recurrence_of: number | null;
  created_at: string;
  updated_at: string;
  subtasks_total: number;
  subtasks_done: number;
  /** Quem criou, quando não foi você (tarefa de uma lista compartilhada ou designada a você). */
  owner: PersonRef | null;
  /** Pessoa designada para a tarefa (null = ninguém). */
  assignee: PersonRef | null;
  /** Você pode excluir: criou a tarefa ou é dono(a) da lista. */
  can_delete: boolean;
}

export interface PersonRef {
  id: number;
  name: string | null;
}

/** Membro de uma lista (projeto) compartilhada. */
export interface ProjectMember extends PersonRef {
  role: "owner" | "member";
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  status: ProjectStatus;
  due_date: string | null;
  color: string | null;
  open_count: number;
  done_count: number;
  /** Dono(a) da lista, quando não é você (você é membro). */
  owner: PersonRef | null;
  /** Quantas pessoas, além do dono, participam da lista. */
  members: number;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** Onde a tarefa aparece na lista de abertas, de acordo com o prazo. */
export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

export function dueGroup(task: Pick<Task, "due_date">, today: string, weekEnd: string): DueGroup {
  if (!task.due_date) return "none";
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "today";
  return task.due_date <= weekEnd ? "week" : "later";
}

/** Ordem das tarefas abertas: atrasadas e com prazo mais cedo primeiro; no mesmo prazo, maior prioridade; sem prazo por último. */
export function compareTasks(a: Task, b: Task): number {
  const da = a.due_date ?? "9999-12-31";
  const db = b.due_date ?? "9999-12-31";
  return da.localeCompare(db) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id;
}
