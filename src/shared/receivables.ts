import type { Receivable } from "./types";

/** Parcela futura de um devedor parcelado ainda não "venceu": só conta como pendente a partir do mês dela. */
export function isDue(r: Pick<Receivable, "installment_group" | "month">, refMonth: string): boolean {
  return !r.installment_group || r.month <= refMonth;
}
