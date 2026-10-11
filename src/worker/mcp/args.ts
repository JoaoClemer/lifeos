// Leitura dos parâmetros das ferramentas do LifeOS (em português, como o usuário fala) e textos de resposta.
import { z } from "zod";
import type { EditScope } from "../../shared/agenda";
import { addDays, isValidDate } from "../../shared/datetime";
import { type Ctx, normalize, UserError } from "../lib";

const pad = (n: string | number) => String(n).padStart(2, "0");

export const dateArg = z.string().describe('Data: AAAA-MM-DD, DD/MM, "hoje", "amanhã" ou "ontem"');
export const timeArg = z.string().describe('Horário: "14:00", "9h", "14h30"');
export const confirmArg = z.boolean().optional().describe("true para confirmar. Sem isso, a ferramenta só mostra o que seria feito");

/** Data em AAAA-MM-DD a partir de "2026-10-15", "15/10", "15/10/2026", "hoje", "amanhã", "ontem". */
export function toDate(ctx: Ctx, v: string): string {
  const t = normalize(v);
  if (t === "hoje") return ctx.today;
  if (t === "amanha") return addDays(ctx.today, 1);
  if (t === "ontem") return addDays(ctx.today, -1);
  if (isValidDate(v.trim())) return v.trim();
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(v.trim());
  if (m) {
    const d = `${m[3] ?? ctx.today.slice(0, 4)}-${pad(m[2])}-${pad(m[1])}`;
    if (isValidDate(d)) return d;
  }
  throw new UserError(`Data inválida: "${v}" (use AAAA-MM-DD, DD/MM, hoje ou amanhã)`);
}

/** Horário HH:MM a partir de "14:00", "9h", "9", "14h30", "7:05". */
export function toTime(v: string): string {
  const m = /^(\d{1,2})(?:[:h](\d{2})?)?h?$/i.exec(v.trim().replace(/\s/g, ""));
  if (m && Number(m[1]) < 24 && Number(m[2] ?? 0) < 60) return `${pad(m[1])}:${pad(m[2] ?? 0)}`;
  throw new UserError(`Horário inválido: "${v}" (use 14:00, 9h ou 14h30)`);
}

export const scopeArg = z
  .enum(["so_esta", "esta_e_seguintes", "todas"])
  .optional()
  .describe("Em evento que se repete: vale só para esta ocorrência, para esta e as seguintes, ou para todas. Obrigatório nesse caso");

export const SCOPES: Record<"so_esta" | "esta_e_seguintes" | "todas", EditScope> = { so_esta: "this", esta_e_seguintes: "following", todas: "all" };

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

/** "qui, 15/10" (com " (hoje)", " (amanhã)" quando for o caso). */
export function dayLabel(date: string, today: string): string {
  const w = WEEKDAY.format(new Date(`${date}T12:00:00Z`)).replace(".", "");
  const rel = date === today ? " (hoje)" : date === addDays(today, 1) ? " (amanhã)" : "";
  return `${w}, ${date.slice(8)}/${date.slice(5, 7)}${date.slice(0, 4) !== today.slice(0, 4) ? `/${date.slice(0, 4)}` : ""}${rel}`;
}

/** Prévia de uma ação que exige confirmação (não é erro: o Claude deve perguntar ao usuário e chamar de novo). */
export function needsConfirmation(what: string): string {
  return `⚠️ Confirmação necessária: ${what}\nPergunte ao usuário e, se ele confirmar, chame de novo com confirmar: true. Nada foi alterado.`;
}
