// Treinos planejados e realizados: formatos da API e regras puras (rótulos, ritmo, durações, distâncias).

export type Sport = "run" | "bike" | "swim" | "strength" | "other";
export type TrainingStatus = "planned" | "done" | "partial" | "skipped" | "cancelled";
export type WorkoutType = "easy" | "long" | "intervals" | "tempo" | "recovery" | "race" | "strength" | "technique" | "other";

export const SPORTS: Sport[] = ["run", "bike", "swim", "strength", "other"];
export const SPORT_LABEL: Record<Sport, string> = { run: "Corrida", bike: "Ciclismo", swim: "Natação", strength: "Musculação", other: "Outro" };
export const STATUS_LABEL: Record<TrainingStatus, string> = {
  planned: "Planejado",
  done: "Realizado",
  partial: "Parcial / adaptado",
  skipped: "Não realizado",
  cancelled: "Cancelado",
};
export const WORKOUT_TYPES: WorkoutType[] = ["easy", "long", "intervals", "tempo", "recovery", "race", "strength", "technique", "other"];
export const WORKOUT_TYPE_LABEL: Record<WorkoutType, string> = {
  easy: "Leve",
  long: "Longo",
  intervals: "Intervalado",
  tempo: "Ritmo",
  recovery: "Recuperação",
  race: "Prova",
  strength: "Força",
  technique: "Técnica",
  other: "Outro",
};

/** Mudanças de status permitidas. Voltar para "planejado" desfaz o registro (limpa o resultado). */
export const TRANSITIONS: Record<TrainingStatus, TrainingStatus[]> = {
  planned: ["done", "partial", "skipped", "cancelled"],
  done: ["partial", "planned"],
  partial: ["done", "planned"],
  skipped: ["planned", "done", "partial"],
  cancelled: ["planned", "done", "partial"],
};

export const isDoneStatus = (s: TrainingStatus) => s === "done" || s === "partial";

/** Modalidades em que distância faz sentido. */
export const HAS_DISTANCE: Record<Sport, boolean> = { run: true, bike: true, swim: true, strength: false, other: true };

export interface TrainingSession {
  id: number;
  sport: Sport;
  title: string | null;
  workout_type: WorkoutType | null;
  date: string;
  time: string | null;
  /** Registrado sem ter sido planejado. */
  unplanned: boolean;
  planned_duration_s: number | null;
  planned_distance_m: number | null;
  planned_intensity: string | null;
  instructions: string | null;
  status: TrainingStatus;
  actual_start: string | null;
  actual_duration_s: number | null;
  actual_distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  rpe: number | null;
  notes: string | null;
}

export interface SportVolume {
  sport: Sport;
  sessions: number;
  planned_duration_s: number;
  actual_duration_s: number;
  planned_distance_m: number;
  actual_distance_m: number;
}

export interface WeekStats {
  week_start: string;
  week_end: string;
  /** Treinos planejados na semana (sem os cancelados). */
  planned: number;
  /** Realizados (inclui parciais), planejados ou não. */
  done: number;
  partial: number;
  skipped: number;
  cancelled: number;
  unplanned: number;
  /** Planejados que já venceram (dias anteriores, ou hoje se já registrado): a base do % de cumprimento. */
  due: number;
  /** Planejados até hoje que foram realizados (total ou parcialmente). */
  due_done: number;
  /** due_done / due, em %; null se nada venceu ainda. */
  compliance_pct: number | null;
  planned_duration_s: number;
  actual_duration_s: number;
  by_sport: SportVolume[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "45 min", "1 h 30" (planejado). */
export function formatPlanDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 ? `${h} h ${pad(min % 60)}` : `${h} h`;
}

/** "52:10", "1:02:30" (realizado). */
export function formatClock(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "10 km", "10,5 km", "1.500 m" (natação em metros). */
export function formatDistance(m: number, sport: Sport): string {
  if (sport === "swim") return `${m.toLocaleString("pt-BR")} m`;
  const km = m / 1000;
  return `${km.toLocaleString("pt-BR", { maximumFractionDigits: km < 100 ? 2 : 1 })} km`;
}

/** Ritmo: corrida em min/km, natação em min/100 m, ciclismo em km/h. Null se faltar dado. */
export function pace(durationS: number | null, distanceM: number | null, sport: Sport): string | null {
  if (!durationS || !distanceM) return null;
  if (sport === "run") return `${formatClock(Math.round(durationS / (distanceM / 1000)))}/km`;
  if (sport === "swim") return `${formatClock(Math.round(durationS / (distanceM / 100)))}/100 m`;
  if (sport === "bike") return `${(distanceM / 1000 / (durationS / 3600)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km/h`;
  return null;
}

/**
 * Lê uma duração digitada: "45" = 45 min; "52:10" = 52 min 10 s; "1:02:30" = 1 h 2 min 30 s; "1h30" = 1 h 30 min.
 * Devolve segundos, ou null se inválida.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s/g, "");
  if (!t) return null;
  let m = /^(\d+)h(\d{1,2})?(min)?$/.exec(t);
  if (m) return Number(m[1]) * 3600 + Number(m[2] ?? 0) * 60;
  m = /^(\d+)(min)?$/.exec(t);
  if (m) return Number(m[1]) * 60;
  const parts = t.split(":");
  if (parts.some((p) => !/^\d+$/.test(p)) || parts.length < 2 || parts.length > 3) return null;
  const n = parts.map(Number);
  if (n.slice(1).some((x) => x >= 60)) return null;
  return parts.length === 3 ? n[0] * 3600 + n[1] * 60 + n[2] : n[0] * 60 + n[1];
}

/** Lê uma distância digitada: natação em metros ("1500"); demais em km ("10,5"). Devolve metros. */
export function parseDistance(text: string, sport: Sport): number | null {
  const t = text.trim().replace(/\s/g, "").replace(/km$|m$/i, "");
  if (!t) return null;
  // Natação: metros inteiros ("1.500" = 1500). Km: vírgula é decimal ("10,5"); sem vírgula, ponto é decimal ("10.5")
  const n = Number(sport === "swim" ? t.replace(/\./g, "") : t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(sport === "swim" ? n : n * 1000);
}
