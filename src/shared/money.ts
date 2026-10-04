const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

/** Reais (número) -> centavos. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Converte texto digitado em centavos. Aceita "32,50", "1.234,56", "1234.56", "R$ 10".
 * Retorna null se inválido.
 */
export function parseMoney(input: string): number | null {
  let s = input.replace(/[R$\s]/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) {
    s = s.replace(/\./g, "").replace(",", "."); // formato BR
  } else if (lastDot > lastComma && lastComma >= 0) {
    s = s.replace(/,/g, ""); // formato US com milhar
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.234" = mil duzentos e trinta e quatro
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Centavos -> texto para input ("32,50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
