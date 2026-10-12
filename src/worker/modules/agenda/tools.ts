// Ferramentas MCP da agenda. Chamam o mesmo service da API (mesmas regras e validações).
import { z } from "zod";
import { type AgendaItem, lastDay, type Occurrence } from "../../../shared/agenda";
import { addDays, addMinutes, diffDays, isValidLocal, startOfWeek } from "../../../shared/datetime";
import { formatPlanDuration, STATUS_LABEL } from "../../../shared/training";
import { type Ctx, UserError } from "../../lib";
import { confirmArg, dateArg, dayLabel, needsConfirmation, repeatArg, SCOPES, scopeArg, timeArg, toDate, toRRule, toTime } from "../../mcp/args";
import { type Tool, tool } from "../../mcp/tool";
import { getTask, resolveTask } from "../tasks/service";
import { getAgenda } from "../today/service";
import * as agenda from "./service";

function timeRange(o: Pick<Occurrence, "all_day" | "start_at" | "end_at">): string {
  if (o.all_day) {
    const last = lastDay(o);
    return last === o.start_at.slice(0, 10) ? "dia inteiro" : `dia inteiro até ${last.slice(8)}/${last.slice(5, 7)}`;
  }
  const sameDay = o.start_at.slice(0, 10) === o.end_at.slice(0, 10);
  return `${o.start_at.slice(11)}–${sameDay ? "" : `${o.end_at.slice(8, 10)}/${o.end_at.slice(5, 7)} `}${o.end_at.slice(11)}`;
}

function itemLine(i: AgendaItem): string {
  if (i.kind === "event") {
    const ref = [`evento ${i.event_id}`, i.rrule ? `ocorrência ${i.occurrence_start}, repete` : null].filter(Boolean).join(", ");
    const extra = [i.location, i.url, i.category].filter(Boolean).join(" · ");
    const task = i.task ? ` — horário para a tarefa [tarefa ${i.task.id}]${i.task.status === "done" ? " (concluída)" : ""}` : "";
    return `• ${timeRange(i)} ${i.title}${extra ? ` (${extra})` : ""}${task} [${ref}]`;
  }
  if (i.kind === "training") {
    const s = i.session;
    const plan = [s.planned_distance_m && `${s.planned_distance_m / 1000} km`, s.planned_duration_s && formatPlanDuration(s.planned_duration_s)].filter(Boolean).join(", ");
    return `• ${s.time ?? "sem horário"} Treino: ${s.title ?? s.sport}${plan ? ` (${plan})` : ""} — ${STATUS_LABEL[s.status].toLowerCase()} [treino ${s.id}]`;
  }
  return `• Prazo da tarefa: ${i.task.title} [tarefa ${i.task.id}]`;
}

/** Agenda por dia, em texto. */
export async function agendaText(ctx: Ctx, from: string, to: string): Promise<string> {
  const items = await getAgenda(ctx, from, to);
  const lines = [`Agenda de ${dayLabel(from, ctx.today)} a ${dayLabel(to, ctx.today)} (agora: ${ctx.now.replace("T", " ")}):`];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = items.filter((i) => (i.kind === "event" ? i.start_at.slice(0, 10) <= d && i.end_at > `${d}T00:00` : i.date === d));
    lines.push("", dayLabel(d, ctx.today), ...(day.length ? day.map(itemLine) : ["(livre)"]));
  }
  return lines.join("\n");
}

/** Início e fim no formato do service a partir de data/horários informados. */
function timingArgs(ctx: Ctx, a: { data: string; hora_inicio?: string; hora_fim?: string; duracao_min?: number; data_fim?: string }) {
  const date = toDate(ctx, a.data);
  const endDate = a.data_fim ? toDate(ctx, a.data_fim) : date;
  if (!a.hora_inicio) return { all_day: true, start: date, end: endDate };
  const start = `${date}T${toTime(a.hora_inicio)}`;
  const end = a.hora_fim ? `${endDate}T${toTime(a.hora_fim)}` : a.duracao_min ? addMinutes(start, a.duracao_min) : undefined;
  return { all_day: false, start, end };
}

const occurrenceArg = z.string().optional().describe("Em evento que se repete: o início da ocorrência (AAAA-MM-DDTHH:MM), como aparece na agenda");

function scopeOf(a: { alcance?: keyof typeof SCOPES; ocorrencia?: string }) {
  if (a.ocorrencia && !isValidLocal(a.ocorrencia.replace(" ", "T"))) throw new UserError("ocorrencia deve ser AAAA-MM-DDTHH:MM, como aparece na agenda");
  return { scope: a.alcance ? SCOPES[a.alcance] : undefined, occurrence_start: a.ocorrencia?.replace(" ", "T") };
}

export const AGENDA_TOOLS: Tool[] = [
  tool({
    name: "agenda",
    title: "Consultar agenda",
    description:
      "Mostra a agenda por dia: compromissos, horários reservados para tarefas, treinos e prazos de tarefas. " +
      "periodo: hoje, amanha, semana (segunda a domingo) ou proximos_7_dias; ou informe de/ate. Mostra ids e ocorrências para editar.",
    schema: z.object({
      periodo: z.enum(["hoje", "amanha", "semana", "proximos_7_dias"]).optional(),
      de: dateArg.optional(),
      ate: dateArg.optional(),
    }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      let from = ctx.today;
      let to = ctx.today;
      if (a.de || a.ate) {
        from = a.de ? toDate(ctx, a.de) : ctx.today;
        to = a.ate ? toDate(ctx, a.ate) : from;
      } else if (a.periodo === "amanha") from = to = addDays(ctx.today, 1);
      else if (a.periodo === "semana") (from = startOfWeek(ctx.today)), (to = addDays(from, 6));
      else if (a.periodo === "proximos_7_dias") to = addDays(ctx.today, 6);
      if (to < from) throw new UserError("A data final é antes da inicial");
      if (diffDays(from, to) > 31) throw new UserError("Consulte no máximo 31 dias por vez");
      return agendaText(ctx, from, to);
    },
  }),

  tool({
    name: "criar_evento",
    title: "Criar evento",
    description:
      "Cria um compromisso. Sem hora_inicio, o evento é de dia inteiro (use data_fim para vários dias). " +
      "Sem hora_fim nem duracao_min, dura 1 hora. Use repetir para eventos recorrentes e tarefa para reservar um horário para uma tarefa existente. " +
      "Se um evento igual (mesmo título e início) foi criado há poucos minutos, devolve o existente em vez de duplicar.",
    schema: z.object({
      titulo: z.string().min(1),
      data: dateArg,
      hora_inicio: timeArg.optional(),
      hora_fim: timeArg.optional(),
      duracao_min: z.number().int().positive().optional(),
      data_fim: dateArg.optional().describe("Último dia (dia inteiro) ou dia em que termina"),
      local: z.string().optional(),
      link: z.string().optional().describe("Link da reunião (https://…)"),
      categoria: z.string().optional(),
      repetir: repeatArg.optional(),
      tarefa: z.string().optional().describe("Id ou título de uma tarefa: o evento vira um horário reservado para ela"),
    }),
    async run(a, ctx) {
      const t = timingArgs(ctx, a);
      const startAt = t.all_day ? `${t.start}T00:00` : t.start;
      const existing = await agenda.findRecentEvent(ctx, a.titulo, startAt);
      if (existing) return `Já existia (criado há poucos minutos), nada foi duplicado: [evento ${existing.id}] ${existing.title} — ${dayLabel(existing.start_at.slice(0, 10), ctx.today)} ${timeRange(existing)}`;
      const task = a.tarefa ? (/^\d+$/.test(a.tarefa) ? await getTask(ctx, Number(a.tarefa)) : await resolveTask(ctx, a.tarefa)) : null;
      const e = await agenda.createEvent(ctx, {
        title: a.titulo,
        ...t,
        location: a.local ?? null,
        url: a.link ?? null,
        category: a.categoria ?? null,
        rrule: a.repetir ? toRRule(ctx, a.repetir) : null,
        task_id: task?.id ?? null,
      });
      return `✅ Evento criado [evento ${e.id}]: ${e.title} — ${dayLabel(e.start_at.slice(0, 10), ctx.today)} ${timeRange(e)}${e.rrule ? ` (repete: ${e.rrule})` : ""}${task ? ` · horário para a tarefa "${task.title}"` : ""}`;
    },
  }),

  tool({
    name: "editar_evento",
    title: "Editar evento",
    description:
      "Altera um evento (id da agenda). Em evento que se repete, informe ocorrencia e alcance (so_esta, esta_e_seguintes ou todas). " +
      "Para mudar o horário, informe hora_inicio (e hora_fim ou duracao_min; sem eles, mantém a duração). Para mudar o dia, informe data.",
    schema: z.object({
      evento: z.number().int().describe("Id do evento, como aparece na agenda"),
      ocorrencia: occurrenceArg,
      alcance: scopeArg,
      titulo: z.string().min(1).optional(),
      data: dateArg.optional(),
      hora_inicio: timeArg.optional(),
      hora_fim: timeArg.optional(),
      duracao_min: z.number().int().positive().optional(),
      dia_inteiro: z.boolean().optional(),
      local: z.string().optional(),
      link: z.string().optional(),
      categoria: z.string().optional(),
      repetir: repeatArg.optional(),
      parar_de_repetir: z.boolean().optional().describe("true para o evento deixar de se repetir (com alcance esta_e_seguintes ou todas)"),
    }),
    async run(a, ctx) {
      const ev = await agenda.getEvent(ctx, a.evento);
      const scope = scopeOf(a);
      // Horário atual da ocorrência (ou do evento), para completar o que não foi informado
      const curStart = scope.occurrence_start ?? ev.start_at;
      const curDate = curStart.slice(0, 10);
      const patch: Parameters<typeof agenda.updateEvent>[2] = {
        title: a.titulo,
        location: a.local,
        url: a.link,
        category: a.categoria,
        rrule: a.parar_de_repetir ? null : a.repetir ? toRRule(ctx, a.repetir) : undefined,
      };
      if (a.data || a.hora_inicio || a.hora_fim || a.duracao_min || a.dia_inteiro !== undefined) {
        const allDay = a.dia_inteiro ?? (ev.all_day && !a.hora_inicio);
        const date = a.data ? toDate(ctx, a.data) : curDate;
        if (allDay) Object.assign(patch, { all_day: true, start: date });
        else {
          const start = `${date}T${a.hora_inicio ? toTime(a.hora_inicio) : ev.all_day ? "09:00" : curStart.slice(11)}`;
          const end = a.hora_fim ? `${date}T${toTime(a.hora_fim)}` : a.duracao_min ? addMinutes(start, a.duracao_min) : undefined;
          Object.assign(patch, { all_day: false, start, end });
        }
      }
      const e = await agenda.updateEvent(ctx, ev.id, patch, scope);
      return `✅ Evento atualizado [evento ${e.series_id ?? e.id}]: ${e.title} — ${dayLabel(e.start_at.slice(0, 10), ctx.today)} ${timeRange(e)}${e.series_id ? " (só esta ocorrência)" : e.rrule ? ` (repete: ${e.rrule})` : ""}`;
    },
  }),

  tool({
    name: "cancelar_evento",
    title: "Cancelar evento",
    description:
      "Exclui um evento. Em evento que se repete, informe ocorrencia e alcance (so_esta, esta_e_seguintes ou todas). " +
      "Exige confirmar: true (sem isso, só mostra o que seria excluído).",
    schema: z.object({ evento: z.number().int(), ocorrencia: occurrenceArg, alcance: scopeArg, confirmar: confirmArg }),
    annotations: { destructiveHint: true },
    async run(a, ctx) {
      const ev = await agenda.getEvent(ctx, a.evento);
      const scope = scopeOf(a);
      const recurring = !!(ev.rrule || ev.series_id);
      if (recurring && !scope.scope) throw new UserError("Evento repetido: informe alcance (so_esta, esta_e_seguintes ou todas) e a ocorrencia");
      const what = !recurring
        ? `o evento "${ev.title}" de ${dayLabel(ev.start_at.slice(0, 10), ctx.today)} ${timeRange(ev)}`
        : scope.scope === "this"
          ? `só a ocorrência de ${scope.occurrence_start} de "${ev.title}"`
          : scope.scope === "following"
            ? `a ocorrência de ${scope.occurrence_start} e todas as seguintes de "${ev.title}"`
            : `todas as ocorrências de "${ev.title}"`;
      if (!a.confirmar) return needsConfirmation(`excluir ${what}.`);
      await agenda.deleteEvent(ctx, ev.id, scope);
      return `🗑️ Excluído: ${what}.`;
    },
  }),
];
