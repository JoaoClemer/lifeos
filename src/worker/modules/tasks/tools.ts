// Ferramentas MCP de tarefas e projetos. Chamam o mesmo service da API (mesmas regras e validações).
import { z } from "zod";
import { addDays } from "../../../shared/datetime";
import { type Task, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskPriority, type TaskStatus } from "../../../shared/tasks";
import type { Ctx } from "../../lib";
import { describeRRule, parseRRule } from "../../../shared/recurrence";
import { confirmArg, dateArg, dayLabel, needsConfirmation, repeatArg, toDate, toRRule } from "../../mcp/args";
import { type Tool, tool } from "../../mcp/tool";
import * as tasks from "./service";

const PRIORITY: Record<string, TaskPriority> = { baixa: "low", media: "medium", alta: "high" };
const STATUS: Record<string, TaskStatus> = { pendente: "todo", em_andamento: "doing", concluida: "done" };
const priorityArg = z.enum(["baixa", "media", "alta"]);
const taskArg = z.string().describe('Id da tarefa (ex.: "12") ou o título');

/** Resolve a tarefa por id ("12", "[12]") ou pelo título (aberta primeiro, depois concluída). */
async function findTask(ctx: Ctx, v: string): Promise<Task> {
  const id = /^\[?(\d+)\]?$/.exec(v.trim());
  if (id) return tasks.getTask(ctx, Number(id[1]));
  try {
    return await tasks.resolveTask(ctx, v);
  } catch (e) {
    if (e instanceof Error && e.message.includes("ambíguo")) throw e;
    return tasks.resolveTask(ctx, v, "done");
  }
}

async function projectId(ctx: Ctx, name: string | null | undefined): Promise<number | null | undefined> {
  if (name === undefined) return undefined;
  if (name === null || name === "") return null;
  return (await tasks.resolveProject(ctx, name)).id;
}

export function taskLine(t: Task, today: string): string {
  const parts = [`[tarefa ${t.id}] ${t.title}`];
  if (t.due_date) parts.push(`prazo ${dayLabel(t.due_date, today)}${t.status !== "done" && t.due_date < today ? " ⚠️ atrasada" : ""}`);
  if (t.priority !== "medium") parts.push(`prioridade ${TASK_PRIORITY_LABEL[t.priority].toLowerCase()}`);
  if (t.status === "doing") parts.push("em andamento");
  if (t.rrule && t.status !== "done") parts.push(`repete ${describeRRule(parseRRule(t.rrule), t.due_date ?? undefined)}`);
  if (t.status === "done") parts.push(`concluída${t.completed_at ? ` em ${t.completed_at.replace("T", " ")}` : ""}`);
  if (t.subtasks_total) parts.push(`subtarefas ${t.subtasks_done}/${t.subtasks_total}`);
  if (t.tags.length) parts.push(t.tags.map((x) => `#${x}`).join(" "));
  return `• ${parts.join(" · ")}`;
}

export const TASK_TOOLS: Tool[] = [
  tool({
    name: "listar_tarefas",
    title: "Listar tarefas",
    description:
      "Lista tarefas. filtro: hoje (atrasadas + prazo hoje), atrasadas, proximas (próximos 7 dias), abertas (todas as não concluídas, padrão) ou concluidas. " +
      "Pode filtrar por projeto, prioridade, etiqueta ou texto. Mostra os ids para concluir, editar ou remover.",
    schema: z.object({
      filtro: z.enum(["hoje", "atrasadas", "proximas", "abertas", "concluidas"]).optional(),
      projeto: z.string().optional(),
      prioridade: priorityArg.optional(),
      etiqueta: z.string().optional(),
      busca: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const filtro = a.filtro ?? "abertas";
      const list = await tasks.listTasks(ctx, {
        status: filtro === "concluidas" ? "done" : "open",
        project_id: (await projectId(ctx, a.projeto)) ?? undefined,
        priority: a.prioridade ? PRIORITY[a.prioridade] : undefined,
        tag: a.etiqueta,
        search: a.busca,
        limit: filtro === "concluidas" ? 30 : undefined,
        ...(filtro === "hoje" ? { due_to: ctx.today } : {}),
        ...(filtro === "atrasadas" ? { due_to: addDays(ctx.today, -1) } : {}),
        ...(filtro === "proximas" ? { due_from: addDays(ctx.today, 1), due_to: addDays(ctx.today, 7) } : {}),
      });
      const header = `Tarefas (${filtro}) — hoje é ${dayLabel(ctx.today, ctx.today).replace(" (hoje)", "")}:`;
      return list.length ? [header, ...list.map((t) => taskLine(t, ctx.today))].join("\n") : `${header}\nNenhuma.`;
    },
  }),

  tool({
    name: "criar_tarefa",
    title: "Criar tarefa",
    description:
      "Cria uma tarefa. Prazo é opcional e não ocupa horário na agenda (para reservar um horário, use criar_evento com o parâmetro tarefa). " +
      "Com repetir, a tarefa se repete (todo dia, toda semana etc.): ao concluir, a próxima é criada com o novo prazo (sem prazo, começa hoje). " +
      "Se uma tarefa com o mesmo título foi criada há poucos minutos, devolve a existente em vez de duplicar.",
    schema: z.object({
      titulo: z.string().min(1),
      prazo: dateArg.optional(),
      prioridade: priorityArg.optional(),
      projeto: z.string().optional().describe("Nome de um projeto existente"),
      etiquetas: z.array(z.string()).optional(),
      estimativa_min: z.number().int().positive().optional().describe("Tempo estimado em minutos"),
      notas: z.string().optional(),
      subtarefas: z.array(z.string().min(1)).optional(),
      repetir: repeatArg.optional().describe("Repetição da tarefa (sem 'vezes': termina numa data com 'ate')"),
    }),
    async run(a, ctx) {
      const existing = await tasks.findRecentTask(ctx, a.titulo);
      if (existing) return `Já existia (criada há poucos minutos), nada foi duplicado:\n${taskLine(existing, ctx.today)}`;
      const t = await tasks.createTask(ctx, {
        title: a.titulo,
        due_date: a.prazo ? toDate(ctx, a.prazo) : null,
        priority: a.prioridade ? PRIORITY[a.prioridade] : undefined,
        project_id: await projectId(ctx, a.projeto),
        tags: a.etiquetas,
        estimate_minutes: a.estimativa_min ?? null,
        notes: a.notas ?? null,
        rrule: a.repetir ? toRRule(ctx, a.repetir) : null,
      });
      for (const s of a.subtarefas ?? []) await tasks.createTask(ctx, { title: s, parent_id: t.id });
      return `✅ Tarefa criada:\n${taskLine(await tasks.getTask(ctx, t.id), ctx.today)}`;
    },
  }),

  tool({
    name: "concluir_tarefa",
    title: "Concluir ou reabrir tarefa",
    description:
      "Marca a tarefa como concluída (com as subtarefas abertas) ou, com reabrir: true, volta para pendente. Concluir de novo não muda nada. " +
      "Em tarefa que se repete, concluir cria a próxima com o novo prazo; reabrir remove a próxima que ainda não foi feita.",
    schema: z.object({ tarefa: taskArg, reabrir: z.boolean().optional() }),
    annotations: { idempotentHint: true },
    async run(a, ctx) {
      const t = await findTask(ctx, a.tarefa);
      if (!a.reabrir && t.status === "done") return `A tarefa já estava concluída:\n${taskLine(t, ctx.today)}`;
      if (a.reabrir && t.status !== "done") return `A tarefa não estava concluída:\n${taskLine(t, ctx.today)}`;
      const u = await tasks.updateTask(ctx, t.id, { status: a.reabrir ? "todo" : "done" });
      const next = !a.reabrir && u.rrule ? await tasks.getSuccessor(ctx, u.id) : null;
      return `${a.reabrir ? "↩️ Tarefa reaberta" : "✅ Tarefa concluída"}:\n${taskLine(u, ctx.today)}${
        next ? `\nPróxima: ${taskLine(next, ctx.today).slice(2)}` : u.rrule && !a.reabrir ? "\nA repetição terminou: não há próxima." : ""
      }`;
    },
  }),

  tool({
    name: "editar_tarefa",
    title: "Editar tarefa",
    description:
      'Altera título, prazo (use "" para tirar o prazo), prioridade, situação, projeto, etiquetas, estimativa, notas ou a repetição de uma tarefa (repetir ou parar_de_repetir).',
    schema: z.object({
      tarefa: taskArg,
      titulo: z.string().min(1).optional(),
      prazo: z.string().optional().describe('Nova data ou "" para ficar sem prazo'),
      prioridade: priorityArg.optional(),
      situacao: z.enum(["pendente", "em_andamento", "concluida"]).optional(),
      projeto: z.string().optional().describe('Nome do projeto ou "" para tirar do projeto'),
      etiquetas: z.array(z.string()).optional(),
      estimativa_min: z.number().int().positive().optional(),
      notas: z.string().optional(),
      repetir: repeatArg.optional(),
      parar_de_repetir: z.boolean().optional(),
    }),
    async run(a, ctx) {
      const t = await findTask(ctx, a.tarefa);
      const u = await tasks.updateTask(ctx, t.id, {
        rrule: a.parar_de_repetir ? null : a.repetir ? toRRule(ctx, a.repetir) : undefined,
        title: a.titulo,
        due_date: a.prazo === undefined ? undefined : a.prazo === "" ? null : toDate(ctx, a.prazo),
        priority: a.prioridade ? PRIORITY[a.prioridade] : undefined,
        status: a.situacao ? STATUS[a.situacao] : undefined,
        project_id: await projectId(ctx, a.projeto),
        tags: a.etiquetas,
        estimate_minutes: a.estimativa_min,
        notes: a.notas,
      });
      return `✅ Tarefa atualizada (${TASK_STATUS_LABEL[u.status].toLowerCase()}):\n${taskLine(u, ctx.today)}`;
    },
  }),

  tool({
    name: "remover_tarefa",
    title: "Remover tarefa",
    description: "Exclui uma tarefa e as subtarefas. Exige confirmar: true (sem isso, só mostra o que seria excluído). Para encerrar, prefira concluir_tarefa.",
    schema: z.object({ tarefa: taskArg, confirmar: confirmArg }),
    annotations: { destructiveHint: true },
    async run(a, ctx) {
      const t = await findTask(ctx, a.tarefa);
      if (!a.confirmar) return needsConfirmation(`excluir a tarefa${t.subtasks_total ? ` e ${t.subtasks_total} subtarefas` : ""}:\n${taskLine(t, ctx.today)}`);
      await tasks.deleteTask(ctx, t.id);
      return `🗑️ Tarefa excluída: ${t.title}`;
    },
  }),

  tool({
    name: "criar_projeto",
    title: "Criar projeto",
    description: "Cria um projeto para agrupar tarefas (ex.: uma mudança, uma reforma).",
    schema: z.object({ nome: z.string().min(1), prazo: dateArg.optional(), descricao: z.string().optional() }),
    async run(a, ctx) {
      const p = await tasks.createProject(ctx, { name: a.nome, due_date: a.prazo ? toDate(ctx, a.prazo) : null, description: a.descricao ?? null });
      return `✅ Projeto criado [projeto ${p.id}]: ${p.name}`;
    },
  }),
];
