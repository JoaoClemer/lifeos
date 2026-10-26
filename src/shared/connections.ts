// Conexões entre pessoas e dívidas conectadas (usados pelo Worker e pelo app).

/** Pessoa conectada a você. */
export interface Connection {
  user_id: number;
  name: string | null;
  since: string;
}

/** Nome dos seus devedores ligado à conta de uma pessoa conectada. */
export interface PersonLink {
  person_key: string;
  linked_user_id: number;
  linked_name: string | null;
}

/** Algo que você deve a uma pessoa conectada (a linha é dela; você só vê o necessário). */
export interface Payable {
  id: number;
  creditor_id: number;
  creditor_name: string | null;
  description: string;
  amount_cents: number;
  date: string;
  month: string;
  installment_no: number | null;
  installment_total: number | null;
  received_at: string | null;
  paid_claimed_at: string | null;
  disputed_at: string | null;
  dispute_note: string | null;
}

export type DebtStatus = "pending" | "claimed" | "disputed" | "received";

/** Situação de uma dívida conectada: recebida, contestada, "paguei" aguardando confirmação ou pendente. */
export function debtStatus(r: { received_at: string | null; paid_claimed_at: string | null; disputed_at: string | null }): DebtStatus {
  if (r.received_at) return "received";
  if (r.disputed_at) return "disputed";
  if (r.paid_claimed_at) return "claimed";
  return "pending";
}
