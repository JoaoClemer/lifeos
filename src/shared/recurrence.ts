// Recorrência de eventos: subconjunto da RRULE (RFC 5545) suficiente para uso pessoal.
// Suportado: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (só semanal), COUNT ou UNTIL (data, inclusive).
// As ocorrências não são gravadas: são calculadas só para o intervalo pedido, o que evita duplicatas e é leve.
import { addDays, daysInMonth, diffDays, startOfWeek } from "./datetime";
import { addMonths } from "./month";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
/** Índice = dia da semana do JavaScript (0 = domingo). */
export const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface RRule {
  freq: Freq;
  interval: number;
  /** Dias da semana (só FREQ=WEEKLY). Omitido: o dia da semana do início. */
  byday?: Weekday[];
  /** Número total de ocorrências. */
  count?: number;
  /** Última data possível ('YYYY-MM-DD', inclusive). */
  until?: string;
}

const FREQS: Freq[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

export function parseRRule(text: string): RRule {
  const fields = new Map<string, string>();
  for (const part of text.trim().replace(/^RRULE:/i, "").split(";")) {
    if (!part) continue;
    const [k, v] = part.split("=");
    if (!k || v === undefined) throw new RangeError(`Regra de repetição inválida: ${text}`);
    fields.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = fields.get("FREQ") as Freq | undefined;
  if (!freq || !FREQS.includes(freq)) throw new RangeError("Repetição: FREQ deve ser DAILY, WEEKLY, MONTHLY ou YEARLY");
  const rule: RRule = { freq, interval: 1 };
  for (const [k, v] of fields) {
    switch (k) {
      case "FREQ":
        break;
      case "INTERVAL":
        rule.interval = Number(v);
        if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 99) throw new RangeError("Repetição: INTERVAL deve ser de 1 a 99");
        break;
      case "BYDAY": {
        if (freq !== "WEEKLY") throw new RangeError("Repetição: BYDAY só é aceito com FREQ=WEEKLY");
        const days = v.split(",");
        if (!days.every((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))) throw new RangeError("Repetição: BYDAY com dia inválido");
        rule.byday = WEEKDAYS.filter((d) => days.includes(d));
        break;
      }
      case "COUNT":
        rule.count = Number(v);
        if (!Number.isInteger(rule.count) || rule.count < 1 || rule.count > 1000) throw new RangeError("Repetição: COUNT deve ser de 1 a 1000");
        break;
      case "UNTIL": {
        const m = /^(\d{4})(\d{2})(\d{2})(T\d{6}Z?)?$/.exec(v);
        if (!m) throw new RangeError("Repetição: UNTIL deve ser uma data AAAAMMDD");
        rule.until = `${m[1]}-${m[2]}-${m[3]}`;
        break;
      }
      default:
        throw new RangeError(`Repetição: ${k} não é suportado`);
    }
  }
  if (rule.count && rule.until) throw new RangeError("Repetição: use COUNT ou UNTIL, não os dois");
  return rule;
}

export function formatRRule(r: RRule): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval !== 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byday?.length) parts.push(`BYDAY=${r.byday.join(",")}`);
  if (r.count) parts.push(`COUNT=${r.count}`);
  if (r.until) parts.push(`UNTIL=${r.until.replaceAll("-", "")}`);
  return parts.join(";");
}

/**
 * Datas das ocorrências a partir de `startDate`, com o índice de cada uma na série (0 = primeira),
 * pulando direto para perto de `fromDate` quando possível (séries diárias/semanais longas).
 */
function* seriesDates(startDate: string, r: RRule, fromDate: string): Generator<{ date: string; index: number }> {
  if (r.freq === "DAILY") {
    const k0 = fromDate > startDate ? Math.floor(diffDays(startDate, fromDate) / r.interval) : 0;
    for (let k = k0; ; k++) yield { date: addDays(startDate, k * r.interval), index: k };
  }
  if (r.freq === "WEEKLY") {
    // Deslocamentos a partir da segunda-feira (0 = segunda ... 6 = domingo)
    const days = (r.byday ?? [WEEKDAYS[new Date(`${startDate}T00:00Z`).getUTCDay()]])
      .map((d) => (WEEKDAYS.indexOf(d) + 6) % 7)
      .sort((a, b) => a - b);
    const week0 = startOfWeek(startDate);
    const firstWeek = days.filter((off) => addDays(week0, off) >= startDate).length;
    const p0 = fromDate > startDate ? Math.floor(diffDays(week0, fromDate) / (7 * r.interval)) : 0;
    for (let p = p0; ; p++) {
      const week = addDays(week0, p * 7 * r.interval);
      let i = 0;
      for (const off of days) {
        const date = addDays(week, off);
        if (date < startDate) continue;
        yield { date, index: p === 0 ? i : firstWeek + (p - 1) * days.length + i };
        i++;
      }
    }
  }
  // Mensal e anual: mesmo dia do mês; meses sem esse dia (ex.: 31, ou 29/02) são pulados, como na RFC 5545
  const step = r.freq === "MONTHLY" ? r.interval : 12 * r.interval;
  const day = startDate.slice(8, 10);
  for (let k = 0, index = 0; ; k++) {
    const month = addMonths(startDate.slice(0, 7), k * step);
    if (Number(day) > daysInMonth(month)) continue;
    yield { date: `${month}-${day}`, index: index++ };
  }
}

/**
 * Inícios (horário local 'YYYY-MM-DDTHH:MM') das ocorrências que começam em [from, to).
 * `start` é o início da série; o horário de todas as ocorrências é o mesmo do início.
 */
export function occurrences(start: string, rule: RRule, from: string, to: string, limit = 1000): string[] {
  const time = start.slice(10); // "THH:MM"
  const out: string[] = [];
  for (const { date, index } of seriesDates(start.slice(0, 10), rule, from.slice(0, 10))) {
    if (rule.count !== undefined && index >= rule.count) break;
    if (rule.until && date > rule.until) break;
    const occ = date + time;
    if (occ >= to || out.length >= limit) break;
    if (occ >= from) out.push(occ);
  }
  return out;
}

/** `occ` é uma ocorrência da série? */
export function isOccurrence(start: string, rule: RRule, occ: string): boolean {
  return occurrences(start, rule, occ, `${addDays(occ.slice(0, 10), 1)}T00:00`, 1)[0] === occ;
}

/** Quantas ocorrências a série tem antes de `occ`. */
export function countBefore(start: string, rule: RRule, occ: string): number {
  return occurrences(start, rule, start, occ, 100_000).length;
}

/**
 * Próxima data da série depois de `after` ('YYYY-MM-DD'), usando `start` (uma data da série) como referência.
 * Null se a série já terminou (UNTIL). Usado nas tarefas que se repetem.
 */
export function nextDateAfter(start: string, rule: RRule, after: string): string | null {
  const from = `${addDays(after, 1)}T00:00`;
  // 3000 dias cobrem até "a cada 2 anos" em 29/02
  const next = occurrences(`${start}T00:00`, rule, from, `${addDays(after, 3000)}T00:00`, 1)[0];
  return next ? next.slice(0, 10) : null;
}

const DAY_NAME: Record<Weekday, string> = { MO: "seg", TU: "ter", WE: "qua", TH: "qui", FR: "sex", SA: "sáb", SU: "dom" };
const UNITS: Record<Freq, [string, string, string]> = {
  DAILY: ["todo dia", "dias", "a cada"],
  WEEKLY: ["toda semana", "semanas", "a cada"],
  MONTHLY: ["todo mês", "meses", "a cada"],
  YEARLY: ["todo ano", "anos", "a cada"],
};

/** "todo dia", "a cada 2 semanas (seg, qua)", "todo mês no dia 10", "todo ano em 15/03", com " até 31/12/2026" ou ", 10 vezes". */
export function describeRRule(r: RRule, startDate?: string): string {
  const [every, plural, prefix] = UNITS[r.freq];
  let s = r.interval === 1 ? every : `${prefix} ${r.interval} ${plural}`;
  if (r.freq === "WEEKLY" && r.byday?.length) {
    const order: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
    s += ` (${order.filter((d) => r.byday!.includes(d)).map((d) => DAY_NAME[d]).join(", ")})`;
  }
  if (r.freq === "MONTHLY" && startDate) s += ` no dia ${Number(startDate.slice(8, 10))}`;
  if (r.freq === "YEARLY" && startDate) s += ` em ${startDate.slice(8, 10)}/${startDate.slice(5, 7)}`;
  if (r.until) s += ` até ${r.until.slice(8, 10)}/${r.until.slice(5, 7)}/${r.until.slice(0, 4)}`;
  if (r.count) s += `, ${r.count} vezes`;
  return s;
}
