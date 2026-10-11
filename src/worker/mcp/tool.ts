import type { z } from "zod";
import type { Ctx } from "../lib";

/** Ferramenta MCP: nome e parâmetros em português (é o que o Claude casa com o que o usuário fala). */
export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: z.output<S>, ctx: Ctx) => Promise<string>;
}

export const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool;
