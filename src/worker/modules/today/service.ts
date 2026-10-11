// Composição dos módulos, só leitura: agenda unificada e tela Hoje.
// Usa apenas funções públicas dos services de cada módulo (nenhum SQL nas tabelas deles).
import type { AgendaItem } from "../../../shared/agenda";
import { addDays } from "../../../shared/datetime";
import type { EventItem, Today } from "../../../shared/today";
import type { Ctx } from "../../lib";
import { listOccurrences } from "../agenda/service";
import { listTasks } from "../tasks/service";
import { listSessions } from "../training/service";

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

export async function getToday(ctx: Ctx): Promise<Today> {
  const weekEnd = addDays(ctx.today, 7);
  const [agenda, open] = await Promise.all([getAgenda(ctx, ctx.today, weekEnd), listTasks(ctx, {})]);
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
  };
}
