// Conexões entre pessoas e dívidas conectadas (usados pelo Worker e pelo app).
import { isDue } from "./receivables";

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

/** Acerto com uma pessoa conectada: o que ela te deve menos o que você deve a ela (só o que já venceu). */
export interface NetDebt {
  user_id: number;
  they_owe_cents: number;
  i_owe_cents: number;
  /** Positivo: a pessoa te deve; negativo: você deve a ela. */
  net_cents: number;
}

/** Saldo por pessoa conectada, a partir dos seus devedores pendentes e do que você deve (pendente). */
export function netDebts(
  receivables: { debtor_user_id: number | null; amount_cents: number; received_at: string | null; installment_group: string | null; month: string }[],
  payables: { creditor_id: number; amount_cents: number; received_at: string | null; due: boolean }[],
  refMonth: string,
): Map<number, NetDebt> {
  const out = new Map<number, NetDebt>();
  const of = (id: number) => out.get(id) ?? out.set(id, { user_id: id, they_owe_cents: 0, i_owe_cents: 0, net_cents: 0 }).get(id)!;
  for (const r of receivables) if (r.debtor_user_id && !r.received_at && isDue(r, refMonth)) of(r.debtor_user_id).they_owe_cents += r.amount_cents;
  for (const p of payables) if (p.due && !p.received_at) of(p.creditor_id).i_owe_cents += p.amount_cents;
  for (const n of out.values()) n.net_cents = n.they_owe_cents - n.i_owe_cents;
  return out;
}
