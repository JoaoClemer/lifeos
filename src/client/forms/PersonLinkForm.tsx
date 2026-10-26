import { Link2, Unlink } from "lucide-react";
import { useState } from "react";
import type { Connection, PersonLink } from "../../shared/connections";
import { personKey } from "../../shared/receivables";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { Avatar, Button, cx } from "../ui";

/** Liga um nome dos seus devedores à conta de uma pessoa conectada. */
export function PersonLinkForm({ person, onDone }: { person: string; onDone: () => void }) {
  const { navigate } = useApp();
  const connections = useData<Connection[]>("/api/connections").data;
  const links = useData<PersonLink[]>("/api/person-links").data;
  const current = links?.find((l) => l.person_key === personKey(person));
  const [selected, setSelected] = useState<number | null>(null);
  const chosen = selected ?? current?.linked_user_id ?? null;
  const { run, busy } = useMutation();

  async function save() {
    if (chosen && (await run(() => api.put("/api/person-links", { person, user_id: chosen }), `${person} ligado(a) à conta`))) onDone();
  }
  async function unlink() {
    if (await run(() => api.del("/api/person-links", { person }), `${person} desligado(a)`)) onDone();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Ligue <b className="text-text">{person}</b> à conta da pessoa no LifeOS. Tudo o que {person} te deve, inclusive o histórico, passa a aparecer
        para ela em “Devo” e entra nos gastos dela no mês da fatura. Ela pode marcar que pagou ou contestar; quem confirma o recebimento é você.
      </p>
      {!connections ? (
        <div className="h-20 animate-pulse rounded-2xl bg-surface-2" />
      ) : connections.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted">
          <p>Você ainda não está conectado(a) a ninguém. Mande um link de conexão para a pessoa em Ajustes → Conexões.</p>
          <Button
            variant="secondary"
            onClick={() => {
              onDone();
              navigate("settings");
            }}
          >
            Ir para Conexões
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5" role="radiogroup" aria-label="Conta da pessoa">
          {connections.map((c) => (
            <button
              key={c.user_id}
              type="button"
              role="radio"
              aria-checked={chosen === c.user_id}
              onClick={() => setSelected(c.user_id)}
              className={cx(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                chosen === c.user_id ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2",
              )}
            >
              <Avatar name={c.name ?? "?"} />
              <span className="flex-1 font-medium">{c.name ?? "Pessoa"}</span>
              {current?.linked_user_id === c.user_id && <Link2 size={16} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {current && (
          <Button variant="secondary" className="flex-1" disabled={busy} onClick={unlink}>
            <Unlink size={16} /> Desligar
          </Button>
        )}
        <Button className="flex-1" disabled={busy || !chosen || chosen === current?.linked_user_id} onClick={save}>
          <Link2 size={16} /> Ligar
        </Button>
      </div>
    </div>
  );
}
