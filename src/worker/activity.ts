import type { Ctx } from "./lib";

/**
 * Registro no histórico (activity_log). Devolve o statement para entrar no mesmo batch da alteração:
 * a ação e o registro dela são gravados juntos ou nenhum dos dois.
 */
export function activity(ctx: Ctx, action: string, entity: string, entityId: number, detail?: Record<string, unknown>): D1PreparedStatement {
  return ctx.db
    .prepare("INSERT INTO activity_log (source, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(ctx.source, action, entity, entityId, detail ? JSON.stringify(detail) : null);
}

/**
 * Auditoria de uma chamada de ferramenta do MCP que pode alterar dados: ferramenta, parâmetros, se deu certo e o começo da resposta.
 * Fica só no banco do usuário (nada vai para os logs do Worker). Falhar aqui não derruba a chamada.
 */
export async function auditMcpCall(db: D1Database, tool: string, args: unknown, ok: boolean, result: string): Promise<void> {
  const detail = JSON.stringify({ tool, args, ok, result: result.slice(0, 300) });
  try {
    await db.prepare("INSERT INTO activity_log (source, action, detail) VALUES ('mcp', 'mcp.call', ?)").bind(detail.slice(0, 4000)).run();
  } catch {
    console.error("MCP: falha ao registrar auditoria de", tool);
  }
}
