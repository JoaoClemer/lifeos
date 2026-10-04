import { HandCoins, Plus } from "lucide-react";
import { useState } from "react";
import { formatBRL } from "../../shared/money";
import { formatDateBR } from "../../shared/month";
import type { Receivable } from "../../shared/types";
import { api } from "../api";
import { useAccounts } from "../forms/common";
import { useApp, useData, useMutation } from "../state";
import { Badge, Button, Card, CheckCircle, Empty, Money, Row, Segmented } from "../ui";
import { ListSkeleton } from "./ExpensesView";
import { Avatar } from "./SummaryView";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

export function ReceivablesView() {
  const [tab, setTab] = useState<"pending" | "received">("pending");
  const { openSheet } = useApp();
  const list = useData<Receivable[]>(`/api/receivables?status=${tab}`).data;
  const accounts = new Map(useAccounts().map((a) => [a.id, a.name]));
  const { run } = useMutation();

  const mark = (ids: number[], undo = false, msg?: string) => run(() => api.post("/api/receivables/mark-received", { ids, undo }), msg);

  const groups = new Map<string, { person: string; items: Receivable[]; total: number }>();
  for (const r of list ?? []) {
    const g = groups.get(norm(r.person)) ?? { person: r.person, items: [], total: 0 };
    g.items.push(r);
    g.total += r.amount_cents;
    groups.set(norm(r.person), g);
  }
  // Mostra a grafia mais usada do nome ("José" em vez de "jose")
  for (const g of groups.values()) {
    const counts = new Map<string, number>();
    for (const i of g.items) counts.set(i.person, (counts.get(i.person) ?? 0) + 1);
    g.person = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  const total = (list ?? []).reduce((s, r) => s + r.amount_cents, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className={tab === "pending" ? "num text-2xl font-bold text-success" : "num text-2xl font-bold"}>{formatBRL(total)}</p>
          <p className="text-sm text-muted">{tab === "pending" ? "a receber" : "já recebido (histórico)"}</p>
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
          text={tab === "pending" ? "Ao lançar um gasto, use “Dividir com alguém” para registrar a parte dos outros." : undefined}
        />
      ) : (
        [...groups.values()].map((g) => (
          <Card key={g.person} className="overflow-hidden">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Avatar name={g.person} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{g.person}</p>
                <p className="text-sm text-muted">
                  {g.items.length} {g.items.length === 1 ? "item" : "itens"}
                </p>
              </div>
              <div className="text-right">
                <Money cents={g.total} className="block text-lg font-bold" />
                {tab === "pending" && (
                  <button
                    type="button"
                    className="text-sm font-semibold text-accent hover:underline"
                    onClick={() =>
                      window.confirm(`Marcar tudo de ${g.person} (${formatBRL(g.total)}) como recebido?`) &&
                      mark(
                        g.items.map((i) => i.id),
                        false,
                        `${g.person} pagou ${formatBRL(g.total)} ✓`,
                      )
                    }
                  >
                    Recebi tudo
                  </button>
                )}
              </div>
            </div>
            <div className="divide-y divide-border">
              {g.items.map((r) => (
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
                      <span>{formatDateBR(r.date)}</span>
                      {r.account_id && <span>{accounts.get(r.account_id)}</span>}
                      {r.received_at && <Badge tone="success">recebido {formatDateBR(r.received_at)}</Badge>}
                    </>
                  }
                  right={<Money cents={r.amount_cents} className="font-semibold" />}
                  onClick={() => openSheet({ kind: "receivable", item: r })}
                />
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
