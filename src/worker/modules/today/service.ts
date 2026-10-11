// Composição dos módulos, só leitura: agenda unificada e tela Hoje.
// Usa apenas funções públicas dos services de cada módulo (nenhum SQL nas tabelas deles).
import type { AgendaItem } from "../../../shared/agenda";
import { addDays, isValidDate, startOfWeek } from "../../../shared/datetime";
import type { EventItem, Today, TodayFinance, Week } from "../../../shared/today";
import { type Ctx, UserError } from "../../lib";
import { listOccurrences } from "../agenda/service";
import { listTasks } from "../tasks/service";
import { listSessions, weekStats } from "../training/service";
import { getSummary } from "../../services/summary";

/** Posição do item no dia: pelo horário; treinos sem horário depois dos de dia inteiro; prazos de tarefas no fim. */
function sortKey(i: AgendaItem): string {
  if (i.kind === "event") return i.start_at;
  if (i.kind === "training") return `${i.date}T${i.session.time ?? "00:00"}`;
  return `${i.date}T99`;
}

/** Agenda unificada entre os dias `from` e `to` (inclusive): eventos, treinos e prazos de tarefas abertas. */
export async function getAgenda(ctx: Ctx, from: string, to: string): Promise<AgendaItem[]> {
  const [occurrences, due, sessions] = await Promise.all([
    listOccurrences(ctx, from, to),
    listTasks(ctx, { due_from: from, due_to: to }),
    listSessions(ctx, from, to),
  ]);
  const taskIds = [...new Set(occurrences.map((o) => o.task_id).filter((id): id is number => id !== null))];
  const linked = new Map((await listTasks(ctx, { status: "all", ids: taskIds })).map((t) => [t.id, t]));
  const items: AgendaItem[] = occurrences.map((o) => {
    const t = o.task_id ? linked.get(o.task_id) : undefined;
    return { kind: "event", ...o, task: t ? { id: t.id, title: t.title, status: t.status } : null };
  });
  for (const session of sessions) items.push({ kind: "training", date: session.date, session });
  for (const task of due) items.push({ kind: "task_due", date: task.due_date!, task });
  // sort é estável: dentro do mesmo horário mantém a ordem de cada módulo
  return items.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

/** Resumo financeiro do mês atual: só lê o resultado de getSummary (as regras ficam no módulo de finanças). */
export async function getFinance(ctx: Ctx): Promise<TodayFinance> {
  const s = await getSummary(ctx, ctx.month);
  return {
    month: s.month,
    total_cents: s.totals.total_cents,
    income_cents: s.totals.income_cents,
    leftover_cents: s.totals.leftover_cents,
    closing_cents: s.balance?.closing_cents ?? null,
    receivable_pending_cents: s.totals.receivable_pending_cents,
    budgets_attention: s.budgets
      .filter((b) => b.limit_cents > 0 && b.spent_cents >= b.limit_cents * 0.85)
      .map((b) => ({ id: b.id, description: b.description, spent_cents: b.spent_cents, limit_cents: b.limit_cents, remaining_cents: b.remaining_cents })),
  };
}

/** Semana (segunda a domingo) da data: compromissos, tarefas e treinos. */
export async function getWeek(ctx: Ctx, date: string): Promise<Week> {
  if (!isValidDate(date)) throw new UserError("Data inválida (use YYYY-MM-DD)");
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const [occurrences, done, dueOpen, overdue, training] = await Promise.all([
    listOccurrences(ctx, start, end),
    listTasks(ctx, { status: "done", completed_from: start, completed_to: end }),
    listTasks(ctx, { due_from: start, due_to: end }),
    listTasks(ctx, { due_to: addDays(start, -1) }),
    weekStats(ctx, start),
  ]);
  return { week_start: start, week_end: end, events: occurrences.length, tasks: { done, due_open: dueOpen, overdue: overdue.length }, training };
}

export async function getToday(ctx: Ctx): Promise<Today> {
  const weekEnd = addDays(ctx.today, 7);
  const [agenda, open, finance] = await Promise.all([getAgenda(ctx, ctx.today, weekEnd), listTasks(ctx, {}), getFinance(ctx)]);
  const events = agenda.filter((i): i is EventItem => i.kind === "event");
  return {
    date: ctx.today,
    now: ctx.now,
    events: events.filter((e) => e.start_at.slice(0, 10) <= ctx.today),
    upcoming: events.filter((e) => e.start_at.slice(0, 10) > ctx.today).slice(0, 5),
    tasks: {
      overdue: open.filter((t) => t.due_date && t.due_date < ctx.today),
      today: open.filter((t) => t.due_date === ctx.today),
      priority: open.filter((t) => t.priority === "high" && (!t.due_date || t.due_date > ctx.today)).slice(0, 5),
    },
    training: agenda.flatMap((i) => (i.kind === "training" && i.date === ctx.today ? [i.session] : [])),
    finance,
  };
}
