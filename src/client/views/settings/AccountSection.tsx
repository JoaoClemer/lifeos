import { KeyRound, LogOut, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { PasskeyInfo } from "../../../shared/users";
import { api } from "../../api";
import { addPasskey, passkeyError } from "../../auth/passkeys";
import { useApp, useData, useMutation } from "../../state";
import { Badge, Button, Card, Field, inputCls, List, Row, Section, TextInput } from "../../ui";
import { dateOf } from "./CopyField";

/** Fusos mais comuns; o atual da pessoa entra na lista se não estiver nela. */
const TIMEZONES = [
  ["America/Sao_Paulo", "Brasília (São Paulo, Rio, BH...)"],
  ["America/Manaus", "Amazonas (Manaus)"],
  ["America/Cuiaba", "Mato Grosso (Cuiabá)"],
  ["America/Rio_Branco", "Acre (Rio Branco)"],
  ["America/Noronha", "Fernando de Noronha"],
  ["Europe/Lisbon", "Portugal (Lisboa)"],
  ["America/New_York", "Estados Unidos (Nova York)"],
] as const;

export function AccountSection({ onLogout }: { onLogout: () => void }) {
  const { me, reloadMe, toast, refresh } = useApp();
  const passkeys = useData<PasskeyInfo[]>("/api/me/passkeys").data;
  const { run, busy } = useMutation();
  const [name, setName] = useState(me.name ?? "");
  const [timezone, setTimezone] = useState(me.timezone ?? "");
  useEffect(() => {
    setName(me.name ?? "");
    setTimezone(me.timezone ?? "");
  }, [me]);
  const changed = name.trim() !== (me.name ?? "") || timezone !== (me.timezone ?? "");
  const zones = TIMEZONES.some(([z]) => z === me.timezone) || !me.timezone ? TIMEZONES : [[me.timezone, me.timezone] as const, ...TIMEZONES];

  async function save() {
    const ok = await run(() => api.patch("/api/me", { name: name.trim() || undefined, timezone: timezone || null }), "Conta atualizada");
    if (ok) reloadMe();
  }

  async function newDevice() {
    try {
      await addPasskey();
      toast("Passkey cadastrada neste aparelho");
      refresh();
    } catch (e) {
      toast(passkeyError(e), "error");
    }
  }

  return (
    <Section title="Sua conta">
      <Card className="space-y-3 p-4">
        <Field label="Nome" htmlFor="me-name" hint="É como as pessoas conectadas a você te veem.">
          <TextInput id="me-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label="Fuso horário" htmlFor="me-tz" hint="Define o “hoje” do app e do Claude.">
          <select id="me-tz" className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            <option value="">Padrão do app</option>
            {zones.map(([z, label]) => (
              <option key={z} value={z}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Button variant="secondary" className="w-full" disabled={busy || !changed || !name.trim()} onClick={save}>
          Salvar
        </Button>
      </Card>

      <List>
        {(passkeys ?? []).map((k) => (
          <Row
            key={k.id}
            left={<KeyRound size={18} className="text-muted" />}
            title={
              <span className="flex items-center gap-2">
                {k.device ?? "Passkey"}
                {k.backed_up && <Badge tone="success">sincronizada</Badge>}
              </span>
            }
            subtitle={`cadastrada em ${dateOf(k.created_at)}${k.last_used_at ? ` · último uso ${dateOf(k.last_used_at)}` : ""}`}
            right={
              (passkeys?.length ?? 0) > 1 && (
                <button
                  type="button"
                  aria-label="Remover passkey"
                  className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-danger"
                  onClick={() =>
                    window.confirm(`Remover a passkey "${k.device ?? "Passkey"}"? O aparelho dela não entra mais.`) &&
                    run(() => api.del(`/api/me/passkeys/${encodeURIComponent(k.id)}`), "Passkey removida")
                  }
                >
                  <Trash2 size={16} />
                </button>
              )
            }
          />
        ))}
        {passkeys?.length === 0 && (
          <Row left={<KeyRound size={18} className="text-warn" />} title="Nenhuma passkey" subtitle="Cadastre uma para entrar sem senha" />
        )}
        <Row left={<Plus size={18} className="text-accent" />} title={<span className="text-accent">Cadastrar passkey neste aparelho</span>} onClick={newDevice} />
        <Row
          left={<LogOut size={18} className="text-muted" />}
          title="Sair de todos os aparelhos"
          subtitle="Encerra todas as sessões, inclusive esta"
          onClick={async () => {
            if (!window.confirm("Sair de todos os aparelhos? Você vai precisar entrar de novo em cada um.")) return;
            await api.post("/api/me/logout-all");
            onLogout();
          }}
        />
      </List>
    </Section>
  );
}
