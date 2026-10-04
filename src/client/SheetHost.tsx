import { useState } from "react";
import { AccountForm } from "./forms/AccountForm";
import { ExpenseForm } from "./forms/ExpenseForm";
import { GoalDetail, GoalForm } from "./forms/GoalForms";
import { InstallmentForm } from "./forms/InstallmentForm";
import { ReceivableForm } from "./forms/ReceivableForm";
import { RecurringForm } from "./forms/RecurringForm";
import { type NewTab, useApp, useData } from "./state";
import type { Goal } from "../shared/types";
import { Segmented, Sheet } from "./ui";

const TABS: { value: NewTab; label: string }[] = [
  { value: "expense", label: "Gasto" },
  { value: "installment", label: "Parcelado" },
  { value: "recurring", label: "Fixo" },
  { value: "receivable", label: "Devedor" },
];

function NewEntry({ tab: initial, budgetId, onDone }: { tab?: NewTab; budgetId?: number; onDone: () => void }) {
  const [tab, setTab] = useState<NewTab>(initial ?? "expense");
  return (
    <div className="space-y-4">
      <Segmented options={TABS} value={tab} onChange={setTab} />
      {tab === "expense" && <ExpenseForm key="e" budgetId={budgetId} onDone={onDone} />}
      {tab === "installment" && <InstallmentForm key="i" onDone={onDone} />}
      {tab === "recurring" && <RecurringForm key="r" onDone={onDone} />}
      {tab === "receivable" && <ReceivableForm key="d" onDone={onDone} />}
    </div>
  );
}

export function SheetHost() {
  const { sheet, closeSheet, openSheet } = useApp();
  if (!sheet) return null;
  const done = closeSheet;
  switch (sheet.kind) {
    case "new":
      return (
        <Sheet title="Novo lançamento" onClose={closeSheet}>
          <NewEntry tab={sheet.tab} budgetId={sheet.budgetId} onDone={done} />
        </Sheet>
      );
    case "expense":
      return (
        <Sheet title="Editar gasto" onClose={closeSheet}>
          <ExpenseForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "installment":
      return (
        <Sheet title="Editar parcelado" onClose={closeSheet}>
          <InstallmentForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "recurring":
      return (
        <Sheet title={sheet.item.is_budget ? "Editar orçamento" : "Editar fixo"} onClose={closeSheet}>
          <RecurringForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "receivable":
      return (
        <Sheet title="Editar devedor" onClose={closeSheet}>
          <ReceivableForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "goal":
      return (
        <Sheet title={sheet.item ? "Editar meta" : "Nova meta"} onClose={closeSheet}>
          <GoalForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "goal-detail":
      return (
        <GoalDetailSheet id={sheet.id} onClose={closeSheet} onEdit={(g) => openSheet({ kind: "goal", item: g })} />
      );
    case "account":
      return (
        <Sheet title={sheet.item ? "Editar conta" : "Nova conta / cartão"} onClose={closeSheet}>
          <AccountForm item={sheet.item} onDone={done} />
        </Sheet>
      );
  }
}

function GoalDetailSheet({ id, onClose, onEdit }: { id: number; onClose: () => void; onEdit: (g: Goal) => void }) {
  const { month } = useApp();
  const name = useData<Goal[]>(`/api/goals?month=${month}`).data?.find((g) => g.id === id)?.name ?? "Meta";
  return (
    <Sheet title={name} onClose={onClose}>
      <GoalDetail id={id} onEdit={onEdit} />
    </Sheet>
  );
}
