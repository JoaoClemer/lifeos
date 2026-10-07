import { z } from "zod";
import { formatBRL as brl, toCents } from "../../shared/money";
import { DATE_RE, formatDateBR, monthLabel, MONTH_RE } from "../../shared/month";
import type { Account, Receivable, Recurring } from "../../shared/types";
import { type Ctx, UserError } from "../lib";
import * as accounts from "../services/accounts";
import * as expenses from "../services/expenses";
import * as goals from "../services/goals";
import * as incomes from "../services/incomes";
import * as installments from "../services/installments";
import * as receivables from "../services/receivables";
import * as recurring from "../services/recurring";
import * as summary from "../services/summary";

// ---------- helpers ----------

const amountArg = (desc: string) => z.number().positive().describe(desc);
const monthArg = z.string().regex(MONTH_RE).describe("Mês no formato YYYY-MM. Padrão: mês atual.");
const dateArg = z.string().regex(DATE_RE).describe("Data no formato YYYY-MM-DD. Padrão: hoje.");
const accountArg = z
  .string()
  .describe('Nome do cartão/conta como cadastrado (ex.: "Nubank", "Inter", "Pix", "VR"). Se omitido, usa a conta padrão.');

async function accountFromName(ctx: Ctx, name: string | undefined, useDefault = true): Promise<Account | null> {
  if (name) return accounts.resolveAccount(ctx, name);
  if (!useDefault) return null;
  const s = await summary.getSettings(ctx);
  return s.default_account_id ? accounts.getAccount(ctx, s.default_account_id).catch(() => null) : null;
}

const accountLabel = (a: Account | null) => (a ? a.name : "sem conta definida");

function budgetLine(b: Recurring): string {
  const rest = b.month_amount_cents - b.spent_cents;
  return `${b.description}: gasto ${brl(b.spent_cents)} de ${brl(b.month_amount_cents)} — ${
    rest >= 0 ? `restam ${brl(rest)}` : `estourou ${brl(-rest)}`
  }`;
}

/** " (parcela 3/10, nov/26)" para devedores parcelados; vazio para à vista. */
function parcelLabel(r: Receivable): string {
  return r.installment_no ? ` (parcela ${r.installment_no}/${r.installment_total}, ${monthLabel(r.month, true)})` : "";
}

async function accountNames(ctx: Ctx): Promise<Map<number, string>> {
  return new Map((await accounts.listAccounts(ctx, true)).map((a) => [a.id, a.name]));
}

// ---------- definição das ferramentas ----------

interface Tool<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean };
  run: (args: z.output<S>, ctx: Ctx) => Promise<string>;
}
const tool = <S extends z.ZodObject>(t: Tool<S>) => t as unknown as Tool<z.ZodObject>;

export const TOOLS: Tool<z.ZodObject>[] = [
  tool({
    name: "resumo_mes",
    title: "Resumo do mês",
    description:
      "Mostra o resumo financeiro de um mês: total de gastos (parcelados, fixos, avulsos), fatura por cartão, orçamentos (quanto gastou e quanto falta), devedores pendentes e aportes das metas.",
    schema: z.object({ mes: monthArg.optional() }),
    annotations: { readOnlyHint: true },
    async run({ mes }, ctx) {
      const m = mes ?? ctx.month;
      const s = await summary.getSummary(ctx, m);
      const t = s.totals;
      const lines = [
        `Resumo de ${monthLabel(m)} (hoje: ${formatDateBR(s.today)})`,
        `Total de gastos do mês: ${brl(t.total_cents)}`,
        `• Parcelados: ${brl(t.installments_cents)}`,
        `• Fixos (inclui orçamentos): ${brl(t.recurring_cents)}${t.budget_overflow_cents ? ` — orçamentos estourados em ${brl(t.budget_overflow_cents)}` : ""}`,
        `• Avulsos: ${brl(t.one_off_cents)}`,
      ];
      if (t.income_cents != null) {
        const breakdown = t.income_extra_cents
          ? ` (salário ${brl(t.income_base_cents ?? 0)} + entradas extras ${brl(t.income_extra_cents)})`
          : "";
        lines.push(`Renda: ${brl(t.income_cents)}${breakdown} → sobra prevista: ${brl(t.leftover_cents!)}`);
      }
      if (s.by_account.length) {
        lines.push("", "Por cartão/conta (o que cai em cada um, incluindo a parte de devedores):");
        for (const a of s.by_account) lines.push(`• ${a.name}${a.due_day ? ` (vence dia ${a.due_day})` : ""}: ${brl(a.total_cents)}`);
      }
      if (s.budgets.length) {
        lines.push("", "Orçamentos (fixos a descontar):");
        for (const b of s.budgets)
          lines.push(
            `• ${b.description}: gasto ${brl(b.spent_cents)} de ${brl(b.limit_cents)} — ${
              b.remaining_cents >= 0 ? `restam ${brl(b.remaining_cents)}` : `estourou ${brl(-b.remaining_cents)}`
            }`,
          );
      }
      lines.push("", `A receber (pendente, todos os meses): ${brl(t.receivable_pending_cents)}`);
      for (const p of s.pending_by_person) lines.push(`• ${p.person}: ${brl(p.total_cents)} (${p.count} itens)`);
      if (t.receivable_future_cents) lines.push(`Parcelas futuras de devedores parcelados (ainda não venceram): ${brl(t.receivable_future_cents)}`);
      if (t.goals_planned_cents || t.goals_done_cents)
        lines.push("", `Aportes em metas no mês: ${brl(t.goals_done_cents)} feitos de ${brl(t.goals_planned_cents)} planejados`);
      return lines.join("\n");
    },
  }),

  tool({
    name: "listar_cadastros",
    title: "Cartões, orçamentos, metas e pessoas",
    description:
      "Lista a data de hoje, os cartões/contas cadastrados (com dia de fechamento e vencimento), os fixos e orçamentos ativos, as metas e as pessoas que já te deveram. Use para descobrir os nomes certos antes de lançar.",
    schema: z.object({}),
    annotations: { readOnlyHint: true },
    async run(_args, ctx) {
      const [accs, rec, gs, people, settings] = await Promise.all([
        accounts.listAccounts(ctx),
        recurring.listRecurring(ctx, ctx.month),
        goals.listGoals(ctx, ctx.month),
        receivables.listPeople(ctx),
        summary.getSettings(ctx),
      ]);
      const lines = [`Hoje: ${formatDateBR(ctx.today)} (mês atual ${ctx.month})`, "", "Cartões/contas:"];
      for (const a of accs)
        lines.push(
          `• [${a.id}] ${a.name} (${a.type}${a.closing_day ? `, fecha dia ${a.closing_day}` : ""}${a.due_day ? `, vence dia ${a.due_day}` : ""})${
            settings.default_account_id === a.id ? " ← padrão" : ""
          }`,
        );
      if (!accs.length) lines.push("(nenhuma — use cadastrar_conta)");
      lines.push("", "Orçamentos ativos (lance gastos neles com o parâmetro orcamento):");
      for (const b of rec.filter((r) => r.is_budget)) lines.push(`• [${b.id}] ${budgetLine(b)}`);
      lines.push("", "Fixos ativos:");
      for (const r of rec.filter((r) => !r.is_budget)) lines.push(`• [${r.id}] ${r.description}: ${brl(r.month_amount_cents)}`);
      lines.push("", "Metas/investimentos:");
      for (const g of gs) lines.push(`• [${g.id}] ${g.name}: saldo ${brl(g.balance_cents)}${g.target_cents ? ` de ${brl(g.target_cents)}` : ""}`);
      lines.push("", `Pessoas: ${people.join(", ") || "(nenhuma)"}`);
      return lines.join("\n");
    },
  }),

  tool({
    name: "lancar_despesa",
    title: "Lançar despesa",
    description:
      "Lança um gasto avulso (à vista) no mês. O mês da fatura é calculado pelo dia de fechamento do cartão. " +
      "Se o gasto for de um orçamento (ex.: almoço, transporte), informe `orcamento` para descontar dele. " +
      "Se dividiu a conta com alguém, use `dividir_com`: a parte dos outros vira devedor e só a sua parte conta como seu gasto.",
    schema: z.object({
      descricao: z.string().min(1).describe("O que foi comprado, ex.: Mercado, Almoço, Uber"),
      valor: amountArg("Valor TOTAL pago, em reais (ex.: 32.5)"),
      conta: accountArg.optional(),
      data: dateArg.optional(),
      orcamento: z.string().optional().describe('Nome do orçamento a descontar (ex.: "Alimentação", "Transporte")'),
      dividir_com: z
        .array(
          z.object({
            pessoa: z.string().min(1),
            valor: z.number().positive().optional().describe("Parte da pessoa em reais. Se omitido, divide igualmente entre você e as pessoas sem valor."),
          }),
        )
        .optional()
        .describe("Pessoas que vão te pagar uma parte deste gasto"),
      mes_referencia: monthArg.optional().describe("Força o mês de referência (YYYY-MM). Normalmente não é necessário."),
      observacao: z.string().optional(),
    }),
    async run(a, ctx) {
      const account = await accountFromName(ctx, a.conta);
      const budget = a.orcamento ? await recurring.resolveRecurring(ctx, a.orcamento, { budgetOnly: true }) : null;
      const total = toCents(a.valor);
      const splits = splitAmounts(total, a.dividir_com ?? []);
      const res = await expenses.createExpense(ctx, {
        description: a.descricao,
        amount_cents: total,
        date: a.data,
        month: a.mes_referencia,
        account_id: account?.id ?? null,
        budget_id: budget?.id ?? null,
        notes: a.observacao ?? null,
        splits,
      });
      const lines = [
        `✅ Lançado: ${a.descricao} — ${brl(total)} em ${accountLabel(account)} (mês/fatura: ${monthLabel(res.month)})${
          res.expense ? ` [avulso id ${res.expense.id}]` : ""
        }`,
      ];
      if (splits.length) {
        lines.push(`Sua parte: ${brl(res.my_share_cents)}`);
        splits.forEach((s, i) => lines.push(`${s.person} te deve ${brl(s.amount_cents)} [devedor id ${res.receivable_ids[i]}]`));
      }
      if (budget) lines.push(`Orçamento ${budgetLine(await recurring.getRecurring(ctx, budget.id, res.month))}`);
      if (!account) lines.push("Obs.: sem conta definida. Cadastre uma conta padrão nas configurações ou informe `conta`.");
      return lines.join("\n");
    },
  }),

  tool({
    name: "lancar_parcelado",
    title: "Lançar compra parcelada",
    description:
      "Cadastra uma compra parcelada. Informe o valor da parcela OU o valor total. " +
      "Para algo que você já está pagando, informe `parcela_atual` (ex.: está na 3ª de 10 este mês).",
    schema: z.object({
      descricao: z.string().min(1),
      parcelas: z.number().int().min(1).max(120).describe("Número total de parcelas"),
      valor_parcela: z.number().positive().optional().describe("Valor de cada parcela em reais"),
      valor_total: z.number().positive().optional().describe("Valor total da compra em reais"),
      conta: accountArg.optional(),
      data_compra: dateArg.optional(),
      parcela_atual: z.number().int().min(1).optional().describe("Qual parcela cai no mês atual, para compras já em andamento"),
    }),
    async run(a, ctx) {
      if (!a.valor_parcela && !a.valor_total) throw new UserError("Informe valor_parcela ou valor_total");
      const account = await accountFromName(ctx, a.conta);
      const i = await installments.createInstallment(ctx, {
        description: a.descricao,
        total_installments: a.parcelas,
        installment_cents: a.valor_parcela ? toCents(a.valor_parcela) : undefined,
        total_cents: a.valor_total ? toCents(a.valor_total) : undefined,
        account_id: account?.id ?? null,
        purchase_date: a.data_compra,
        current_installment: a.parcela_atual,
      });
      return `✅ Parcelado cadastrado [id ${i.id}]: ${i.description} — ${i.total_installments}x de ${brl(i.installment_cents)} em ${accountLabel(
        account,
      )}, de ${monthLabel(i.first_month)} até ${monthLabel(i.last_month)}. Neste mês: parcela ${i.current}/${i.total_installments}.`;
    },
  }),

  tool({
    name: "adicionar_fixo",
    title: "Adicionar gasto fixo mensal",
    description:
      "Cadastra um gasto que se repete todo mês (assinatura, conta, etc.). " +
      "Use `orcamento: true` para um valor reservado do qual você vai descontando gastos ao longo do mês (ex.: R$ 500 de almoço).",
    schema: z.object({
      descricao: z.string().min(1),
      valor: z.number().nonnegative().describe("Valor mensal em reais"),
      conta: accountArg.optional().describe("Cartão/conta onde é cobrado (não se aplica a orçamentos)"),
      dia: z.number().int().min(1).max(31).optional().describe("Dia de cobrança/vencimento"),
      orcamento: z.boolean().optional(),
      mes_inicio: monthArg.optional(),
    }),
    async run(a, ctx) {
      const account = a.orcamento ? null : await accountFromName(ctx, a.conta);
      const r = await recurring.createRecurring(ctx, {
        description: a.descricao,
        amount_cents: toCents(a.valor),
        account_id: account?.id ?? null,
        is_budget: a.orcamento ?? false,
        day: a.dia ?? null,
        start_month: a.mes_inicio,
      });
      return `✅ ${r.is_budget ? "Orçamento" : "Fixo"} cadastrado [id ${r.id}]: ${r.description} — ${brl(r.amount_cents)}/mês${
        r.is_budget ? "" : ` em ${accountLabel(account)}`
      }, a partir de ${monthLabel(r.start_month)}.`;
    },
  }),

  tool({
    name: "ajustar_fixo",
    title: "Ajustar gasto fixo",
    description:
      "Ajusta um fixo/orçamento: valor só em um mês (ex.: a conta de luz deste mês veio R$ 210), marcar como pago, " +
      "mudar o valor padrão ou encerrar (cancelar assinatura).",
    schema: z.object({
      fixo: z.string().describe("Nome ou id do fixo"),
      mes: monthArg.optional(),
      valor_no_mes: z.number().nonnegative().optional().describe("Valor apenas no mês informado"),
      pago: z.boolean().optional().describe("Marca/desmarca como pago no mês"),
      novo_valor_padrao: z.number().nonnegative().optional().describe("Novo valor para todos os meses"),
      encerrar_apos: monthArg.optional().describe("Último mês em que o fixo existe (YYYY-MM)"),
    }),
    async run(a, ctx) {
      const m = a.mes ?? ctx.month;
      const r = /^\d+$/.test(a.fixo) ? await recurring.getRecurring(ctx, Number(a.fixo), m) : await recurring.resolveRecurring(ctx, a.fixo, { month: m });
      const out: string[] = [];
      if (a.novo_valor_padrao !== undefined || a.encerrar_apos !== undefined) {
        await recurring.updateRecurring(ctx, r.id, {
          amount_cents: a.novo_valor_padrao !== undefined ? toCents(a.novo_valor_padrao) : undefined,
          end_month: a.encerrar_apos,
        });
        if (a.novo_valor_padrao !== undefined) out.push(`valor padrão agora é ${brl(toCents(a.novo_valor_padrao))}`);
        if (a.encerrar_apos) out.push(`encerrado após ${monthLabel(a.encerrar_apos)}`);
      }
      if (a.valor_no_mes !== undefined || a.pago !== undefined) {
        const upd = await recurring.setRecurringMonth(ctx, r.id, m, {
          amount_cents: a.valor_no_mes !== undefined ? toCents(a.valor_no_mes) : undefined,
          paid: a.pago,
        });
        if (a.valor_no_mes !== undefined) out.push(`em ${monthLabel(m)} fica ${brl(upd.month_amount_cents)}`);
        if (a.pago !== undefined) out.push(a.pago ? `marcado como pago em ${monthLabel(m)}` : `desmarcado como pago em ${monthLabel(m)}`);
      }
      if (!out.length) throw new UserError("Nada para ajustar: informe valor_no_mes, pago, novo_valor_padrao ou encerrar_apos");
      return `✅ ${r.description} [id ${r.id}]: ${out.join("; ")}.`;
    },
  }),

  tool({
    name: "registrar_devedor",
    title: "Registrar devedor",
    description:
      "Registra que alguém te deve (ex.: você passou algo no seu cartão para a pessoa). " +
      "Se foi no cartão, informe `conta` para o valor entrar na fatura. Para dividir um gasto seu, prefira lancar_despesa com dividir_com. " +
      "Se a compra da pessoa foi parcelada no seu cartão, informe `parcelas` (e `valor` da parcela ou `valor_total`): cada parcela entra na fatura do seu mês.",
    schema: z.object({
      pessoa: z.string().min(1),
      descricao: z.string().min(1),
      valor: z.number().positive().optional().describe("Valor que a pessoa te deve, em reais (se parcelado: valor de cada parcela)"),
      valor_total: z.number().positive().optional().describe("Só para parcelado: valor total da compra, em reais"),
      parcelas: z.number().int().min(1).max(120).optional().describe("Número de parcelas, se foi parcelado no cartão"),
      parcela_atual: z.number().int().min(1).optional().describe("Para parcelamento já em andamento: qual parcela cai no mês atual"),
      conta: z.string().optional().describe("Cartão/conta em que foi cobrado (se aplicável)"),
      data: dateArg.optional(),
    }),
    async run(a, ctx) {
      if (!a.valor && !a.valor_total) throw new UserError("Informe valor ou valor_total");
      const account = await accountFromName(ctx, a.conta, false);
      const rows = await receivables.createReceivable(ctx, {
        person: a.pessoa,
        description: a.descricao,
        amount_cents: a.valor ? toCents(a.valor) : undefined,
        total_cents: a.valor_total && !a.valor ? toCents(a.valor_total) : undefined,
        installments: a.parcelas,
        current_installment: a.parcela_atual,
        date: a.data,
        account_id: account?.id ?? null,
      });
      const r = rows[0];
      const pending = (await receivables.listReceivables(ctx, { person: r.person })).filter((x) => receivables.isDue(x, ctx.month));
      const head =
        rows.length > 1 || r.installment_total
          ? `✅ ${r.person} te deve ${r.description} parcelado: ${rows.length}x (${rows
              .map((x) => brl(x.amount_cents))
              .filter((v, i, all) => all.indexOf(v) === i)
              .join(" / ")}), parcelas ${r.installment_no}/${r.installment_total} a ${rows.at(-1)!.installment_no}/${r.installment_total}, de ${monthLabel(
              r.month,
            )} até ${monthLabel(rows.at(-1)!.month)}${account ? ` no ${account.name}` : ""} [devedor ids ${rows.map((x) => x.id).join(", ")}]`
          : `✅ ${r.person} te deve ${brl(r.amount_cents)} (${r.description}) [devedor id ${r.id}]${
              account ? `, no ${account.name} (fatura de ${monthLabel(r.month)})` : ""
            }`;
      return `${head}. Total pendente de ${r.person} até agora: ${brl(pending.reduce((s, x) => s + x.amount_cents, 0))}.`;
    },
  }),

  tool({
    name: "marcar_recebido",
    title: "Marcar dívida como recebida",
    description:
      "Marca como recebido(s): por ids específicos ou tudo que está pendente de uma pessoa. Use `desfazer` para reverter. " +
      "Por pessoa, parcelas futuras de devedores parcelados não são marcadas, a menos que `incluir_parcelas_futuras` (ex.: a pessoa quitou tudo adiantado).",
    schema: z.object({
      pessoa: z.string().optional(),
      ids: z.array(z.number().int()).optional(),
      data: dateArg.optional(),
      desfazer: z.boolean().optional(),
      incluir_parcelas_futuras: z.boolean().optional(),
    }),
    async run(a, ctx) {
      const done = await receivables.markReceived(ctx, {
        ids: a.ids,
        person: a.pessoa,
        date: a.data,
        undo: a.desfazer,
        include_future: a.incluir_parcelas_futuras,
      });
      if (!done.length) return "Nada pendente encontrado.";
      const total = done.reduce((s, r) => s + r.amount_cents, 0);
      return `✅ ${a.desfazer ? "Voltaram a ficar pendentes" : "Recebido"}: ${done.length} item(ns), total ${brl(total)}:\n${done
        .map((r) => `• [${r.id}] ${r.person} — ${r.description}${parcelLabel(r)}: ${brl(r.amount_cents)}`)
        .join("\n")}`;
    },
  }),

  tool({
    name: "listar_devedores",
    title: "Listar devedores",
    description: "Lista quem te deve e quanto (pendentes por padrão). Parcelas futuras de devedores parcelados aparecem separadas.",
    schema: z.object({ pessoa: z.string().optional(), incluir_recebidos: z.boolean().optional() }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const person = a.pessoa ? await receivables.resolvePerson(ctx, a.pessoa) : undefined;
      const all = await receivables.listReceivables(ctx, { status: a.incluir_recebidos ? "all" : "pending", person });
      // Parcelas que ainda não venceram ficam numa seção à parte
      const future = all.filter((r) => !r.received_at && !receivables.isDue(r, ctx.month));
      const rows = all.filter((r) => !future.includes(r));
      if (!rows.length && !future.length) return "Ninguém te deve nada (pendente). 🎉";
      const names = await accountNames(ctx);
      const pending = rows.filter((r) => !r.received_at).reduce((s, r) => s + r.amount_cents, 0);
      const line = (r: Receivable) =>
        `• [${r.id}] ${r.person} — ${r.description}${parcelLabel(r)}: ${brl(r.amount_cents)} (${formatDateBR(r.date)}${
          r.account_id ? `, ${names.get(r.account_id)}` : ""
        })${r.received_at ? ` ✔ recebido em ${formatDateBR(r.received_at)}` : ""}`;
      const out = [`Total pendente: ${brl(pending)}`, ...rows.map(line)];
      if (future.length) {
        out.push(
          "",
          `Parcelas futuras (ainda não venceram): ${brl(future.reduce((s, r) => s + r.amount_cents, 0))}`,
          ...future.sort((x, y) => x.month.localeCompare(y.month) || x.id - y.id).map(line),
        );
      }
      return out.join("\n");
    },
  }),

  tool({
    name: "registrar_entrada",
    title: "Registrar entrada de dinheiro",
    description:
      "Registra uma entrada extra de dinheiro no mês, além do salário fixo: 13º salário, bônus, PLR, férias, freela, reembolso, venda etc. " +
      "Ela soma na renda do mês e na sobra prevista. (O salário fixo mensal é configurado em Ajustes no app.)",
    schema: z.object({
      descricao: z.string().min(1).describe("Ex.: 13º salário, Bônus, PLR, Freela"),
      valor: amountArg("Valor recebido, em reais"),
      data: dateArg.optional(),
      mes: monthArg.optional().describe("Mês em que a entrada conta (YYYY-MM). Padrão: mês da data."),
      observacao: z.string().optional(),
    }),
    async run(a, ctx) {
      const i = await incomes.createIncome(ctx, {
        description: a.descricao,
        amount_cents: toCents(a.valor),
        date: a.data,
        month: a.mes,
        notes: a.observacao ?? null,
      });
      const t = (await summary.getSummary(ctx, i.month)).totals;
      return `✅ Entrada registrada [id ${i.id}]: ${i.description} — ${brl(i.amount_cents)} em ${monthLabel(i.month)}. Renda do mês: ${brl(
        t.income_cents ?? 0,
      )}${t.leftover_cents != null ? `; sobra prevista: ${brl(t.leftover_cents)}` : ""}.`;
    },
  }),

  tool({
    name: "listar_lancamentos",
    title: "Listar lançamentos",
    description: "Lista os lançamentos de um mês: avulsos, parcelados, fixos e/ou entradas extras, com ids (para editar ou remover).",
    schema: z.object({
      mes: monthArg.optional(),
      tipo: z.enum(["todos", "avulsos", "parcelados", "fixos", "entradas"]).optional(),
      conta: z.string().optional().describe("Filtra avulsos por cartão/conta"),
      orcamento: z.string().optional().describe("Filtra avulsos de um orçamento"),
      busca: z.string().optional().describe("Texto na descrição (avulsos)"),
    }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const m = a.mes ?? ctx.month;
      const tipo = a.tipo ?? "todos";
      const names = await accountNames(ctx);
      const acc = (id: number | null) => (id ? names.get(id) : "sem conta");
      const out: string[] = [`Lançamentos de ${monthLabel(m)}:`];
      if (tipo === "todos" || tipo === "parcelados") {
        const list = await installments.listInstallments(ctx, m);
        out.push("", `Parcelados (${brl(list.reduce((s, i) => s + i.installment_cents, 0))}):`);
        for (const i of list)
          out.push(`• [${i.id}] ${i.description}: ${brl(i.installment_cents)} — ${i.current}/${i.total_installments} (${acc(i.account_id)})`);
      }
      if (tipo === "todos" || tipo === "fixos") {
        const list = await recurring.listRecurring(ctx, m);
        out.push("", "Fixos:");
        for (const r of list)
          out.push(
            `• [${r.id}] ${r.description}: ${brl(r.month_amount_cents)}${r.is_budget ? ` (orçamento; gasto ${brl(r.spent_cents)})` : ` (${acc(r.account_id)})`}${
              r.paid ? " ✔ pago" : ""
            }`,
          );
      }
      if (tipo === "todos" || tipo === "avulsos") {
        const account = a.conta ? await accounts.resolveAccount(ctx, a.conta) : null;
        const budget = a.orcamento ? await recurring.resolveRecurring(ctx, a.orcamento, { budgetOnly: true, month: m }) : null;
        const list = await expenses.listExpenses(ctx, { month: m, account_id: account?.id, budget_id: budget?.id, search: a.busca });
        const budgets = new Map((await recurring.listRecurring(ctx, m, true)).map((r) => [r.id, r.description]));
        out.push("", `Avulsos (${brl(list.reduce((s, e) => s + e.amount_cents, 0))}):`);
        for (const e of list)
          out.push(
            `• [${e.id}] ${formatDateBR(e.date)} ${e.description}: ${brl(e.amount_cents)} (${acc(e.account_id)})${
              e.budget_id ? ` [orçamento ${budgets.get(e.budget_id)}]` : ""
            }${e.shared_cents ? ` +${brl(e.shared_cents)} de outros` : ""}`,
          );
      }
      if (tipo === "todos" || tipo === "entradas") {
        const list = await incomes.listIncomes(ctx, m);
        // Em "todos", a seção só aparece se houver entradas no mês
        if (list.length || tipo === "entradas") {
          out.push("", `Entradas extras (${brl(list.reduce((s, i) => s + i.amount_cents, 0))}):`);
          for (const i of list) out.push(`• [${i.id}] ${formatDateBR(i.date)} ${i.description}: ${brl(i.amount_cents)}`);
        }
      }
      return out.join("\n");
    },
  }),

  tool({
    name: "editar_lancamento",
    title: "Editar lançamento",
    description: "Edita um lançamento existente pelo id (veja os ids com listar_lancamentos / listar_devedores).",
    schema: z.object({
      tipo: z.enum(["avulso", "parcelado", "fixo", "devedor", "entrada"]),
      id: z.number().int(),
      descricao: z.string().optional(),
      valor: z.number().positive().optional().describe("Novo valor em reais (para parcelado: valor da parcela; para fixo: valor padrão)"),
      conta: z.string().optional(),
      data: dateArg.optional(),
      orcamento: z.string().optional().describe('Só avulso: nome do orçamento, ou "nenhum" para desvincular'),
      mes_referencia: monthArg.optional(),
      pessoa: z.string().optional().describe("Só devedor"),
    }),
    async run(a, ctx) {
      const account_id = a.conta ? (await accounts.resolveAccount(ctx, a.conta)).id : undefined;
      const cents = a.valor !== undefined ? toCents(a.valor) : undefined;
      switch (a.tipo) {
        case "avulso": {
          let budget_id: number | null | undefined;
          if (a.orcamento) budget_id = /^nenhum/i.test(a.orcamento) ? null : (await recurring.resolveRecurring(ctx, a.orcamento, { budgetOnly: true })).id;
          const e = await expenses.updateExpense(ctx, a.id, {
            description: a.descricao,
            amount_cents: cents,
            account_id,
            date: a.data,
            month: a.mes_referencia,
            budget_id,
          });
          return `✅ Avulso [${e.id}] atualizado: ${e.description} — ${brl(e.amount_cents)} em ${formatDateBR(e.date)} (mês ${monthLabel(e.month)}).`;
        }
        case "parcelado": {
          const i = await installments.updateInstallment(ctx, a.id, { description: a.descricao, installment_cents: cents, account_id });
          return `✅ Parcelado [${i.id}] atualizado: ${i.description} — ${i.total_installments}x ${brl(i.installment_cents)}.`;
        }
        case "fixo": {
          const r = await recurring.updateRecurring(ctx, a.id, { description: a.descricao, amount_cents: cents, account_id });
          return `✅ Fixo [${r.id}] atualizado: ${r.description} — ${brl(r.amount_cents)}/mês.`;
        }
        case "devedor": {
          const r = await receivables.updateReceivable(ctx, a.id, {
            description: a.descricao,
            amount_cents: cents,
            account_id,
            date: a.data,
            month: a.mes_referencia,
            person: a.pessoa,
          });
          return `✅ Devedor [${r.id}] atualizado: ${r.person} — ${r.description}: ${brl(r.amount_cents)}.`;
        }
        case "entrada": {
          const i = await incomes.updateIncome(ctx, a.id, { description: a.descricao, amount_cents: cents, date: a.data, month: a.mes_referencia });
          return `✅ Entrada [${i.id}] atualizada: ${i.description} — ${brl(i.amount_cents)} em ${monthLabel(i.month)}.`;
        }
      }
    },
  }),

  tool({
    name: "remover_lancamento",
    title: "Remover lançamento",
    description:
      "Remove definitivamente um lançamento pelo id. Para fixos/assinaturas, prefira ajustar_fixo com encerrar_apos (mantém o histórico). " +
      "Para devedor parcelado, `todas_parcelas` remove todas as parcelas ainda não recebidas. Confirme com o usuário antes.",
    schema: z.object({
      tipo: z.enum(["avulso", "parcelado", "fixo", "devedor", "entrada", "meta", "movimentacao_meta"]),
      id: z.number().int(),
      todas_parcelas: z.boolean().optional().describe("Só devedor parcelado: remove todas as parcelas pendentes do parcelamento"),
    }),
    annotations: { destructiveHint: true },
    async run({ tipo, id, todas_parcelas }, ctx) {
      switch (tipo) {
        case "avulso": {
          const e = await expenses.deleteExpense(ctx, id);
          return `🗑️ Avulso removido: ${e.description} (${brl(e.amount_cents)}).${e.shared_cents ? " Devedores pendentes ligados a ele também foram removidos." : ""}`;
        }
        case "parcelado": {
          const i = await installments.deleteInstallment(ctx, id);
          return `🗑️ Parcelado removido: ${i.description}.`;
        }
        case "fixo": {
          const r = await recurring.deleteRecurring(ctx, id);
          return `🗑️ Fixo removido: ${r.description}.`;
        }
        case "devedor": {
          if (todas_parcelas) {
            const { deleted } = await receivables.deleteReceivableGroup(ctx, id);
            const first = deleted[0];
            return first
              ? `🗑️ ${deleted.length} parcela(s) pendente(s) removida(s): ${first.person} — ${first.description} (${brl(deleted.reduce((s, r) => s + r.amount_cents, 0))}).`
              : "Nenhuma parcela pendente para remover.";
          }
          const r = await receivables.deleteReceivable(ctx, id);
          return `🗑️ Devedor removido: ${r.person} — ${r.description}${parcelLabel(r)}.`;
        }
        case "entrada": {
          const i = await incomes.deleteIncome(ctx, id);
          return `🗑️ Entrada removida: ${i.description} (${brl(i.amount_cents)}).`;
        }
        case "meta": {
          const g = await goals.deleteGoal(ctx, id);
          return `🗑️ Meta removida: ${g.name}.`;
        }
        case "movimentacao_meta":
          await goals.deleteGoalEntry(ctx, id);
          return `🗑️ Movimentação ${id} removida.`;
      }
    },
  }),

  tool({
    name: "listar_metas",
    title: "Listar metas e investimentos",
    description: "Lista metas/investimentos com saldo, alvo, aporte mensal, se o aporte do mês foi feito e a previsão para atingir a meta.",
    schema: z.object({ mes: monthArg.optional() }),
    annotations: { readOnlyHint: true },
    async run(a, ctx) {
      const m = a.mes ?? ctx.month;
      const list = await goals.listGoals(ctx, m);
      if (!list.length) return "Nenhuma meta cadastrada. Use criar_meta.";
      const total = list.reduce((s, g) => s + g.balance_cents, 0);
      return [
        `Total guardado/investido: ${brl(total)}`,
        ...list.map((g) => {
          const parts = [`• [${g.id}] ${g.name}${g.institution ? ` (${g.institution})` : ""}: ${brl(g.balance_cents)}`];
          if (g.target_cents) parts.push(`de ${brl(g.target_cents)} (${Math.floor((g.balance_cents / g.target_cents) * 100)}%)`);
          if (g.month_planned_cents)
            parts.push(
              `— aporte de ${monthLabel(m)}: ${g.month_contrib_cents >= g.month_planned_cents ? "✔ feito" : `${brl(g.month_contrib_cents)} de ${brl(g.month_planned_cents)}`}`,
            );
          if (g.eta_month) parts.push(`— previsão: ${monthLabel(g.eta_month)}`);
          if (g.required_monthly_cents) parts.push(`— para o prazo (${monthLabel(g.deadline!)}) precisa de ${brl(g.required_monthly_cents)}/mês`);
          return parts.join(" ");
        }),
      ].join("\n");
    },
  }),

  tool({
    name: "criar_meta",
    title: "Criar meta ou investimento",
    description: "Cria uma meta/caixinha de investimento, com o valor que você já tem, o alvo (opcional), o aporte mensal planejado e o prazo.",
    schema: z.object({
      nome: z.string().min(1),
      onde: z.string().optional().describe("Onde está investido, ex.: Tesouro Selic, CDB Nubank"),
      valor_atual: z.number().nonnegative().optional(),
      valor_alvo: z.number().positive().optional(),
      aporte_mensal: z.number().positive().optional(),
      prazo: monthArg.optional().describe("Mês limite para atingir a meta (YYYY-MM)"),
    }),
    async run(a, ctx) {
      const g = await goals.createGoal(ctx, {
        name: a.nome,
        institution: a.onde ?? null,
        initial_cents: a.valor_atual ? toCents(a.valor_atual) : undefined,
        target_cents: a.valor_alvo ? toCents(a.valor_alvo) : null,
        monthly_cents: a.aporte_mensal ? toCents(a.aporte_mensal) : null,
        deadline: a.prazo ?? null,
      });
      return `✅ Meta criada [id ${g.id}]: ${g.name} — saldo ${brl(g.balance_cents)}${g.target_cents ? `, alvo ${brl(g.target_cents)}` : ""}${
        g.monthly_cents ? `, aporte ${brl(g.monthly_cents)}/mês` : ""
      }${g.eta_month ? `. Previsão: ${monthLabel(g.eta_month)}` : ""}.`;
    },
  }),

  tool({
    name: "registrar_aporte",
    title: "Registrar aporte ou resgate",
    description:
      "Registra um aporte (ou resgate) em uma meta e dá o check do mês. Sem `valor`, lança o que falta do aporte mensal planejado.",
    schema: z.object({
      meta: z.string().describe("Nome ou id da meta"),
      valor: z.number().positive().optional(),
      tipo: z.enum(["aporte", "resgate"]).optional(),
      mes: monthArg.optional(),
      observacao: z.string().optional(),
    }),
    async run(a, ctx) {
      const g0 = /^\d+$/.test(a.meta) ? await goals.getGoal(ctx, Number(a.meta)) : await goals.resolveGoal(ctx, a.meta);
      const m = a.mes ?? ctx.month;
      let g;
      if (a.tipo === "resgate") {
        if (!a.valor) throw new UserError("Informe o valor do resgate");
        await goals.addGoalEntry(ctx, g0.id, { kind: "withdrawal", amount_cents: toCents(a.valor), month: m, note: a.observacao });
        g = await goals.getGoal(ctx, g0.id, m);
      } else if (a.valor) {
        await goals.addGoalEntry(ctx, g0.id, { kind: "contribution", amount_cents: toCents(a.valor), month: m, note: a.observacao });
        g = await goals.getGoal(ctx, g0.id, m);
      } else {
        g = await goals.checkGoalMonth(ctx, g0.id, m);
      }
      return `✅ ${a.tipo === "resgate" ? "Resgate" : "Aporte"} registrado em ${g.name}. Saldo: ${brl(g.balance_cents)}${
        g.target_cents ? ` de ${brl(g.target_cents)}` : ""
      }. Aportes em ${monthLabel(m)}: ${brl(g.month_contrib_cents)}${g.month_planned_cents ? ` de ${brl(g.month_planned_cents)} planejados` : ""}.`;
    },
  }),

  tool({
    name: "atualizar_saldo_meta",
    title: "Atualizar saldo de investimento",
    description: "Informa o saldo atual de uma meta/investimento (ex.: com rendimentos). A diferença é registrada como ajuste.",
    schema: z.object({ meta: z.string(), saldo_atual: z.number().nonnegative() }),
    async run(a, ctx) {
      const g0 = /^\d+$/.test(a.meta) ? await goals.getGoal(ctx, Number(a.meta)) : await goals.resolveGoal(ctx, a.meta);
      const g = await goals.setGoalBalance(ctx, g0.id, toCents(a.saldo_atual));
      const diff = g.balance_cents - g0.balance_cents;
      return `✅ ${g.name}: saldo atualizado para ${brl(g.balance_cents)} (${diff >= 0 ? "+" : ""}${brl(diff)}).`;
    },
  }),

  tool({
    name: "cadastrar_conta",
    title: "Cadastrar cartão/conta",
    description: "Cadastra um cartão de crédito ou outra forma de pagamento (Pix, débito, VR...). Para cartão, informe dia de fechamento e vencimento.",
    schema: z.object({
      nome: z.string().min(1),
      tipo: z.enum(["credit", "debit", "pix", "cash", "voucher", "other"]).describe("credit=crédito, voucher=VR/VA"),
      dia_fechamento: z.number().int().min(1).max(31).optional(),
      dia_vencimento: z.number().int().min(1).max(31).optional(),
      padrao: z.boolean().optional().describe("Usar como conta padrão quando nenhuma for informada"),
    }),
    async run(a, ctx) {
      const acc = await accounts.createAccount(ctx, {
        name: a.nome,
        type: a.tipo,
        closing_day: a.dia_fechamento ?? null,
        due_day: a.dia_vencimento ?? null,
      });
      if (a.padrao) await summary.updateSettings(ctx, { default_account_id: acc.id });
      return `✅ Conta cadastrada [id ${acc.id}]: ${acc.name}${a.padrao ? " (padrão)" : ""}.`;
    },
  }),
];

/** Divide o total: pessoas com valor recebem o valor; o resto é dividido igualmente entre você e quem não tem valor. */
export function splitAmounts(totalCents: number, people: { pessoa: string; valor?: number }[]) {
  if (!people.length) return [];
  const fixed = people.filter((p) => p.valor !== undefined).reduce((s, p) => s + toCents(p.valor!), 0);
  const flexible = people.filter((p) => p.valor === undefined);
  const each = flexible.length ? Math.floor((totalCents - fixed) / (flexible.length + 1)) : 0;
  return people.map((p) => ({ person: p.pessoa, amount_cents: p.valor !== undefined ? toCents(p.valor) : each }));
}
