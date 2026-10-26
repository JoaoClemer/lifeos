import { KeyRound, UserCheck, UserPlus, UserX, X } from "lucide-react";
import { useState } from "react";
import type { AdminUser, CreatedLink, PendingInvite } from "../../../shared/users";
import { api } from "../../api";
import { useApp, useData, useMutation } from "../../state";
import { Avatar, Badge, Button, Card, Field, List, Row, Section, TextInput } from "../../ui";
import { CopyField, dateOf } from "./CopyField";

/** Administração das pessoas (só admin): convidar, recuperar acesso, desativar. */
export function PeopleSection() {
  const { me } = useApp();
  const users = useData<AdminUser[]>("/api/admin/users").data;
  const invites = useData<PendingInvite[]>("/api/admin/invites").data;
  const { run, busy } = useMutation();
  const [name, setName] = useState("");
  const [link, setLink] = useState<{ url: string; label: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  async function invite() {
    const r = await run(() => api.post<CreatedLink>("/api/admin/invites", { name: name.trim() }));
    if (r) {
      setLink({ url: r.url, label: `Convite para ${name.trim()}` });
      setName("");
    }
  }
  async function recovery(u: AdminUser) {
    const r = await run(() => api.post<CreatedLink>(`/api/admin/users/${u.id}/recovery`));
    if (r) setLink({ url: r.url, label: `Recuperação de acesso de ${u.name ?? "pessoa"}` });
  }

  return (
    <Section title="Pessoas">
      <Card className="space-y-3 p-4">
        <Field label="Convidar alguém" htmlFor="invite-name" hint="O link vale por 7 dias e para uma pessoa só. Ela cria a conta com uma passkey.">
          <div className="flex gap-2">
            <TextInput id="invite-name" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            <Button className="shrink-0" disabled={busy || !name.trim()} onClick={invite}>
              <UserPlus size={16} /> Convidar
            </Button>
          </div>
        </Field>
        {link && (
          <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/40 p-3">
            <p className="text-sm font-semibold">{link.label}</p>
            <CopyField value={link.url} shareText="Seu acesso ao LifeOS:" />
            <p className="text-xs text-muted">Mande pelo WhatsApp. Quem tiver o link consegue usá-lo uma vez.</p>
          </div>
        )}
      </Card>

      <List>
        {(users ?? []).map((u) => (
          <div key={u.id}>
            <Row
              left={<Avatar name={u.name ?? "?"} />}
              title={
                <span className="flex items-center gap-2">
                  {u.name ?? "Sem nome"}
                  {u.role === "admin" && <Badge tone="accent">admin</Badge>}
                  {u.disabled_at && <Badge tone="danger">desativada</Badge>}
                  {u.passkeys === 0 && !u.disabled_at && <Badge tone="warn">sem passkey</Badge>}
                </span>
              }
              subtitle={`desde ${dateOf(u.created_at)}${u.last_login_at ? ` · entrou em ${dateOf(u.last_login_at)}` : ""}${u.invited_by_name ? ` · convite de ${u.invited_by_name}` : ""}`}
              onClick={() => setOpen(open === u.id ? null : u.id)}
            />
            {open === u.id && (
              <div className="flex flex-wrap gap-2 bg-surface-2/60 px-4 py-3">
                <Button variant="secondary" className="h-9 px-3 text-sm" disabled={busy} onClick={() => recovery(u)}>
                  <KeyRound size={15} /> Link de recuperação
                </Button>
                {u.id !== me.id &&
                  (u.disabled_at ? (
                    <Button variant="secondary" className="h-9 px-3 text-sm" disabled={busy} onClick={() => run(() => api.post(`/api/admin/users/${u.id}/enable`), "Pessoa reativada")}>
                      <UserCheck size={15} /> Reativar
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      className="h-9 px-3 text-sm"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(`Desativar ${u.name ?? "esta pessoa"}? Ela sai de todos os aparelhos e não entra mais. Os dados ficam guardados.`) &&
                        run(() => api.post(`/api/admin/users/${u.id}/disable`), "Pessoa desativada")
                      }
                    >
                      <UserX size={15} /> Desativar
                    </Button>
                  ))}
              </div>
            )}
          </div>
        ))}
      </List>

      {invites && invites.length > 0 && (
        <List>
          {invites.map((i) => (
            <Row
              key={i.id}
              left={<UserPlus size={18} className="text-muted" />}
              title={`${i.kind === "invite" ? "Convite" : "Recuperação"}: ${i.name ?? "pessoa"}`}
              subtitle={`ainda não usado · vale até ${dateOf(i.expires_at)}`}
              right={
                <button
                  type="button"
                  aria-label="Cancelar link"
                  className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() => run(() => api.del(`/api/admin/invites/${i.id}`), "Link cancelado")}
                >
                  <X size={16} />
                </button>
              }
            />
          ))}
        </List>
      )}
    </Section>
  );
}
