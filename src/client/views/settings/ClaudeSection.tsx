import { Bot, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { McpTokenInfo } from "../../../shared/users";
import { api } from "../../api";
import { useData, useMutation } from "../../state";
import { Button, Card, List, Row, Section } from "../../ui";
import { CopyField, dateOf } from "./CopyField";

/** Conectores do Claude da pessoa. O link só aparece ao criar; depois dá para revogar. */
export function ClaudeSection() {
  const legacy = useData<{ configured: boolean; url: string | null }>("/api/mcp-info").data;
  const tokens = useData<McpTokenInfo[]>("/api/me/mcp-tokens").data;
  const { run, busy } = useMutation();
  const [created, setCreated] = useState<string | null>(null);

  async function create() {
    const r = await run(() => api.post<{ url: string }>("/api/me/mcp-tokens", { name: `Claude ${(tokens?.length ?? 0) + 1}` }));
    if (r) setCreated(r.url);
  }

  return (
    <Section title="Conectar ao Claude">
      <Card className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-accent-soft p-2 text-accent">
            <Bot size={20} />
          </span>
          <p className="text-sm text-muted">
            Gere um link e adicione como <b className="text-text">conector personalizado</b> no Claude (Configurações → Conectores → Adicionar conector
            personalizado). Depois é só pedir: <i>“lança 32 reais de almoço no VR”</i>. O Claude só enxerga os seus dados.
          </p>
        </div>
        {created && (
          <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
            <CopyField value={created} />
            <p className="text-xs text-muted">Copie agora: por segurança, este link não aparece de novo. Ele funciona como uma senha, não compartilhe.</p>
          </div>
        )}
        {legacy?.configured && legacy.url && (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted">Link principal (MCP_TOKEN)</p>
            <CopyField value={legacy.url} />
          </div>
        )}
        <Button variant="secondary" className="w-full" disabled={busy} onClick={create}>
          <Plus size={16} /> Gerar link do conector
        </Button>
      </Card>
      {tokens && tokens.length > 0 && (
        <List>
          {tokens.map((t) => (
            <Row
              key={t.id}
              left={<Bot size={18} className="text-muted" />}
              title={t.name}
              subtitle={`criado em ${dateOf(t.created_at)} · ${t.last_used_at ? `usado em ${dateOf(t.last_used_at)}` : "ainda não usado"}`}
              right={
                <button
                  type="button"
                  aria-label="Revogar conector"
                  className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() =>
                    window.confirm(`Revogar "${t.name}"? O Claude conectado com ele para de funcionar.`) &&
                    run(() => api.del(`/api/me/mcp-tokens/${t.id}`), "Conector revogado")
                  }
                >
                  <Trash2 size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}
    </Section>
  );
}
