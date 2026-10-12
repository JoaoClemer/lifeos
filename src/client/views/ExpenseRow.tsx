import { formatBRL } from "../../shared/money";
import { monthLabel } from "../../shared/month";
import type { Account, Expense, Recurring } from "../../shared/types";
import { useApp } from "../state";
import { AccountIcon, Badge, Money, Row } from "../ui";

/** Linha de um gasto avulso: conta, orçamento, parte dos outros e mês da fatura quando for outro. Toque abre a edição. */
export function ExpenseRow({ expense: e, account, budget }: { expense: Expense; account?: Account; budget?: Recurring }) {
  const { openSheet } = useApp();
  return (
    <Row
      title={e.description}
      subtitle={
        <>
          {account && (
            <span className="inline-flex items-center gap-1">
              <AccountIcon type={account.type} size={13} /> {account.name}
            </span>
          )}
          {budget && <Badge tone="accent">{budget.description}</Badge>}
          {e.shared_cents > 0 && <Badge tone="success">+{formatBRL(e.shared_cents)} a receber</Badge>}
          {e.month !== e.date.slice(0, 7) && <Badge>fatura {monthLabel(e.month, true)}</Badge>}
        </>
      }
      right={<Money cents={e.amount_cents} className="font-semibold" />}
      onClick={() => openSheet({ kind: "expense", item: e })}
    />
  );
}
