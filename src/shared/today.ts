// Tela "Hoje": composição dos módulos (só leitura). Cada item vem do módulo dono, sem cópias.
import type { AgendaItem } from "./agenda";
import type { Task } from "./tasks";
import type { TrainingSession } from "./training";

export type EventItem = Extract<AgendaItem, { kind: "event" }>;

export interface Today {
  date: string;
  now: string;
  /** Compromissos de hoje (inclui horários reservados para tarefas). */
  events: EventItem[];
  /** Próximos compromissos depois de hoje (até 7 dias, no máximo 5). */
  upcoming: EventItem[];
  tasks: {
    overdue: Task[];
    today: Task[];
    /** Alta prioridade sem prazo ou com prazo mais adiante (no máximo 5). */
    priority: Task[];
  };
  /** Treinos de hoje (planejados e realizados). */
  training: TrainingSession[];
}
