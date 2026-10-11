// Servidor MCP mínimo (transporte Streamable HTTP, sem sessão, respostas JSON).
// Implementado direto sobre JSON-RPC para ficar leve no limite de CPU do plano grátis do Workers.
import { z } from "zod";
import { auditMcpCall } from "../activity";
import { makeCtx, UserError } from "../lib";
import { AGENDA_TOOLS } from "../modules/agenda/tools";
import { TASK_TOOLS } from "../modules/tasks/tools";
import { TODAY_TOOLS } from "../modules/today/tools";
import { TRAINING_TOOLS } from "../modules/training/tools";
import { TOOLS as FINANCE_TOOLS } from "./tools";

const TOOLS = [...FINANCE_TOOLS, ...TODAY_TOOLS, ...AGENDA_TOOLS, ...TASK_TOOLS, ...TRAINING_TOOLS];

const SERVER_INFO = { name: "lifeos", title: "LifeOS", version: "0.2.0" };
const LATEST_PROTOCOL = "2025-06-18";

const INSTRUCTIONS = `LifeOS: sistema pessoal do usuário com agenda, tarefas, treinos e finanças (valores em reais, datas e horários no fuso de São Paulo).

Geral:
- "Como está meu dia?" → revisao_diaria. Revisar ou planejar a semana → revisao_semanal.
- Datas aceitam AAAA-MM-DD, DD/MM, "hoje" e "amanhã"; horários aceitam "14:00", "9h", "14h30".
- Exclusões exigem confirmar: true. Chame primeiro sem confirmar, mostre ao usuário o que será excluído e só confirme se ele concordar.
- Não invente ids: consulte (agenda, listar_tarefas, treinos_semana) para obtê-los.

Agenda:
- Consultar compromissos → agenda (periodo hoje, amanha, semana ou proximos_7_dias). Marcar → criar_evento (sem hora_inicio = dia inteiro).
- Evento que se repete: para editar ou cancelar, informe ocorrencia (como aparece na agenda) e alcance (so_esta, esta_e_seguintes ou todas). Se o usuário não disser, pergunte.
- Reservar um horário para uma tarefa → criar_evento com o parâmetro tarefa (não crie outra tarefa).

Tarefas:
- Anotar algo a fazer → criar_tarefa (prazo opcional). "Terminei X" → concluir_tarefa. Ver pendências → listar_tarefas.

Treinos:
- Planejar → planejar_treino. "Fiz/corri/nadei X" → registrar_treino (preenche o treino planejado do dia, sem duplicar). Ver a semana → treinos_semana.
- Não realizado ou desmarcado → status_treino.

Finanças:
- Antes de lançar algo com cartão/orçamento/meta, se não souber o nome exato, chame listar_cadastros.
- "Lança 50 no Nubank" → lancar_despesa. Compras parceladas → lancar_parcelado. Assinaturas/contas mensais → adicionar_fixo.
- Gastos de almoço, transporte etc. que o usuário desconta de um valor reservado → lancar_despesa com o parâmetro orcamento.
- Dividiu a conta com alguém → lancar_despesa com dividir_com (a parte dos outros vira devedor).
- Passou no cartão uma compra parcelada para outra pessoa → registrar_devedor com parcelas.
- Recebeu dinheiro além do salário (13º, bônus, PLR, freela) → registrar_entrada.
- A sobra de cada mês passa para o seguinte. Se o usuário informar o saldo real ("terminei o mês com X") → ajustar_saldo.
- Confirme com o usuário antes de remover lançamentos.`;

type JsonRpcId = string | number | null;
interface JsonRpcMessage {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

let toolList: unknown[] | null = null;
function listTools() {
  // Gera os JSON Schemas uma vez por isolate
  toolList ??= TOOLS.map((t) => {
    const { $schema: _ignored, ...inputSchema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
    return { name: t.name, title: t.title, description: t.description, inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) };
  });
  return toolList;
}

const result = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const error = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function callTool(params: Record<string, unknown> | undefined, env: Env) {
  const name = params?.name as string;
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: "text", text: `Ferramenta desconhecida: ${name}` }], isError: true };
  try {
    const args = tool.schema.parse(params?.arguments ?? {});
    const text = await tool.run(args, makeCtx(env, "mcp"));
    if (!tool.annotations?.readOnlyHint) await auditMcpCall(env.DB, name, args, true, text);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    let text: string;
    if (e instanceof z.ZodError) text = `Parâmetros inválidos:\n${z.prettifyError(e)}`;
    else if (e instanceof UserError) text = e.message;
    else {
      console.error("MCP tool error", name, e);
      text = `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!tool.annotations?.readOnlyHint) await auditMcpCall(env.DB, name, params?.arguments ?? {}, false, text);
    return { content: [{ type: "text", text }], isError: true };
  }
}

async function handleMessage(msg: JsonRpcMessage, env: Env) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return error(null, -32600, "Invalid Request");
  // Notificações (sem id) e respostas do cliente não têm resposta
  if (msg.id === undefined || !msg.method) return null;
  const id = msg.id;
  switch (msg.method) {
    case "initialize": {
      const requested = msg.params?.protocolVersion;
      return result(id, {
        // Só usamos ferramentas + respostas JSON, compatível com todas as versões do protocolo
        protocolVersion: typeof requested === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: listTools() });
    case "tools/call":
      return result(id, await callTool(msg.params, env));
    case "resources/list":
      return result(id, { resources: [] });
    case "resources/templates/list":
      return result(id, { resourceTemplates: [] });
    case "prompts/list":
      return result(id, { prompts: [] });
    default:
      return error(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpRequest(req: Request, env: Env): Promise<Response> {
  if (req.method === "GET" || req.method === "DELETE") {
    // Sem stream SSE nem sessões: o cliente deve usar só POST
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(error(null, -32700, "Parse error"), { status: 400 });
  }
  const messages = (Array.isArray(body) ? body : [body]) as JsonRpcMessage[];
  const responses = (await Promise.all(messages.map((m) => handleMessage(m, env)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? responses : responses[0]);
}
