// Ferramentas MCP de dívidas conectadas: o que você deve a pessoas conectadas e a ligação de um devedor à conta dele.
import { z } from "zod";
import { debtStatus, type Payable } from "../../../shared/connections";
import { formatBRL as brl, toCents } from "../../../shared/money";
import { formatDateBR, monthLabel } from "../../../shared/month";
import type { Ctx } from "../../lib";
import { type Tool, tool } from "../../mcp/tool";
import * as goals from "../../services/goals";
import * as payables from "../../services/payables";
import * as receivables from "../../services/receivables";
import * as connections from "./service";

const sum = (items: { amount_cents: number }[]) => items.reduce((s, i) => s + i.amount_cents, 0);

function payableLine(p: Payable): string {
  const parcel = p.installment_no ? ` (parcela ${p.installment_no}/${p.installment_total}, ${monthLabel(p.month, true)})` : "";
  const st = debtStatus(p);
  const status =
    st === "claimed"
      ? ` ⏳ você marcou como pago em ${formatDateBR(p.paid_claimed_at!)}; falta ${p.creditor_name ?? "a pessoa"} confirmar`
      : st === "disputed"
        ? ` ⚠️ contestado: ${p.dispute_note}`
        : st === "received"
          ? ` ✔ recebido em ${formatDateBR(p.received_at!)}`
          : "";
  return `• [${p.id}] ${p.description}${parcel}: ${brl(p.amount_cents)} (${formatDateBR(p.date)})${status}`;
}

async function creditorId(ctx: Ctx, name: string | undefined): Promise<number | undefined> {
  return name ? (await connections.resolveConnection(ctx, name)).user_id : undefined;
}

export const DEBT_TOOLS: Tool[] = [
  tool({
    name: "listar_minhas_dividas",
    title: "O que eu devo",
    description:
      "Lista o que você deve a pessoas conectadas (gastos que elas passaram no cartão e dividiram com você), por pessoa. " +
      "Mostra o que já está em aberto, as parcelas futuras e se você já marcou como pago. Esses valores contam nos seus gastos do mês.",
    schema: z.object({ pessoa: z.string().optional().describe("Nome da pessoa a quem você deve"), incluir_pagas: z.boolean().optional() }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const all = await payables.listPayables(ctx, { status: a.incluir_pagas ? "all" : "pending", creditor_id: await creditorId(ctx, a.pessoa) });
      if (!all.length) return "Você não deve nada a ninguém. 🎉";
      const byCreditor = new Map<string, typeof all>();
      for (const p of all) byCreditor.set(p.creditor_name ?? `Pessoa ${p.creditor_id}`, [...(byCreditor.get(p.creditor_name ?? `Pessoa ${p.creditor_id}`) ?? []), p]);
      const open = all.filter((p) => p.due && !p.received_at);
      const out = [`Em aberto: ${brl(sum(open))}`];
      for (const [name, items] of byCreditor) {
        const due = items.filter((p) => p.due || p.received_at);
        const future = items.filter((p) => !p.due && !p.received_at);
        out.push("", `${name}: ${brl(sum(due.filter((p) => !p.received_at)))} em aberto`, ...due.map(payableLine));
        if (future.length) out.push(`  Parcelas futuras: ${brl(sum(future))}`, ...future.map(payableLine));
      }
      return out.join("\n");
    },
  }),

  tool({
    name: "marcar_paguei",
    title: "Marcar que paguei",
    description:
      "Marca que você pagou o que devia a uma pessoa conectada (todos os itens já vencidos com ela, ou ids específicos). " +
      "Fica aguardando a confirmação dela. Use desfazer: true para voltar atrás.",
    schema: z.object({
      pessoa: z.string().optional().describe("Nome da pessoa a quem você pagou"),
      ids: z.array(z.number().int()).optional(),
      desfazer: z.boolean().optional(),
    }),
    async run(a, ctx) {
      const done = await payables.markPaid(ctx, { ids: a.ids, creditor_id: await creditorId(ctx, a.pessoa), undo: a.desfazer });
      if (!done.length) return a.desfazer ? "Nada para desfazer." : "Nada em aberto para marcar como pago.";
      const who = done[0].creditor_name ?? "a pessoa";
      return a.desfazer
        ? `↩️ Desfeito: ${done.length} item(ns) voltaram para em aberto.`
        : `✅ Marcado como pago: ${done.length} item(ns), ${brl(sum(done))}. Agora ${who} precisa confirmar.`;
    },
  }),

  tool({
    name: "contestar_divida",
    title: "Contestar dívida",
    description: "Contesta um item que uma pessoa conectada registrou como seu (ex.: valor errado). Ela vê o motivo. Use desfazer: true para retirar.",
    schema: z.object({ id: z.number().int(), motivo: z.string().optional(), desfazer: z.boolean().optional() }),
    async run(a, ctx) {
      if (!a.desfazer && !a.motivo) return "Informe o motivo da contestação.";
      await payables.disputePayable(ctx, a.id, a.desfazer ? null : { note: a.motivo! });
      return a.desfazer ? `Contestação do item ${a.id} retirada.` : `⚠️ Item ${a.id} contestado: ${a.motivo}`;
    },
  }),

  tool({
    name: "ligar_devedor",
    title: "Ligar devedor à conta da pessoa",
    description:
      "Liga um nome dos seus devedores à conta de uma pessoa conectada: o que esse nome te deve (inclusive o histórico) passa a aparecer para ela " +
      "e a contar nos gastos dela. Use desligar: true para desfazer.",
    schema: z.object({
      pessoa: z.string().describe("Nome como aparece nos seus devedores"),
      conta: z.string().optional().describe("Nome da pessoa conectada (padrão: o mesmo nome)"),
      desligar: z.boolean().optional(),
    }),
    async run(a, ctx) {
      const person = await receivables.resolvePerson(ctx, a.pessoa).catch(() => a.pessoa);
      if (a.desligar) {
        await connections.unlinkPerson(ctx, person);
        return `${person} foi desligado(a) da conta. Os valores continuam nos seus devedores.`;
      }
      const target = await connections.resolveConnection(ctx, a.conta ?? person);
      const link = await connections.linkPerson(ctx, { person, user_id: target.user_id });
      return `🔗 ${person} ligado(a) à conta de ${link.linked_name ?? "pessoa conectada"}. O que ${person} te deve aparece agora em "Devo" para essa pessoa.`;
    },
  }),

  tool({
    name: "compartilhar_meta",
    title: "Meta em conjunto",
    description:
      "Compartilha uma meta (caixinha) com pessoas conectadas, para juntarem dinheiro (ex.: viagem de casal). O saldo é de todos; " +
      "cada um tem o próprio aporte mensal, e no resumo de cada um entram só os aportes dele. Use adicionar/remover com nomes (só quem criou a meta), " +
      "meu_aporte_mensal (em reais) para definir o seu aporte, ou sair: true para sair de uma meta de outra pessoa.",
    schema: z.object({
      meta: z.string(),
      adicionar: z.array(z.string()).optional(),
      remover: z.array(z.string()).optional(),
      meu_aporte_mensal: z.number().nonnegative().optional().describe("Seu aporte mensal planejado em reais (0 para nenhum)"),
      sair: z.boolean().optional(),
    }),
    async run(a, ctx) {
      const g = await goals.resolveGoal(ctx, a.meta);
      if (a.sair) {
        await goals.leaveGoal(ctx, g.id);
        return `Você saiu da meta "${g.name}". Seus aportes continuam no saldo dela.`;
      }
      const out: string[] = [];
      if (a.adicionar?.length || a.remover?.length) {
        const ids = async (names?: string[]) => Promise.all((names ?? []).map(async (n) => (await connections.resolveConnection(ctx, n)).user_id));
        const remove = new Set(await ids(a.remover));
        const current = g.members.filter((p) => p.role === "member").map((p) => p.id);
        const updated = await goals.setGoalMembers(ctx, g.id, [...new Set([...current, ...(await ids(a.adicionar))])].filter((id) => !remove.has(id)));
        const names = updated.members.filter((p) => p.role === "member").map((p) => p.name ?? "pessoa");
        out.push(names.length ? `🔗 "${g.name}" em conjunto com: ${names.join(", ")}.` : `"${g.name}" não está compartilhada com ninguém.`);
      }
      if (a.meu_aporte_mensal !== undefined) {
        const updated = await goals.setMyPlan(ctx, g.id, { monthly_cents: a.meu_aporte_mensal ? toCents(a.meu_aporte_mensal) : null });
        out.push(updated.monthly_cents ? `Seu aporte mensal em "${g.name}": ${brl(updated.monthly_cents)}.` : `Sem aporte mensal planejado em "${g.name}".`);
      }
      return out.join("\n") || "Nada para alterar: informe adicionar, remover, meu_aporte_mensal ou sair.";
    },
  }),
];
