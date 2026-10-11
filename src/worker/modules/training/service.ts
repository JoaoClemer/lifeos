// Treinos planejados e realizados. Plano e resultado ficam na mesma linha, em colunas separadas:
// registrar o resultado atualiza o treino (nunca cria outro) e o plano original continua guardado.
import { z } from "zod";
import { addDays, diffDays, isValidDate, isValidLocal, startOfWeek } from "../../../shared/datetime";
import {
  SPORTS,
  type Sport,
  type SportVolume,
  type TrainingSession,
  type TrainingStatus,
  TRANSITIONS,
  isDoneStatus,
  type WeekStats,
  WORKOUT_TYPES,
} from "../../../shared/training";
import { activity } from "../../activity";
import { type Ctx, nn, UserError } from "../../lib";

const dateArg = z.string().refine(isValidDate, "data inválida (use YYYY-MM-DD)");
const timeArg = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário inválido (use HH:MM)");
const seconds = z.number().int().positive().max(7 * 24 * 3600);
const meters = z.number().int().positive().max(1_000_000);
const heartRate = z.number().int().min(30).max(250);
/** Texto opcional; vazio vira null. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

const PlanFields = z.object({
  sport: z.enum(SPORTS as [Sport, ...Sport[]]),
  title: text(120),
  workout_type: z.enum(WORKOUT_TYPES as [string, ...string[]]).nullable().optional(),
  date: dateArg,
  time: timeArg.nullable().optional(),
  planned_duration_s: seconds.nullable().optional(),
  planned_distance_m: meters.nullable().optional(),
  planned_intensity: text(60),
  instructions: text(4000),
});

const ResultFields = z.object({
  actual_start: z.string().refine(isValidLocal, "início inválido (use YYYY-MM-DDTHH:MM)").nullable().optional(),
  actual_duration_s: seconds.nullable().optional(),
  actual_distance_m: meters.nullable().optional(),
  avg_hr: heartRate.nullable().optional(),
  max_hr: heartRate.nullable().optional(),
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  notes: text(2000),
});

const StatusField = z.enum(["planned", "done", "partial", "skipped", "cancelled"]);

/** Planejar um treino; com status done/partial, registra um treino feito sem planejamento. */
export const SessionInput = PlanFields.extend(ResultFields.shape).extend({ status: StatusField.optional(), as_planned: z.boolean().optional() });
export const SessionPatch = PlanFields.partial().extend(ResultFields.shape).extend({
  status: StatusField.optional(),
  /** Ao marcar como realizado sem informar duração/distância, usa as do plano. */
  as_planned: z.boolean().optional(),
});

const RESULT_KEYS = ["actual_start", "actual_duration_s", "actual_distance_m", "avg_hr", "max_hr", "rpe"] as const;
const PLAN_KEYS = ["sport", "title", "workout_type", "date", "time", "planned_duration_s", "planned_distance_m", "planned_intensity", "instructions"] as const;

const isDone = isDoneStatus;

type Row = Omit<TrainingSession, "unplanned"> & { unplanned: number };
const COLS = `id, sport, title, workout_type, date, time, unplanned, planned_duration_s, planned_distance_m, planned_intensity, instructions,
  status, actual_start, actual_duration_s, actual_distance_m, avg_hr, max_hr, rpe, notes`;
const decorate = (r: Row): TrainingSession => ({ ...r, unplanned: !!r.unplanned });

export async function getSession(ctx: Ctx, id: number): Promise<TrainingSession> {
  const row = await ctx.db.prepare(`SELECT ${COLS} FROM training_sessions WHERE id = ?`).bind(id).first<Row>();
  if (!row) throw new UserError(`Treino ${id} não encontrado`, 404);
  return decorate(row);
}

/** Treinos entre os dias `from` e `to` (inclusive): por dia, os sem horário primeiro. */
export async function listSessions(ctx: Ctx, from: string, to: string, sport?: Sport): Promise<TrainingSession[]> {
  if (!isValidDate(from) || !isValidDate(to) || to < from) throw new UserError("Intervalo inválido (use datas YYYY-MM-DD)");
  const rows = await ctx.db
    .prepare(`SELECT ${COLS} FROM training_sessions WHERE date BETWEEN ? AND ? ${sport ? "AND sport = ?" : ""} ORDER BY date, COALESCE(time, ''), id`)
    .bind(...(sport ? [from, to, sport] : [from, to]))
    .all<Row>();
  return rows.results.map(decorate);
}

/** Treino planejado igual (modalidade, dia e horário) criado há pouco (evita duplicar quando o Claude repete uma chamada). */
export async function findRecentSession(ctx: Ctx, sport: Sport, date: string, time: string | null, minutes = 10): Promise<TrainingSession | null> {
  const row = await ctx.db
    .prepare(`SELECT ${COLS} FROM training_sessions WHERE sport = ? AND date = ? AND COALESCE(time, '') = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`)
    .bind(sport, date, time ?? "", `-${minutes} minutes`)
    .first<Row>();
  return row ? decorate(row) : null;
}

/** Treinos realizados (total ou parcialmente), do mais recente para o mais antigo. */
export async function listHistory(ctx: Ctx, opts: { sport?: Sport; before?: string; limit?: number } = {}): Promise<TrainingSession[]> {
  const where = ["status IN ('done', 'partial')"];
  const args: string[] = [];
  if (opts.sport) (where.push("sport = ?"), args.push(opts.sport));
  if (opts.before) (where.push("date < ?"), args.push(opts.before));
  const rows = await ctx.db
    .prepare(`SELECT ${COLS} FROM training_sessions WHERE ${where.join(" AND ")} ORDER BY date DESC, COALESCE(time, '') DESC, id DESC LIMIT ${Math.min(opts.limit ?? 100, 500)}`)
    .bind(...args)
    .all<Row>();
  return rows.results.map(decorate);
}

/** Resultado final de um treino depois da mudança, validado. */
function resolveResult(cur: Pick<TrainingSession, (typeof RESULT_KEYS)[number] | "planned_duration_s" | "planned_distance_m" | "notes">, p: z.output<typeof SessionPatch>, status: TrainingStatus) {
  const result = Object.fromEntries(RESULT_KEYS.map((k) => [k, p[k] !== undefined ? p[k] : cur[k]])) as Record<(typeof RESULT_KEYS)[number], number | string | null>;
  if (!isDone(status)) {
    if (RESULT_KEYS.some((k) => p[k] != null)) throw new UserError("Resultado só pode ser registrado em treino realizado (done) ou parcial (partial)");
    // Desfazer o registro limpa o resultado
    return Object.fromEntries(RESULT_KEYS.map((k) => [k, null])) as typeof result;
  }
  if (p.as_planned) {
    result.actual_duration_s ??= cur.planned_duration_s;
    result.actual_distance_m ??= cur.planned_distance_m;
  }
  if (result.actual_duration_s == null && result.actual_distance_m == null) {
    throw new UserError("Informe a duração ou a distância realizada (ou marque como feito conforme o planejado)");
  }
  if (result.avg_hr != null && result.max_hr != null && Number(result.max_hr) < Number(result.avg_hr)) {
    throw new UserError("A frequência cardíaca máxima não pode ser menor que a média");
  }
  return result;
}

export async function createSession(ctx: Ctx, input: z.input<typeof SessionInput>): Promise<TrainingSession> {
  const s = SessionInput.parse(input);
  const status = s.status ?? "planned";
  if (status === "skipped" || status === "cancelled") throw new UserError("Um treino novo começa planejado ou já realizado");
  const plan = { planned_duration_s: s.planned_duration_s ?? null, planned_distance_m: s.planned_distance_m ?? null };
  const result = resolveResult({ ...plan, actual_start: null, actual_duration_s: null, actual_distance_m: null, avg_hr: null, max_hr: null, rpe: null, notes: null }, s, status);
  const row = await ctx.db
    .prepare(
      `INSERT INTO training_sessions (sport, title, workout_type, date, time, unplanned, planned_duration_s, planned_distance_m, planned_intensity, instructions,
         status, actual_start, actual_duration_s, actual_distance_m, avg_hr, max_hr, rpe, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      s.sport,
      nn(s.title),
      nn(s.workout_type),
      s.date,
      nn(s.time),
      isDone(status) ? 1 : 0, // criado já realizado = não foi planejado
      plan.planned_duration_s,
      plan.planned_distance_m,
      nn(s.planned_intensity),
      nn(s.instructions),
      status,
      ...RESULT_KEYS.map((k) => result[k]),
      nn(s.notes),
    )
    .first<{ id: number }>();
  return getSession(ctx, row!.id);
}

/**
 * Edita o plano e/ou registra o resultado. Mudanças de status seguem TRANSITIONS; marcar como realizado
 * exige duração ou distância (ou `as_planned`); voltar para planejado limpa o resultado. Fica no histórico.
 */
export async function updateSession(ctx: Ctx, id: number, patch: z.input<typeof SessionPatch>): Promise<TrainingSession> {
  const p = SessionPatch.parse(patch);
  const cur = await getSession(ctx, id);
  const status = p.status ?? cur.status;
  if (status !== cur.status && !TRANSITIONS[cur.status].includes(status)) {
    throw new UserError(
      isDone(cur.status)
        ? `O treino já foi registrado como ${cur.status === "done" ? "realizado" : "parcial"}. Desfaça o registro (volte para planejado) antes de marcá-lo como ${status === "skipped" ? "não realizado" : "cancelado"}`
        : `Não é possível mudar de ${cur.status} para ${status}`,
    );
  }
  const merged = { ...cur, ...Object.fromEntries(PLAN_KEYS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) };
  const touchesResult = p.status !== undefined || p.as_planned || RESULT_KEYS.some((k) => p[k] !== undefined);
  const result = touchesResult ? resolveResult(merged, p, status) : null;

  const sets: Record<string, string | number | null> = {};
  for (const k of PLAN_KEYS) if (p[k] !== undefined) sets[k] = p[k] ?? null;
  if (result) Object.assign(sets, result);
  if (p.notes !== undefined) sets.notes = p.notes;
  if (status !== cur.status) sets.status = status;
  const keys = Object.keys(sets);
  if (!keys.length) return cur;
  await ctx.db.batch([
    ctx.db.prepare(`UPDATE training_sessions SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...Object.values(sets), id),
    ...(status !== cur.status ? [activity(ctx, "training.status", "training", id, { from: cur.status, to: status })] : []),
  ]);
  return getSession(ctx, id);
}

export async function deleteSession(ctx: Ctx, id: number): Promise<TrainingSession> {
  const cur = await getSession(ctx, id);
  await ctx.db.prepare("DELETE FROM training_sessions WHERE id = ?").bind(id).run();
  return cur;
}

/**
 * Registra um treino feito: se houver um treino planejado (ainda não registrado) da mesma modalidade no dia,
 * preenche o resultado nele; senão cria um treino avulso. Nunca duplica um planejado.
 */
export async function recordWorkout(
  ctx: Ctx,
  input: z.input<typeof ResultFields> & { sport: Sport; date?: string; status?: "done" | "partial"; as_planned?: boolean; title?: string | null },
): Promise<{ session: TrainingSession; matched_plan: boolean }> {
  const date = input.date ?? ctx.today;
  const status = input.status ?? "done";
  const candidates = (await listSessions(ctx, date, date, input.sport)).filter((s) => s.status === "planned");
  if (candidates.length > 1) {
    throw new UserError(
      `Há ${candidates.length} treinos de ${input.sport} planejados em ${date}: ${candidates.map((c) => `[${c.id}] ${c.title ?? c.workout_type ?? c.sport}`).join(", ")}. Informe qual.`,
    );
  }
  const { sport, date: _d, title, ...rest } = input;
  if (candidates.length === 1) return { session: await updateSession(ctx, candidates[0].id, { ...rest, status }), matched_plan: true };
  return { session: await createSession(ctx, { ...rest, sport, title, date, status }), matched_plan: false };
}

/** Copia o plano de uma semana para outra (mesmos dias da semana). Ignora treinos cancelados e os feitos sem plano. */
export async function copyWeek(ctx: Ctx, fromWeek: string, toWeek: string): Promise<TrainingSession[]> {
  const from = startOfWeek(fromWeek);
  const to = startOfWeek(toWeek);
  if (from === to) throw new UserError("Escolha outra semana de destino");
  const source = (await listSessions(ctx, from, addDays(from, 6))).filter((s) => !s.unplanned && s.status !== "cancelled");
  if (!source.length) return [];
  const shift = diffDays(from, to);
  const results = await ctx.db.batch<{ id: number }>(
    source.map((s) =>
      ctx.db
        .prepare(
          `INSERT INTO training_sessions (sport, title, workout_type, date, time, planned_duration_s, planned_distance_m, planned_intensity, instructions)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(s.sport, s.title, s.workout_type, addDays(s.date, shift), s.time, s.planned_duration_s, s.planned_distance_m, s.planned_intensity, s.instructions),
    ),
  );
  return Promise.all(results.map((r) => getSession(ctx, r.results[0].id)));
}

/** Indicadores da semana (segunda a domingo) da data informada. */
export async function weekStats(ctx: Ctx, date: string): Promise<WeekStats> {
  const start = startOfWeek(date);
  const end = addDays(start, 6);
  const sessions = await listSessions(ctx, start, end);
  const planned = sessions.filter((s) => !s.unplanned && s.status !== "cancelled");
  const done = sessions.filter((s) => isDone(s.status));
  // Venceu: dias anteriores, ou hoje se já foi registrado (o treino de hoje ainda pendente não conta como falta)
  const due = planned.filter((s) => s.date < ctx.today || (s.date === ctx.today && s.status !== "planned"));
  const dueDone = due.filter((s) => isDone(s.status));
  const bySport = new Map<Sport, SportVolume>();
  for (const s of sessions) {
    if (s.status === "cancelled") continue;
    const v = bySport.get(s.sport) ?? { sport: s.sport, sessions: 0, planned_duration_s: 0, actual_duration_s: 0, planned_distance_m: 0, actual_distance_m: 0 };
    v.sessions++;
    if (!s.unplanned) {
      v.planned_duration_s += s.planned_duration_s ?? 0;
      v.planned_distance_m += s.planned_distance_m ?? 0;
    }
    if (isDone(s.status)) {
      v.actual_duration_s += s.actual_duration_s ?? 0;
      v.actual_distance_m += s.actual_distance_m ?? 0;
    }
    bySport.set(s.sport, v);
  }
  return {
    week_start: start,
    week_end: end,
    planned: planned.length,
    done: done.length,
    partial: sessions.filter((s) => s.status === "partial").length,
    skipped: sessions.filter((s) => s.status === "skipped").length,
    cancelled: sessions.filter((s) => s.status === "cancelled").length,
    unplanned: sessions.filter((s) => s.unplanned).length,
    due: due.length,
    due_done: dueDone.length,
    compliance_pct: due.length ? Math.round((dueDone.length / due.length) * 100) : null,
    planned_duration_s: planned.reduce((t, s) => t + (s.planned_duration_s ?? 0), 0),
    actual_duration_s: done.reduce((t, s) => t + (s.actual_duration_s ?? 0), 0),
    by_sport: SPORTS.map((sp) => bySport.get(sp)).filter((v): v is SportVolume => !!v),
  };
}
