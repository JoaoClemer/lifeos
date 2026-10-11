// Tela "Hoje": composição dos módulos (só leitura). Cada item vem do módulo dono, sem cópias.
import type { AgendaItem } from "./agenda";
import type { Task } from "./tasks";
import type { TrainingSession, WeekStats } from "./training";

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
  /** Resumo financeiro do mês, tirado do resumo do módulo de finanças (sem recalcular nada). */
  finance: TodayFinance;
}

export interface TodayFinance {
  month: string;
  total_cents: number;
  income_cents: number | null;
  leftover_cents: number | null;
  /** Saldo final previsto do mês (null antes do início do saldo acumulado). */
  closing_cents: number | null;
  receivable_pending_cents: number;
  /** Orçamentos que estouraram ou passaram de 85% do valor reservado. */
  budgets_attention: { id: number; description: string; spent_cents: number; limit_cents: number; remaining_cents: number }[];
}

/** Visão da semana (segunda a domingo). */
export interface Week {
  week_start: string;
  week_end: string;
  /** Compromissos na semana (ocorrências de eventos). */
  events: number;
  tasks: {
    /** Concluídas nesta semana. */
    done: Task[];
    /** Abertas com prazo nesta semana. */
    due_open: Task[];
    /** Abertas com prazo antes desta semana. */
    overdue: number;
  };
  training: WeekStats;
}
