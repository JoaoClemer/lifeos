import { Bot, Check, Copy, Download, LogOut, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ACCOUNT_TYPE_LABEL, type Account } from "../../shared/types";
import { api } from "../api";
import { useSettings } from "../forms/common";
import { useApp, useData, useMutation } from "../state";
import { AccountIcon, Badge, Button, Card, Field, List, MoneyInput, Row, Section } from "../ui";

export function SettingsView({ onLogout }: { onLogout: () => void }) {
  const { openSheet } = useApp();
  const accounts = useData<Account[]>("/api/accounts?all=1").data ?? [];
  const settings = useSettings();
  const mcp = useData<{ configured: boolean; url: string | null }>("/api/mcp-info").data;
  const { run, busy } = useMutation();
  const [income, setIncome] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (settings) setIncome(settings.income_cents);
  }, [settings]);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-7">
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
                      {[ACCOUNT_TYPE_LABEL[a.type], a.closing_day && `fecha dia ${a.closing_day}`, a.due_day && `vence dia ${a.due_day}`].filter(Boolean).join(" · ")}
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
          <Field label="Quanto entra por mês (opcional)" hint="Usado para calcular quanto sobra depois dos gastos e aportes.">
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

      <Section title="Conectar ao Claude">
        <Card className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-accent-soft p-2 text-accent">
              <Bot size={20} />
            </span>
            <p className="text-sm text-muted">
              Adicione este endereço como <b className="text-text">conector personalizado</b> no Claude (Configurações → Conectores → Adicionar conector
              personalizado). Depois é só pedir: <i>“lança 32 reais de almoço no VR”</i>.
            </p>
          </div>
          {mcp?.configured && mcp.url ? (
            <>
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
                <code className="min-w-0 flex-1 truncate text-xs">{mcp.url}</code>
                <Button variant="secondary" className="h-9 shrink-0 px-3 text-sm" onClick={() => copy(mcp.url!)}>
                  {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiado" : "Copiar"}
                </Button>
              </div>
              <p className="text-xs text-muted">Este link funciona como uma senha: não compartilhe.</p>
            </>
          ) : (
            <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
              Defina o segredo <code>MCP_TOKEN</code> no Worker para habilitar (veja o README).
            </p>
          )}
        </Card>
      </Section>

      <Section title="Dados">
        <List>
          <Row
            left={<Download size={18} className="text-muted" />}
            title="Baixar backup (JSON)"
            subtitle="Todos os seus lançamentos, metas e configurações"
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
        </List>
      </Section>
    </div>
  );
}
