import { useState } from "react";
import { AccountForm } from "./forms/AccountForm";
import { BalanceForm } from "./forms/BalanceForm";
import { ExpenseForm } from "./forms/ExpenseForm";
import { GoalDetail, GoalForm } from "./forms/GoalForms";
import { IncomeForm } from "./forms/IncomeForm";
import { InstallmentForm } from "./forms/InstallmentForm";
import { PersonLinkForm } from "./forms/PersonLinkForm";
import { ReceivableForm } from "./forms/ReceivableForm";
import { RecurringForm } from "./forms/RecurringForm";
import { EventForm } from "./modules/agenda/EventForm";
import { ProjectForm } from "./modules/tasks/ProjectForm";
import { TaskForm } from "./modules/tasks/TaskForm";
import { TrainingForm } from "./modules/training/TrainingForm";
import { MOBILE_TABS, NAV_SECTIONS } from "./nav";
import { type EventDefaults, type FinanceTab, type NewTab, useApp, useData } from "./state";
import { monthTitle } from "../shared/month";
import type { Task } from "../shared/tasks";
import type { Goal } from "../shared/types";
import { cx, Segmented, Sheet } from "./ui";

const FINANCE_TABS: { value: FinanceTab; label: string }[] = [
  { value: "expense", label: "Gasto" },
  { value: "installment", label: "Parcelado" },
  { value: "recurring", label: "Fixo" },
  { value: "receivable", label: "Devedor" },
  { value: "income", label: "Entrada" },
];

type Group = "task" | "event" | "training" | "finance";

function NewEntry({
  tab: initial,
  budgetId,
  event,
  task,
  training,
  onDone,
}: {
  tab?: NewTab;
  budgetId?: number;
  event?: EventDefaults;
  task?: Partial<Pick<Task, "due_date" | "project_id">>;
  training?: { date?: string };
  onDone: () => void;
}) {
  const [tab, setTab] = useState<NewTab>(initial ?? "expense");
  const group: Group = tab === "task" || tab === "event" || tab === "training" ? tab : "finance";
  return (
    <div className="space-y-4">
      <Segmented<Group>
        options={[
          { value: "task", label: "Tarefa" },
          { value: "event", label: "Evento" },
          { value: "training", label: "Treino" },
          { value: "finance", label: "Finanças" },
        ]}
        value={group}
        onChange={(g) => setTab(g === "finance" ? "expense" : g)}
      />
      {group === "finance" && <Segmented<FinanceTab> options={FINANCE_TABS} value={tab as FinanceTab} onChange={setTab} />}
      {tab === "task" && <TaskForm key="t" defaults={task} onDone={onDone} />}
      {tab === "event" && <EventForm key="v" defaults={event} onDone={onDone} />}
      {tab === "training" && <TrainingForm key="w" defaults={training} onDone={onDone} />}
      {tab === "expense" && <ExpenseForm key="e" budgetId={budgetId} onDone={onDone} />}
      {tab === "installment" && <InstallmentForm key="i" onDone={onDone} />}
      {tab === "recurring" && <RecurringForm key="r" onDone={onDone} />}
      {tab === "receivable" && <ReceivableForm key="d" onDone={onDone} />}
      {tab === "income" && <IncomeForm key="n" onDone={onDone} />}
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
        <Sheet title="Novo" onClose={closeSheet}>
          <NewEntry tab={sheet.tab} budgetId={sheet.budgetId} event={sheet.event} task={sheet.task} training={sheet.training} onDone={done} />
        </Sheet>
      );
    case "task":
      return (
        <Sheet title={sheet.item.parent_id ? "Subtarefa" : "Tarefa"} onClose={closeSheet}>
          <TaskForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "training":
      return (
        <Sheet title="Treino" onClose={closeSheet}>
          <TrainingForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "event":
      return (
        <Sheet title="Evento" onClose={closeSheet}>
          <EventForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "project":
      return (
        <Sheet title={sheet.item ? "Editar projeto" : "Novo projeto"} onClose={closeSheet}>
          <ProjectForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "more":
      return (
        <Sheet title="Mais" onClose={closeSheet}>
          <MoreMenu onDone={done} />
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
    case "person-link":
      return (
        <Sheet title={`Conta de ${sheet.person}`} onClose={closeSheet}>
          <PersonLinkForm person={sheet.person} onDone={done} />
        </Sheet>
      );
    case "income":
      return (
        <Sheet title="Editar entrada" onClose={closeSheet}>
          <IncomeForm item={sheet.item} onDone={done} />
        </Sheet>
      );
    case "balance":
      return (
        <Sheet title={`Saldo inicial de ${monthTitle(sheet.month)}`} onClose={closeSheet}>
          <BalanceForm month={sheet.month} balance={sheet.balance} onDone={done} />
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

/** Telas que não cabem na barra inferior do celular. */
function MoreMenu({ onDone }: { onDone: () => void }) {
  const { route, navigate } = useApp();
  return (
    <nav className="space-y-4 pb-2">
      {NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((n) => !(MOBILE_TABS as readonly string[]).includes(n.view)) }))
        .filter((s) => s.items.length)
        .map((s) => (
        <div key={s.items[0].section} className="space-y-1">
          {s.label && <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{s.label}</p>}
          {s.items.map((n) => (
            <button
              key={n.view}
              type="button"
              onClick={() => {
                onDone();
                navigate(n.view);
              }}
              aria-current={route.view === n.view ? "page" : undefined}
              className={cx(
                "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium transition",
                route.view === n.view ? "bg-accent-soft text-accent" : "hover:bg-surface-2",
              )}
            >
              <n.icon size={20} /> {n.label}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
