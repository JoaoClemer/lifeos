import { AlertTriangle, Check, ChevronDown, Handshake, Undo2 } from "lucide-react";
import { useState } from "react";
import { debtStatus, type Payable } from "../../shared/connections";
import { formatBRL } from "../../shared/money";
import { formatDateBR, monthLabel } from "../../shared/month";
import { api } from "../api";
import { useData, useMutation } from "../state";
import { Avatar, Badge, Button, Card, cx, Empty, Money, Row, Segmented } from "../ui";
import { ListSkeleton } from "./ExpensesView";

type Item = Payable & { due: boolean };
const sum = (items: Item[]) => items.reduce((s, r) => s + r.amount_cents, 0);

/** "Devo": o que você deve a pessoas conectadas. Você marca "paguei" e a outra pessoa confirma. */
export function PayablesView() {
  const [tab, setTab] = useState<"pending" | "received">("pending");
  const list = useData<Item[]>(`/api/payables?status=${tab}`).data;
  const { run, busy } = useMutation();

  const groups = new Map<number, { name: string; due: Item[]; future: Item[] }>();
  for (const p of list ?? []) {
    const g = groups.get(p.creditor_id) ?? { name: p.creditor_name ?? "Pessoa", due: [], future: [] };
    if (tab === "pending" && !p.due) g.future.push(p);
    else g.due.push(p);
    groups.set(p.creditor_id, g);
  }
  const open = sum([...groups.values()].flatMap((g) => g.due).filter((p) => !p.paid_claimed_at));

  const claim = (ids: number[], undo = false) =>
    run(() => api.post("/api/payables/mark-paid", { ids, undo }), undo ? "Voltou para em aberto" : "Marcado como pago: aguardando confirmação");
  function dispute(p: Item) {
    if (p.disputed_at) return run(() => api.del(`/api/payables/${p.id}/dispute`), "Contestação retirada");
    const note = window.prompt(`O que está errado em "${p.description}"? A pessoa vai ver sua mensagem.`);
    if (note?.trim()) run(() => api.put(`/api/payables/${p.id}/dispute`, { note: note.trim() }), "Contestação enviada");
  }

  const row = (p: Item) => {
    const st = debtStatus(p);
    return (
      <Row
        key={p.id}
        title={p.description}
        subtitle={
          <>
            {p.installment_no ? (
              <Badge tone="accent">
                {p.installment_no}/{p.installment_total} · {monthLabel(p.month, true)}
              </Badge>
            ) : (
              <span>{formatDateBR(p.date)}</span>
            )}
            {st === "claimed" && <Badge tone="warn">você pagou em {formatDateBR(p.paid_claimed_at!)} · aguardando</Badge>}
            {st === "disputed" && <Badge tone="danger">contestado: {p.dispute_note}</Badge>}
            {st === "received" && <Badge tone="success">recebido {formatDateBR(p.received_at!)}</Badge>}
          </>
        }
        right={
          <div className="flex items-center gap-1">
            <Money cents={p.amount_cents} className={cx("font-semibold", st === "received" && "text-muted")} />
            {st !== "received" && (
              <>
                <button
                  type="button"
                  aria-label={p.disputed_at ? "Retirar contestação" : "Contestar"}
                  title={p.disputed_at ? "Retirar contestação" : "Contestar"}
                  className={cx("rounded-full p-2 hover:bg-surface-2", p.disputed_at ? "text-danger" : "text-muted")}
                  onClick={() => dispute(p)}
                >
                  <AlertTriangle size={16} />
                </button>
                <button
                  type="button"
                  aria-label={p.paid_claimed_at ? "Desfazer paguei" : "Marcar que paguei"}
                  title={p.paid_claimed_at ? "Desfazer" : "Paguei"}
                  disabled={busy}
                  className={cx("rounded-full p-2 hover:bg-surface-2", p.paid_claimed_at ? "text-warn" : "text-accent")}
                  onClick={() => claim([p.id], !!p.paid_claimed_at)}
                >
                  {p.paid_claimed_at ? <Undo2 size={16} /> : <Check size={16} strokeWidth={3} />}
                </button>
              </>
            )}
          </div>
        }
      />
    );
  };

  return (
    <div className="space-y-5">
      <div className="px-1">
        <p className={cx("num text-2xl font-bold", tab === "pending" && open > 0 && "text-danger")}>{formatBRL(tab === "pending" ? open : sum(list ?? []))}</p>
        <p className="text-sm text-muted">{tab === "pending" ? "em aberto (conta nos seus gastos do mês da fatura)" : "já pago (histórico)"}</p>
      </div>
      <Segmented
        options={[
          { value: "pending", label: "Em aberto" },
          { value: "received", label: "Pagos" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {!list ? (
        <ListSkeleton />
      ) : list.length === 0 ? (
        <Empty
          icon={<Handshake size={22} />}
          title={tab === "pending" ? "Você não deve nada a ninguém 🎉" : "Nada pago ainda"}
          text={tab === "pending" ? "Quando uma pessoa conectada dividir um gasto com você, ele aparece aqui." : undefined}
        />
      ) : (
        [...groups.entries()].map(([id, g]) => {
          const toClaim = g.due.filter((p) => !p.paid_claimed_at && !p.received_at);
          return (
            <Card key={id} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <Avatar name={g.name} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{g.name}</p>
                  <p className="text-sm text-muted">{g.due.length ? `${g.due.length} ${g.due.length === 1 ? "item" : "itens"}` : "nada vencido"}</p>
                </div>
                <div className="text-right">
                  <Money cents={sum(g.due.filter((p) => !p.received_at))} className="block text-lg font-bold" />
                  {tab === "pending" && toClaim.length > 1 && (
                    <Button
                      variant="ghost"
                      className="h-7 px-1 text-sm"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Marcar ${toClaim.length} itens (${formatBRL(sum(toClaim))}) como pagos para ${g.name}?`) && claim(toClaim.map((p) => p.id))
                      }
                    >
                      Paguei tudo
                    </Button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border">{g.due.map(row)}</div>
              {g.future.length > 0 && <Future items={g.future} renderRow={row} bordered={g.due.length > 0} />}
            </Card>
          );
        })
      )}
    </div>
  );
}

function Future({ items, renderRow, bordered }: { items: Item[]; renderRow: (p: Item) => React.ReactNode; bordered: boolean }) {
  const [open, setOpen] = useState(false);
  const sorted = [...items].sort((a, b) => a.month.localeCompare(b.month) || a.id - b.id);
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
          Próximas parcelas ({items.length}) · até {monthLabel(sorted[sorted.length - 1].month, true)}
        </span>
        <span className="num font-semibold">{formatBRL(sum(items))}</span>
      </button>
      {open && <div className="divide-y divide-border">{sorted.map(renderRow)}</div>}
    </div>
  );
}
