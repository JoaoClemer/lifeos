import type { Context } from "hono";
import { z } from "zod";
import { UserError } from "./lib";

/** Erros viram respostas JSON: UserError e validação são 4xx; o resto vira 500 sem detalhes. */
export function onAppError(err: Error, c: Context) {
  if (err instanceof UserError) return c.json({ error: err.message }, err.status);
  if (err instanceof z.ZodError) return c.json({ error: z.prettifyError(err) }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "JSON inválido" }, 400);
  console.error(err);
  return c.json({ error: "Erro interno" }, 500);
}
