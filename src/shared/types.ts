// Formatos retornados pela API (compartilhados entre Worker e front-end).

export type AccountType = "credit" | "debit" | "pix" | "cash" | "voucher" | "other";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  credit: "Crédito",
  debit: "Débito",
  pix: "Pix",
  cash: "Dinheiro",
  voucher: "Vale (VR/VA)",
  other: "Outro",
};

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  closing_day: number | null;
  due_day: number | null;
  /** Dia em que você paga a fatura; null = no vencimento. */
  payment_day: number | null;
  color: string | null;
  archived: number;
}

export interface Expense {
  id: number;
  description: string;
  amount_cents: number;
  date: string;
  month: string;
  account_id: number | null;
  budget_id: number | null;
  notes: string | null;
  /** Soma das partes de outras pessoas (devedores ligados a este gasto). */
  shared_cents: number;
}

export interface Installment {
  id: number;
  description: string;
  installment_cents: number;
  total_installments: number;
  first_month: string;
  last_month: string;
  account_id: number | null;
  purchase_date: string | null;
  /** Número da parcela no mês consultado (pode ser < 1 ou > total fora do período). */
  current: number;
  /** Quanto falta pagar depois do mês consultado. */
  remaining_cents: number;
}

export interface Recurring {
  id: number;
  description: string;
  amount_cents: number;
  account_id: number | null;
  is_budget: number;
  day: number | null;
  start_month: string;
  end_month: string | null;
  /** Valor efetivo no mês consultado (com ajuste do mês, se houver). */
  month_amount_cents: number;
  overridden: boolean;
  paid: boolean;
  /** Para orçamentos: quanto já foi lançado no mês. */
  spent_cents: number;
}

export interface Receivable {
  id: number;
  person: string;
  description: string;
  amount_cents: number;
  date: string;
  month: string;
  account_id: number | null;
  expense_id: number | null;
  received_at: string | null;
  /** Devedor parcelado: id do parcelamento, nº desta parcela e total de parcelas (null se à vista). */
  installment_group: string | null;
  installment_no: number | null;
  installment_total: number | null;
}

/** Entrada extra de dinheiro no mês (13º, bônus, PLR...). O salário fixo fica em Settings.income_cents. */
export interface Income {
  id: number;
  description: string;
  amount_cents: number;
  date: string;
  month: string;
  notes: string | null;
}

export type GoalEntryKind = "contribution" | "withdrawal" | "adjustment";

export interface GoalEntry {
  id: number;
  goal_id: number;
  kind: GoalEntryKind;
  amount_cents: number;
  month: string;
  date: string;
  note: string | null;
}

export interface Goal {
  id: number;
  name: string;
  institution: string | null;
  target_cents: number | null;
  monthly_cents: number | null;
  deadline: string | null;
  start_month: string;
  color: string | null;
  archived: number;
  balance_cents: number;
  /** Aportes líquidos (aportes - resgates) no mês consultado. */
  month_contrib_cents: number;
  /** Aporte planejado no mês consultado (0 se não houver ou se a meta já foi atingida). */
  month_planned_cents: number;
  /** Mês estimado para atingir a meta no ritmo do aporte mensal. */
  eta_month: string | null;
  /** Aporte mensal necessário para bater a meta até o prazo. */
  required_monthly_cents: number | null;
}

export interface Settings {
  income_cents: number | null;
  default_account_id: number | null;
}

export interface AccountTotal {
  account_id: number | null;
  name: string;
  type: AccountType | null;
  due_day: number | null;
  payment_day: number | null;
  total_cents: number;
}

export interface BudgetStatus {
  id: number;
  description: string;
  limit_cents: number;
  spent_cents: number;
  remaining_cents: number;
}

/** Saldo acumulado do mês: inicial (do mês anterior ou ajustado) + sobra = final. */
export interface MonthBalance {
  /** Mês em que o acúmulo começa. */
  start_month: string;
  opening_cents: number;
  /** start = 1º mês do acúmulo (0); carried = veio do mês anterior; manual = ajustado por você. */
  opening_source: "start" | "carried" | "manual";
  /** Saldo inicial que valeria sem o ajuste manual. */
  automatic_opening_cents: number;
  note: string | null;
  /** Sobra do mês (renda - gastos - aportes), com renda 0 se não configurada. */
  leftover_cents: number;
  closing_cents: number;
}

export interface Summary {
  month: string;
  today: string;
  totals: {
    installments_cents: number;
    recurring_cents: number;
    one_off_cents: number;
    /** Gasto acima do previsto nos orçamentos (já incluído em recurring_cents). */
    budget_overflow_cents: number;
    total_cents: number;
    receivable_month_cents: number;
    /** Pendente já "vencido" (inclui parcelas de devedores parcelados até o mês). */
    receivable_pending_cents: number;
    /** Parcelas futuras de devedores parcelados, ainda não vencidas. */
    receivable_future_cents: number;
    /** Renda total do mês = salário fixo + entradas extras (null se nenhum dos dois). */
    income_cents: number | null;
    income_base_cents: number | null;
    income_extra_cents: number;
    goals_planned_cents: number;
    goals_done_cents: number;
    /** Renda - gastos - aportes planejados (null se renda não configurada). */
    leftover_cents: number | null;
  };
  by_account: AccountTotal[];
  budgets: BudgetStatus[];
  pending_by_person: { person: string; total_cents: number; count: number }[];
  /** Saldo acumulado (null antes do mês em que o acúmulo começa). */
  balance: MonthBalance | null;
}
