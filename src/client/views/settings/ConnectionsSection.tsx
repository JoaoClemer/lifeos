import { Link2, UserMinus } from "lucide-react";
import { useState } from "react";
import type { Connection } from "../../../shared/connections";
import type { CreatedLink } from "../../../shared/users";
import { api } from "../../api";
import { useData, useMutation } from "../../state";
import { Avatar, Button, Card, List, Row, Section } from "../../ui";
import { CopyField, dateOf } from "./CopyField";

/** Pessoas conectadas: dá para ligar devedores à conta delas e (nas próximas telas) compartilhar eventos, listas e metas. */
export function ConnectionsSection() {
  const connections = useData<Connection[]>("/api/connections").data;
  const { run, busy } = useMutation();
  const [link, setLink] = useState<string | null>(null);

  async function createLink() {
    const r = await run(() => api.post<CreatedLink>("/api/connections/link"));
    if (r) setLink(r.url);
  }

  return (
    <Section title="Conexões">
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          Pessoas conectadas podem dividir gastos com você (o que uma deve aparece para a outra) e compartilhar eventos, listas de tarefas e
          metas. Quem te convidou já está conectado(a).
        </p>
        {link && (
          <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
            <CopyField value={link} shareText="Vamos nos conectar no LifeOS:" />
            <p className="text-xs text-muted">Mande para a pessoa (ela precisa ter conta no LifeOS). O link vale uma vez, por 7 dias.</p>
          </div>
        )}
        <Button variant="secondary" className="w-full" disabled={busy} onClick={createLink}>
          <Link2 size={16} /> Conectar com alguém
        </Button>
      </Card>
      {connections && connections.length > 0 && (
        <List>
          {connections.map((c) => (
            <Row
              key={c.user_id}
              left={<Avatar name={c.name ?? "?"} />}
              title={c.name ?? "Pessoa"}
              subtitle={`conectados desde ${dateOf(c.since)}`}
              right={
                <button
                  type="button"
                  aria-label={`Desconectar de ${c.name ?? "pessoa"}`}
                  className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() =>
                    window.confirm(
                      `Desconectar de ${c.name ?? "esta pessoa"}? Os devedores ligados entre vocês são desligados: os valores continuam com quem tem a receber, mas deixam de aparecer para quem deve.`,
                    ) && run(() => api.del(`/api/connections/${c.user_id}`), "Desconectado")
                  }
                >
                  <UserMinus size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}
    </Section>
  );
}
