// Utilitários de datas/meses. Mês = 'YYYY-MM', data = 'YYYY-MM-DD'.

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Quantos meses de `from` até `to` (to - from). */
export function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ty * 12 + tm - (fy * 12 + fm);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function todayIn(timeZone = "America/Sao_Paulo"): string {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export interface CardCycle {
  type: string;
  closing_day: number | null;
  due_day: number | null;
  /** Dia em que você paga a fatura (se diferente do vencimento). */
  payment_day?: number | null;
}

/**
 * Mês de referência de uma compra = mês em que o dinheiro sai da conta.
 * Cartão de crédito com dia de fechamento: compras no dia do fechamento ou depois vão para a próxima fatura;
 * a fatura conta no mês em que vence ou, se você paga num dia do mês anterior (ex.: vence dia 1 e paga dia 25),
 * no mês em que paga. Demais formas de pagamento: o próprio mês da data.
 */
export function referenceMonth(date: string, account?: CardCycle | null): string {
  let month = monthOf(date);
  if (!account || account.type !== "credit" || !account.closing_day) return month;
  const day = Number(date.slice(8, 10));
  if (day >= account.closing_day) month = addMonths(month, 1); // mês em que a fatura fecha
  if (account.due_day && account.due_day <= account.closing_day) month = addMonths(month, 1); // vence no mês seguinte ao fechamento
  // Paga antes do vencimento, num dia "maior" (ex.: vence 1, paga 25): a fatura sai no mês anterior ao vencimento
  if (account.due_day && account.payment_day && account.payment_day > account.due_day) month = addMonths(month, -1);
  return month;
}

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_PT_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthLabel(month: string, short = false): string {
  const [y, m] = month.split("-").map(Number);
  return short ? `${MONTHS_PT_SHORT[m - 1]}/${String(y).slice(2)}` : `${MONTHS_PT[m - 1]} de ${y}`;
}

/** "Outubro 2026" (para títulos). */
export function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const name = MONTHS_PT[m - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} ${y}`;
}

export function formatDateBR(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}
