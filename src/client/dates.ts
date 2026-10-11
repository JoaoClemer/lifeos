// Datas e horários em português para as telas (datas 'YYYY-MM-DD', horários locais 'YYYY-MM-DDTHH:MM').
import { lastDay, type Occurrence } from "../shared/agenda";
import { addDays } from "../shared/datetime";

const utc = (date: string) => new Date(`${date}T12:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...opts, timeZone: "UTC" });
const WEEKDAY_SHORT = fmt({ weekday: "short" });
const WEEKDAY_LONG = fmt({ weekday: "long" });
const DAY_MONTH = fmt({ day: "numeric", month: "long" });
const DAY_MONTH_SHORT = fmt({ day: "2-digit", month: "2-digit" });

const clean = (s: string) => s.replace(/\./g, "");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** "seg" */
export const weekdayShort = (date: string) => clean(WEEKDAY_SHORT.format(utc(date)));

/** "Quinta-feira, 15 de outubro" */
export const longDate = (date: string) => cap(`${WEEKDAY_LONG.format(utc(date))}, ${DAY_MONTH.format(utc(date))}`);

/** "15 de outubro" (com o ano se for outro). */
export function dayMonth(date: string, today?: string) {
  const s = DAY_MONTH.format(utc(date));
  return today && date.slice(0, 4) !== today.slice(0, 4) ? `${s} de ${date.slice(0, 4)}` : s;
}

/** "Hoje", "Amanhã", "Ontem" ou "qua, 21/10". */
export function relativeDay(date: string, today: string): string {
  if (date === today) return "Hoje";
  if (date === addDays(today, 1)) return "Amanhã";
  if (date === addDays(today, -1)) return "Ontem";
  const s = `${weekdayShort(date)}, ${DAY_MONTH_SHORT.format(utc(date))}`;
  return date.slice(0, 4) !== today.slice(0, 4) ? `${s}/${date.slice(2, 4)}` : s;
}

/** "14:00–15:30", "Dia inteiro", "até 06:00" (começou antes do dia mostrado) etc. */
export function timeLabel(o: Pick<Occurrence, "all_day" | "start_at" | "end_at">, day?: string): string {
  if (o.all_day) {
    const last = lastDay(o);
    return last === o.start_at.slice(0, 10) ? "Dia inteiro" : `Dia inteiro · até ${DAY_MONTH_SHORT.format(utc(last))}`;
  }
  const start = o.start_at.slice(11);
  const end = o.end_at.slice(11);
  const sameDay = o.start_at.slice(0, 10) === o.end_at.slice(0, 10);
  if (day && o.start_at.slice(0, 10) < day) return `até ${end}`;
  return sameDay ? `${start}–${end}` : `${start}–${DAY_MONTH_SHORT.format(utc(o.end_at.slice(0, 10)))} ${end}`;
}

/** "30 min", "1 h", "1 h 30" */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
