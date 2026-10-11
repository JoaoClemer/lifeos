// Data e hora no relógio local de um fuso IANA (ex.: America/Sao_Paulo), sem dependências.
// Data: 'YYYY-MM-DD'. Data e hora local: 'YYYY-MM-DDTHH:MM'. Instantes: milissegundos UTC (como Date.now()).
// O horário local é o que a agenda guarda: "toda segunda às 09:00" continua às 09:00 quando o horário de verão muda.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(ms: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  const p = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const { type, value } of f.formatToParts(ms)) if (type in p) p[type as keyof typeof p] = Number(value);
  return p;
}

/** Data e hora local ('YYYY-MM-DDTHH:MM') de um instante no fuso. */
export function toLocal(ms: number, timeZone: string): string {
  const p = partsIn(ms, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Agora, no relógio local do fuso. */
export function nowIn(timeZone: string): string {
  return toLocal(Date.now(), timeZone);
}

/** Diferença entre o relógio local e o UTC no instante (ex.: -3h em São Paulo). */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Data válida no calendário ('2026-02-30' não é). */
export function isValidDate(date: string): boolean {
  const m = DATE_ONLY_RE.exec(date);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Data e hora local bem formada e válida no calendário (não diz se o horário existe no fuso; veja fromLocal). */
export function isValidLocal(local: string): boolean {
  const m = LOCAL_RE.exec(local);
  return !!m && isValidDate(local.slice(0, 10)) && +m[4] < 24 && +m[5] < 60;
}

/**
 * ok: o horário existe uma vez no fuso.
 * nonexistent: caiu no salto do início do horário de verão (ex.: 00:30 em 04/11/2018 em São Paulo).
 * ambiguous: aconteceu duas vezes no fim do horário de verão (ex.: 23:30 em 16/02/2019 em São Paulo).
 */
export type LocalTimeKind = "ok" | "nonexistent" | "ambiguous";

/**
 * Converte data e hora local em instante. Horário inexistente avança pelo tamanho do salto (00:30 vira 01:30);
 * horário ambíguo usa a primeira vez em que aconteceu. `kind` informa qual foi o caso.
 */
export function fromLocal(local: string, timeZone: string): { ms: number; kind: LocalTimeKind } {
  if (!isValidLocal(local)) throw new RangeError(`Data/hora inválida: ${local}`);
  const m = LOCAL_RE.exec(local)!;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // As mudanças de horário ficam muito mais distantes que 1 dia entre si: os deslocamentos antes e depois cobrem os casos
  const before = offsetAt(wall - DAY_MS, timeZone);
  const after = offsetAt(wall + DAY_MS, timeZone);
  const hits = [...new Set([wall - before, wall - after])].filter((ms) => toLocal(ms, timeZone) === local).sort((a, b) => a - b);
  if (hits.length === 2) return { ms: hits[0], kind: "ambiguous" };
  if (hits.length === 1) return { ms: hits[0], kind: "ok" };
  return { ms: wall - before, kind: "nonexistent" };
}

/** Soma (ou subtrai) dias a uma data. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Dia da semana: 0 = domingo … 6 = sábado. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Segunda-feira da semana da data (a semana vai de segunda a domingo). */
export function startOfWeek(date: string): string {
  return addDays(date, -((dayOfWeek(date) + 6) % 7));
}
