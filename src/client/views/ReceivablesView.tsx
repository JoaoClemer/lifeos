import { ChevronDown, HandCoins, Link2, Plus, Share2 } from "lucide-react";
import type { Connection, PersonLink } from "../../shared/connections";
import { useState } from "react";
import { formatBRL } from "../../shared/money";
import { formatDateBR, monthLabel } from "../../shared/month";
import { isDue, personKey } from "../../shared/receivables";
import type { Receivable } from "../../shared/types";
import { api } from "../api";
import { useAccounts } from "../forms/common";
import { useApp, useData, useMutation } from "../state";
import { Avatar, Badge, Button, Card, CheckCircle, cx, Empty, Money, Row, Segmented } from "../ui";
import { ListSkeleton } from "./ExpensesView";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
const sum = (items: Receivable[]) => items.reduce((s, r) => s + r.amount_cents, 0);

interface PersonGroup {
  person: string;
  /** Pendentes já vencidos (ou recebidos, na aba de histórico). */
  items: Receivable[];
  /** Parcelas futuras de devedores parcelados (só na aba de pendentes). */
  future: Receivable[];
}

export function ReceivablesView() {
  const [tab, setTab] = useState<"pending" | "received">("pending");
  const { openSheet, currentMonth, toast } = useApp();
  const list = useData<Receivable[]>(`/api/receivables?status=${tab}`).data;
  // Quem tem código (DEBTOR_CODE_<NOME>) pode acompanhar os próprios valores em /devedor
  const withAccess = new Set((useData<string[]>("/api/receivables/access").data ?? []).map(personKey));
  // Nomes ligados à conta de uma pessoa conectada (ela vê o que deve em "Devo")
  const links = new Map((useData<PersonLink[]>("/api/person-links").data ?? []).map((l) => [l.person_key, l]));
  const hasConnections = (useData<Connection[]>("/api/connections").data ?? []).length > 0;
  const accounts = new Map(useAccounts().map((a) => [a.id, a.name]));
  const { run } = useMutation();

  const mark = (ids: number[], undo = false, msg?: string) => run(() => api.post("/api/receivables/mark-received", { ids, undo }), msg);

  const groups = new Map<string, PersonGroup>();
  for (const r of list ?? []) {
    const g = groups.get(norm(r.person)) ?? { person: r.person, items: [], future: [] };
    if (tab === "pending" && !isDue(r, currentMonth)) g.future.push(r);
    else g.items.push(r);
    groups.set(norm(r.person), g);
  }
  // Mostra a grafia mais usada do nome ("José" em vez de "jose")
  for (const g of groups.values()) {
    const counts = new Map<string, number>();
    for (const i of [...g.items, ...g.future]) counts.set(i.person, (counts.get(i.person) ?? 0) + 1);
    g.person = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    g.future.sort((a, b) => a.month.localeCompare(b.month) || a.id - b.id);
  }
  const all = [...groups.values()];
  const total = sum(all.flatMap((g) => g.items));
  const futureTotal = sum(all.flatMap((g) => g.future));

  const row = (r: Receivable) => (
    <Row
      key={r.id}
      left={
        <CheckCircle
          checked={!!r.received_at}
          label={r.received_at ? "Voltar para pendente" : "Marcar como recebido"}
          onClick={() => mark([r.id], !!r.received_at, r.received_at ? "Voltou para pendente" : "Recebido ✓")}
        />
      }
      title={r.description}
      subtitle={
        <>
          {r.installment_no ? (
            <Badge tone="accent">
              {r.installment_no}/{r.installment_total} · {monthLabel(r.month, true)}
            </Badge>
          ) : (
            <span>{formatDateBR(r.date)}</span>
          )}
          {r.account_id && <span>{accounts.get(r.account_id)}</span>}
          {r.received_at && <Badge tone="success">recebido {formatDateBR(r.received_at)}</Badge>}
          {!r.received_at && r.paid_claimed_at && <Badge tone="warn">disse que pagou em {formatDateBR(r.paid_claimed_at)}</Badge>}
          {!r.received_at && r.disputed_at && <Badge tone="danger">contestado</Badge>}
        </>
      }
      right={<Money cents={r.amount_cents} className="font-semibold" />}
      onClick={() => openSheet({ kind: "receivable", item: r })}
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className={tab === "pending" ? "num text-2xl font-bold text-success" : "num text-2xl font-bold"}>{formatBRL(total)}</p>
          <p className="text-sm text-muted">
            {tab === "pending" ? "a receber" : "já recebido (histórico)"}
            {tab === "pending" && futureTotal > 0 && <> · + {formatBRL(futureTotal)} em parcelas futuras</>}
          </p>
        </div>
        <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => openSheet({ kind: "new", tab: "receivable" })}>
          <Plus size={16} /> Devedor
        </Button>
      </div>
      <Segmented
        options={[
          { value: "pending", label: "Pendentes" },
          { value: "received", label: "Recebidos" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {!list ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <Empty
          icon={<HandCoins size={22} />}
          title={tab === "pending" ? "Ninguém te deve nada 🎉" : "Nada recebido ainda"}
          text={
            tab === "pending"
              ? "Ao lançar um gasto, use “Dividir com alguém”. Se passou uma compra parcelada para alguém, registre um devedor parcelado."
              : undefined
          }
        />
      ) : (
        all.map((g) => {
          const due = sum(g.items);
          return (
            <Card key={g.person} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Avatar name={g.person} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 font-semibold">
                    {g.person}
                    {withAccess.has(personKey(g.person)) && (
                      <button
                        type="button"
                        aria-label={`Enviar a ${g.person} o link para acompanhar os valores`}
                        title="Enviar link da página do devedor"
                        className="rounded-full p-1 text-muted transition hover:bg-surface-2 hover:text-accent"
                        onClick={() => shareDebtorLink(toast)}
                      >
                        <Share2 size={15} />
                      </button>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                    {g.items.length ? `${g.items.length} ${g.items.length === 1 ? "item" : "itens"}` : "nada vencido"}
                    {links.get(personKey(g.person)) ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
                        onClick={() => openSheet({ kind: "person-link", person: g.person })}
                      >
                        <Link2 size={12} /> conta de {links.get(personKey(g.person))!.linked_name ?? "pessoa"}
                      </button>
                    ) : (
                      hasConnections && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-accent"
                          onClick={() => openSheet({ kind: "person-link", person: g.person })}
                        >
                          <Link2 size={12} /> ligar à conta
                        </button>
                      )
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <Money cents={due} className="block text-lg font-bold" />
                  {tab === "pending" && g.items.length > 0 && (
                    <button
                      type="button"
                      className="text-sm font-semibold text-accent hover:underline"
                      onClick={() =>
                        window.confirm(`Marcar tudo de ${g.person} (${formatBRL(due)}) como recebido?`) &&
                        mark(
                          g.items.map((i) => i.id),
                          false,
                          `${g.person} pagou ${formatBRL(due)} ✓`,
                        )
                      }
                    >
                      Recebi tudo
                    </button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border">{g.items.map(row)}</div>
              {g.future.length > 0 && <FutureInstallments items={g.future} renderRow={row} bordered={g.items.length > 0} />}
            </Card>
          );
        })
      )}
    </div>
  );
}

/** Compartilha (ou copia) o link de /devedor. O código não vai junto: cada pessoa recebe o dela à parte. */
async function shareDebtorLink(toast: (text: string) => void) {
  const url = `${location.origin}/devedor`;
  const text = "Acompanhe aqui os valores em aberto comigo. Entre com o seu nome e o código que te passei:";
  try {
    if (navigator.share) await navigator.share({ text, url });
    else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      toast("Link copiado");
    }
  } catch (e) {
    // Cancelou o compartilhamento: nada a fazer. Sem acesso à área de transferência: mostra o link para copiar à mão
    if (!(e instanceof DOMException && e.name === "AbortError")) window.prompt("Copie o link e envie:", url);
  }
}

/** Parcelas que ainda não venceram, recolhidas por padrão. */
function FutureInstallments({ items, renderRow, bordered }: { items: Receivable[]; renderRow: (r: Receivable) => React.ReactNode; bordered: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx(bordered && "border-t border-border")}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-surface-2/50 px-4 py-2.5 text-left text-sm text-muted transition hover:bg-surface-2"
      >
        <ChevronDown size={16} className={cx("transition", open && "rotate-180")} />
        <span className="flex-1">
          Próximas parcelas ({items.length}) · até {monthLabel(items[items.length - 1].month, true)}
        </span>
        <span className="num font-semibold">{formatBRL(sum(items))}</span>
      </button>
      {open && <div className="divide-y divide-border">{items.map(renderRow)}</div>}
    </div>
  );
}
