// Revisões diária e semanal pelo MCP: só leitura, a partir da mesma composição da tela Hoje.
import { z } from "zod";
import { formatBRL as brl } from "../../../shared/money";
import { monthLabel } from "../../../shared/month";
import { addDays } from "../../../shared/datetime";
import { dateArg, dayLabel, toDate } from "../../mcp/args";
import { type Tool, tool } from "../../mcp/tool";
import { agendaText } from "../agenda/tools";
import { taskLine } from "../tasks/tools";
import { sessionLine, weekStatsText } from "../training/tools";
import { getToday, getWeek } from "./service";

export const TODAY_TOOLS: Tool[] = [
  tool({
    name: "revisao_diaria",
    title: "Revisão do dia",
    description:
      "Resumo do dia para planejar ou revisar: agenda de hoje e de amanhã, tarefas atrasadas, de hoje e prioritárias, treino do dia e situação financeira do mês. Use para \"como está meu dia?\".",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    async run(_a, ctx) {
      const t = await getToday(ctx);
      const f = t.finance;
      const lines = [await agendaText(ctx, ctx.today, addDays(ctx.today, 1)), "", "Tarefas:"];
      const taskList = [...t.tasks.overdue, ...t.tasks.today, ...t.tasks.priority];
      lines.push(...(taskList.length ? taskList.map((x) => taskLine(x, ctx.today)) : ["Nenhuma tarefa atrasada, para hoje ou prioritária."]));
      lines.push("", "Treino de hoje:", ...(t.training.length ? t.training.map((s) => sessionLine(s, ctx.today)) : ["Nenhum treino planejado."]));
      lines.push(
        "",
        `Finanças de ${monthLabel(f.month)}: gastos ${brl(f.total_cents)}` +
          `${f.leftover_cents != null ? ` · sobra prevista ${brl(f.leftover_cents)}` : ""}` +
          `${f.closing_cents != null ? ` · saldo final previsto ${brl(f.closing_cents)}` : ""}` +
          `${f.receivable_pending_cents ? ` · a receber ${brl(f.receivable_pending_cents)}` : ""}`,
      );
      const sp = t.spending;
      lines.push(
        sp.items.length
          ? `Gastos de hoje: ${brl(sp.total_cents)} em ${sp.items.length} lançamento(s)${sp.shared_cents ? ` (+ ${brl(sp.shared_cents)} de outras pessoas, a receber)` : ""}`
          : "Gastos de hoje: nenhum lançado.",
      );
      for (const e of sp.items) lines.push(`• ${e.description}: ${brl(e.amount_cents)}`);
      for (const b of f.budgets_attention) {
        lines.push(`• Orçamento ${b.description}: ${b.remaining_cents < 0 ? `estourou ${brl(-b.remaining_cents)}` : `restam ${brl(b.remaining_cents)}`}`);
      }
      return lines.join("\n");
    },
  }),

  tool({
    name: "revisao_semanal",
    title: "Revisão da semana",
    description:
      "Resumo da semana (segunda a domingo): compromissos, tarefas concluídas, com prazo e atrasadas, treinos planejados × realizados e finanças do mês. Use para revisar a semana ou planejar a próxima.",
    schema: z.object({ data: dateArg.optional().describe("Qualquer dia da semana desejada. Padrão: esta semana") }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const w = await getWeek(ctx, a.data ? toDate(ctx, a.data) : ctx.today);
      const t = await getToday(ctx);
      const f = t.finance;
      const lines = [
        `Semana de ${dayLabel(w.week_start, ctx.today)} a ${dayLabel(w.week_end, ctx.today)}`,
        `Compromissos: ${w.events}`,
        "",
        `Tarefas concluídas na semana: ${w.tasks.done.length}`,
        ...w.tasks.done.map((x) => taskLine(x, ctx.today)),
        `Abertas com prazo na semana: ${w.tasks.due_open.length}`,
        ...w.tasks.due_open.map((x) => taskLine(x, ctx.today)),
        `Atrasadas (prazo antes da semana): ${w.tasks.overdue}`,
        "",
        "Treinos:",
        weekStatsText(w.training),
        "",
        `Finanças de ${monthLabel(f.month)}: gastos ${brl(f.total_cents)}${f.leftover_cents != null ? ` · sobra prevista ${brl(f.leftover_cents)}` : ""}`,
      ];
      return lines.join("\n");
    },
  }),
];
