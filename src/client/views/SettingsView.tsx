import { Download, LogOut, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCOUNT_TYPE_LABEL, type Account } from "../../shared/types";
import { api } from "../api";
import { useSettings } from "../forms/common";
import { useApp, useData, useMutation } from "../state";
import { AccountIcon, Badge, Button, Card, Field, List, MoneyInput, Row, Section } from "../ui";
import { AccountSection } from "./settings/AccountSection";
import { ClaudeSection } from "./settings/ClaudeSection";
import { ConnectionsSection } from "./settings/ConnectionsSection";
import { PeopleSection } from "./settings/PeopleSection";

export function SettingsView({ onLogout }: { onLogout: () => void }) {
  const { openSheet, me, toast } = useApp();
  const accounts = useData<Account[]>("/api/accounts?all=1").data ?? [];
  const settings = useSettings();
  const { run, busy } = useMutation();
  const [income, setIncome] = useState<number | null>(null);

  useEffect(() => {
    if (settings) setIncome(settings.income_cents);
  }, [settings]);

  async function deleteAccount() {
    const typed = window.prompt("Isso apaga sua conta e todos os seus dados, sem volta. Para confirmar, digite EXCLUIR:");
    if (typed === null) return;
    try {
      await api.del("/api/me", { confirm: typed.trim() });
      onLogout();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Erro", "error");
    }
  }

  return (
    <div className="space-y-7">
      <AccountSection onLogout={onLogout} />

      <Section
        title="Cartões e contas"
        action={
          <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => openSheet({ kind: "account" })}>
            <Plus size={16} /> Adicionar
          </Button>
        }
      >
        {accounts.length === 0 ? (
          <Card className="p-4 text-sm text-muted">Cadastre seus cartões de crédito e outras formas de pagamento (Pix, débito, VR).</Card>
        ) : (
          <List>
            {accounts.map((a) => (
              <Row
                key={a.id}
                left={
                  <span className="rounded-xl bg-surface-2 p-2 text-muted">
                    <AccountIcon type={a.type} size={18} />
                  </span>
                }
                title={
                  <span className="flex items-center gap-2">
                    {a.name}
                    {settings?.default_account_id === a.id && <Badge tone="accent">padrão</Badge>}
                    {a.archived ? <Badge>arquivada</Badge> : null}
                  </span>
                }
                subtitle={
                  <>
                    <span>
                      {[
                        ACCOUNT_TYPE_LABEL[a.type],
                        a.closing_day && `fecha dia ${a.closing_day}`,
                        a.due_day && `vence dia ${a.due_day}`,
                        a.payment_day && `paga dia ${a.payment_day}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {a.type === "credit" && !a.closing_day && <span className="text-warn">defina o fechamento</span>}
                  </>
                }
                onClick={() => openSheet({ kind: "account", item: a })}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title="Renda mensal">
        <Card className="space-y-3 p-4">
          <Field
            label="Salário líquido fixo (opcional)"
            hint="Vale para todos os meses e é usado para calcular quanto sobra. 13º, bônus e outras entradas extras você lança em + → Entrada."
          >
            <MoneyInput value={income} onChange={setIncome} />
          </Field>
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy || income === (settings?.income_cents ?? null)}
            onClick={() => run(() => api.put("/api/settings", { income_cents: income }), "Renda salva")}
          >
            Salvar renda
          </Button>
        </Card>
      </Section>

      <ClaudeSection />

      <ConnectionsSection />

      {me.role === "admin" && <PeopleSection />}

      <Section title="Privacidade e dados">
        <Card className="p-4 text-sm text-muted">
          {me.role === "admin"
            ? "Cada pessoa só vê os próprios dados e o que for compartilhado com ela. Como você administra o LifeOS, tem acesso técnico ao banco de dados de todos: use com responsabilidade."
            : "Só você vê seus dados, a não ser o que você compartilhar. Quem administra o LifeOS tem acesso técnico ao banco de dados."}
        </Card>
        <List>
          <Row
            left={<Download size={18} className="text-muted" />}
            title="Baixar backup (JSON)"
            subtitle="Todos os seus lançamentos, metas, tarefas, eventos e treinos"
            onClick={() => (window.location.href = "/api/export")}
          />
          <Row
            left={<LogOut size={18} className="text-danger" />}
            title={<span className="text-danger">Sair</span>}
            onClick={async () => {
              await api.post("/api/logout");
              onLogout();
            }}
          />
          {me.role !== "admin" && (
            <Row
              left={<Trash2 size={18} className="text-danger" />}
              title={<span className="text-danger">Excluir minha conta</span>}
              subtitle="Apaga você e todos os seus dados, sem volta"
              onClick={deleteAccount}
            />
          )}
        </List>
      </Section>
    </div>
  );
}
