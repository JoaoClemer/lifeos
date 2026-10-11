// Agenda: formatos da API. Horários no relógio local ('YYYY-MM-DDTHH:MM'); fim exclusivo.
// Evento de dia inteiro: início T00:00 do primeiro dia e fim T00:00 do dia seguinte ao último.
import type { Task } from "./tasks";

export interface CalendarEvent {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  category: string | null;
  color: string | null;
  all_day: boolean;
  start_at: string;
  end_at: string;
  timezone: string;
  /** Regra de repetição (só na série). */
  rrule: string | null;
  /** Se esta linha é uma ocorrência alterada/cancelada: a série e o início original da ocorrência. */
  series_id: number | null;
  original_start: string | null;
  cancelled: boolean;
  task_id: number | null;
}

/** Uma ocorrência na agenda: um evento único ou uma das repetições de uma série. */
export interface Occurrence {
  /** Id do evento; numa série, o id da série. */
  event_id: number;
  /** Início original da ocorrência na série (null em evento único). Identifica a ocorrência para alterar só ela. */
  occurrence_start: string | null;
  /** Ocorrência alterada individualmente. */
  modified: boolean;
  /** Regra da série (null em evento único). */
  rrule: string | null;
  title: string;
  description: string | null;
  location: string | null;
  url: string | null;
  category: string | null;
  color: string | null;
  all_day: boolean;
  start_at: string;
  end_at: string;
  task_id: number | null;
}

/** A quais ocorrências de uma série a alteração/exclusão se aplica. */
export type EditScope = "this" | "following" | "all";

/** Item da agenda unificada: cada um aponta para a entidade dona (nada é copiado entre módulos). */
export type AgendaItem =
  | ({ kind: "event"; task: Pick<Task, "id" | "title" | "status"> | null } & Occurrence)
  | { kind: "task_due"; date: string; task: Task };

/** Cores de evento (nomes; o app define o tom de cada uma no tema claro e escuro). */
export const EVENT_COLORS = ["teal", "blue", "violet", "amber", "rose", "slate"] as const;
export type EventColor = (typeof EVENT_COLORS)[number];

/** Último dia (inclusive) de um evento de dia inteiro. */
export function lastDay(e: Pick<Occurrence, "end_at">): string {
  const [y, m, d] = e.end_at.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10);
}
