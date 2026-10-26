import type { Receivable } from "./types";

/** Parcela futura de um devedor parcelado ainda não "venceu": só conta como pendente a partir do mês dela. */
export function isDue(r: Pick<Receivable, "installment_group" | "month">, refMonth: string): boolean {
  return !r.installment_group || r.month <= refMonth;
}

/**
 * Chave de uma pessoa no acesso de devedores: "Maria Clara", "maria-clara" e "María Clara" -> "MARIA_CLARA".
 * É o sufixo da variável com o código dela (DEBTOR_CODE_MARIA_CLARA).
 */
export function personKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Um valor como o devedor vê na página dele (sem cartão nem ids internos). */
export interface DebtorItem {
  description: string;
  amount_cents: number;
  date: string;
  month: string;
  installment_no: number | null;
  installment_total: number | null;
  received_at: string | null;
}

/** O que a pessoa vê em /devedor depois de entrar com o código dela. */
export interface DebtorStatement {
  person: string;
  /** Mês atual (as parcelas deste mês e anteriores já estão em aberto). */
  month: string;
  /** Pendentes já vencidos, mais recentes primeiro. */
  due: DebtorItem[];
  due_cents: number;
  /** Parcelas futuras de devedores parcelados, em ordem de mês. */
  upcoming: DebtorItem[];
  upcoming_cents: number;
  /** Já pagos, mais recentes primeiro. */
  paid: DebtorItem[];
}
