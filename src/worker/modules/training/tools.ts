// Ferramentas MCP de treinos. Chamam o mesmo service da API (mesmas regras e validações).
import { z } from "zod";
import { addDays, startOfWeek } from "../../../shared/datetime";
import {
  formatClock,
  formatDistance,
  formatPlanDuration,
  isDoneStatus,
  pace,
  parseDuration,
  SPORT_LABEL,
  type Sport,
  STATUS_LABEL,
  type TrainingSession,
  type WeekStats,
  type WorkoutType,
} from "../../../shared/training";
import { type Ctx, UserError } from "../../lib";
import { confirmArg, dateArg, dayLabel, needsConfirmation, timeArg, toDate, toTime } from "../../mcp/args";
import { type Tool, tool } from "../../mcp/tool";
import * as training from "./service";

const SPORT: Record<string, Sport> = { corrida: "run", ciclismo: "bike", natacao: "swim", musculacao: "strength", outro: "other" };
const TYPE: Record<string, WorkoutType> = {
  leve: "easy",
  longo: "long",
  intervalado: "intervals",
  ritmo: "tempo",
  recuperacao: "recovery",
  prova: "race",
  forca: "strength",
  tecnica: "technique",
  outro: "other",
};
const sportArg = z.enum(["corrida", "ciclismo", "natacao", "musculacao", "outro"]);
const typeArg = z.enum(["leve", "longo", "intervalado", "ritmo", "recuperacao", "prova", "forca", "tecnica", "outro"]);
const distanceArgs = {
  distancia_km: z.number().positive().optional().describe("Distância em km (corrida, ciclismo)"),
  distancia_m: z.number().int().positive().optional().describe("Distância em metros (natação)"),
};
const meters = (a: { distancia_km?: number; distancia_m?: number }) => (a.distancia_m ?? (a.distancia_km ? Math.round(a.distancia_km * 1000) : undefined));

function duration(v: string | number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const s = typeof v === "number" ? v * 60 : parseDuration(v);
  if (!s) throw new UserError(`Duração inválida: "${v}" (use minutos, 52:10 ou 1:02:30)`);
  return s;
}

export function sessionLine(s: TrainingSession, today: string, withDay = false): string {
  const name = s.title ?? SPORT_LABEL[s.sport];
  const plan = [s.planned_distance_m && formatDistance(s.planned_distance_m, s.sport), s.planned_duration_s && formatPlanDuration(s.planned_duration_s), s.planned_intensity]
    .filter(Boolean)
    .join(", ");
  const done = isDoneStatus(s.status)
    ? [s.actual_distance_m && formatDistance(s.actual_distance_m, s.sport), s.actual_duration_s && formatClock(s.actual_duration_s), pace(s.actual_duration_s, s.actual_distance_m, s.sport), s.rpe && `esforço ${s.rpe}/10`]
        .filter(Boolean)
        .join(", ")
    : "";
  const when = [withDay && dayLabel(s.date, today), s.time].filter(Boolean).join(" ");
  return `• ${when ? `${when} ` : ""}${name} (${SPORT_LABEL[s.sport].toLowerCase()}) — ${STATUS_LABEL[s.status].toLowerCase()}${s.unplanned ? ", sem plano" : ""}${plan && !s.unplanned ? ` · plano: ${plan}` : ""}${done ? ` · feito: ${done}` : ""} [treino ${s.id}]`;
}

export function weekStatsText(w: WeekStats): string {
  const lines = [
    `Cumprimento: ${w.compliance_pct == null ? "nada venceu ainda" : `${w.compliance_pct}% (${w.due_done} de ${w.due} vencidos)`} · ${w.planned} planejados, ${w.done} feitos` +
      `${w.skipped ? `, ${w.skipped} não realizados` : ""}${w.cancelled ? `, ${w.cancelled} cancelados` : ""}${w.unplanned ? `, ${w.unplanned} sem plano` : ""}`,
    `Duração: ${formatPlanDuration(w.actual_duration_s)} feitos de ${formatPlanDuration(w.planned_duration_s)} planejados`,
  ];
  for (const v of w.by_sport) {
    const dist = v.planned_distance_m || v.actual_distance_m ? `, ${formatDistance(v.actual_distance_m, v.sport)} de ${formatDistance(v.planned_distance_m, v.sport)}` : "";
    lines.push(`• ${SPORT_LABEL[v.sport]}: ${v.sessions} treino(s)${dist}, ${formatPlanDuration(v.actual_duration_s)} de ${formatPlanDuration(v.planned_duration_s)}`);
  }
  return lines.join("\n");
}

async function weekText(ctx: Ctx, date: string): Promise<string> {
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const [stats, sessions] = await Promise.all([training.weekStats(ctx, start), training.listSessions(ctx, start, end)]);
  const lines = [`Treinos de ${dayLabel(start, ctx.today)} a ${dayLabel(end, ctx.today)}:`, weekStatsText(stats), ""];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const day = sessions.filter((s) => s.date === d);
    lines.push(dayLabel(d, ctx.today), ...(day.length ? day.map((s) => sessionLine(s, ctx.today)) : ["(descanso)"]));
  }
  return lines.join("\n");
}

export const TRAINING_TOOLS: Tool[] = [
  tool({
    name: "treinos_semana",
    title: "Treinos da semana",
    description: "Mostra o planejamento de treinos da semana (segunda a domingo) com o que foi feito, % de cumprimento e volume por modalidade. Mostra os ids.",
    schema: z.object({ data: dateArg.optional().describe("Qualquer dia da semana desejada. Padrão: esta semana") }),
    annotations: { readOnlyHint: true },
    run: async (a, ctx) => weekText(ctx, a.data ? toDate(ctx, a.data) : ctx.today),
  }),

  tool({
    name: "planejar_treino",
    title: "Planejar treino",
    description:
      "Planeja um treino num dia (aparece na agenda; com horario, no horário). Para musculação, descreva exercícios e séries em instrucoes. " +
      "Se um treino igual (modalidade, dia e horário) foi planejado há poucos minutos, devolve o existente em vez de duplicar.",
    schema: z.object({
      modalidade: sportArg,
      data: dateArg,
      horario: timeArg.optional(),
      tipo: typeArg.optional(),
      titulo: z.string().optional().describe('Ex.: "Longão", "6x800", "Treino A"'),
      duracao_min: z.number().int().positive().optional(),
      ...distanceArgs,
      intensidade: z.string().optional().describe('Ex.: "Z2", "leve", "5:30/km"'),
      instrucoes: z.string().optional(),
    }),
    async run(a, ctx) {
      const date = toDate(ctx, a.data);
      const time = a.horario ? toTime(a.horario) : null;
      const sport = SPORT[a.modalidade];
      const existing = await training.findRecentSession(ctx, sport, date, time);
      if (existing) return `Já existia (planejado há poucos minutos), nada foi duplicado:\n${sessionLine(existing, ctx.today, true)}`;
      const s = await training.createSession(ctx, {
        sport,
        date,
        time,
        workout_type: a.tipo ? TYPE[a.tipo] : null,
        title: a.titulo ?? null,
        planned_duration_s: a.duracao_min ? a.duracao_min * 60 : null,
        planned_distance_m: meters(a) ?? null,
        planned_intensity: a.intensidade ?? null,
        instructions: a.instrucoes ?? null,
      });
      return `✅ Treino planejado:\n${sessionLine(s, ctx.today, true)}`;
    },
  }),

  tool({
    name: "registrar_treino",
    title: "Registrar treino feito",
    description:
      "Registra um treino realizado. Se houver um treino planejado da modalidade no dia, preenche o resultado nele (não duplica); senão, cria um treino sem plano. " +
      "Com treino_id, registra naquele treino. conforme_planejado: true usa a duração/distância do plano. parcial: true para treino feito em parte ou adaptado.",
    schema: z.object({
      modalidade: sportArg.optional().describe("Obrigatória quando não há treino_id"),
      treino_id: z.number().int().optional(),
      data: dateArg.optional().describe("Padrão: hoje"),
      duracao: z.union([z.string(), z.number()]).optional().describe('Duração: minutos (45), "52:10" ou "1:02:30"'),
      ...distanceArgs,
      fc_media: z.number().int().optional(),
      fc_max: z.number().int().optional(),
      esforco: z.number().int().min(1).max(10).optional().describe("Percepção de esforço, de 1 a 10"),
      observacoes: z.string().optional(),
      parcial: z.boolean().optional(),
      conforme_planejado: z.boolean().optional(),
      horario: timeArg.optional().describe("Hora em que começou"),
    }),
    async run(a, ctx) {
      const date = a.data ? toDate(ctx, a.data) : ctx.today;
      const result = {
        status: (a.parcial ? "partial" : "done") as "done" | "partial",
        actual_duration_s: duration(a.duracao),
        actual_distance_m: meters(a),
        avg_hr: a.fc_media,
        max_hr: a.fc_max,
        rpe: a.esforco,
        notes: a.observacoes,
        as_planned: a.conforme_planejado,
        actual_start: a.horario ? `${date}T${toTime(a.horario)}` : undefined,
      };
      if (a.treino_id) {
        const s = await training.updateSession(ctx, a.treino_id, result);
        return `✅ Treino registrado:\n${sessionLine(s, ctx.today, true)}`;
      }
      if (!a.modalidade) throw new UserError("Informe a modalidade (ou o treino_id)");
      const { session, matched_plan } = await training.recordWorkout(ctx, { ...result, sport: SPORT[a.modalidade], date });
      return `✅ Treino registrado${matched_plan ? " no treino planejado do dia" : " (sem plano)"}:\n${sessionLine(session, ctx.today, true)}`;
    },
  }),

  tool({
    name: "status_treino",
    title: "Mudar status de treino",
    description: "Marca um treino como nao_realizado, cancelado (desmarcado com antecedência) ou volta para planejado (desfaz um registro, limpando o resultado).",
    schema: z.object({ treino_id: z.number().int(), status: z.enum(["nao_realizado", "cancelado", "planejado"]) }),
    async run(a, ctx) {
      const status = ({ nao_realizado: "skipped", cancelado: "cancelled", planejado: "planned" } as const)[a.status];
      const s = await training.updateSession(ctx, a.treino_id, { status });
      return `✅ Treino atualizado:\n${sessionLine(s, ctx.today, true)}`;
    },
  }),

  tool({
    name: "remover_treino",
    title: "Remover treino",
    description: "Exclui um treino (planejado ou registrado). Exige confirmar: true (sem isso, só mostra o que seria excluído). Para desmarcar, prefira status_treino.",
    schema: z.object({ treino_id: z.number().int(), confirmar: confirmArg }),
    annotations: { destructiveHint: true },
    async run(a, ctx) {
      const s = await training.getSession(ctx, a.treino_id);
      if (!a.confirmar) return needsConfirmation(`excluir o treino:\n${sessionLine(s, ctx.today, true)}`);
      await training.deleteSession(ctx, s.id);
      return `🗑️ Treino excluído: ${s.title ?? SPORT_LABEL[s.sport]} de ${dayLabel(s.date, ctx.today)}`;
    },
  }),
];
