import { KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { InviteDetails } from "../../shared/users";
import { api } from "../api";
import { Button, Field, LinkButton, TextInput } from "../ui";
import { passkeyError, registerFromLink, supportsPasskeys } from "./passkeys";

/** Link de convite (conta nova) ou de recuperação (nova passkey): a pessoa cadastra a passkey e já entra. */
export function InviteScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<InviteDetails | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .post<InviteDetails>("/api/auth/invite", { token })
      .then((i) => {
        setInfo(i);
        setName(i.name ?? "");
      })
      .catch((e: Error) => setInvalid(e.message));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerFromLink(token, info?.kind === "invite" ? name.trim() : undefined);
      onDone();
    } catch (err) {
      setError(passkeyError(err));
      setBusy(false);
    }
  }

  const admin = info?.invited_by ?? "quem te convidou";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6 py-10">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-3 text-center">
          <span className="inline-flex rounded-2xl bg-accent p-3 text-accent-fg">
            {info?.kind === "recovery" ? <KeyRound size={28} /> : <UserPlus size={28} />}
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{info?.kind === "recovery" ? "Recuperar acesso" : "Bem-vindo(a) ao LifeOS"}</h1>
          {info && (
            <p className="text-sm text-muted">
              {info.kind === "recovery"
                ? `Olá${info.name ? `, ${info.name}` : ""}. Cadastre uma passkey neste aparelho para voltar a entrar.`
                : `${info.invited_by ? `${info.invited_by} te convidou` : "Você foi convidado(a)"} para organizar agenda, tarefas, treinos e finanças.`}
            </p>
          )}
        </div>

        {invalid ? (
          <>
            <p className="rounded-xl bg-danger-soft p-3 text-center text-sm text-danger">{invalid}</p>
            <div className="text-center">
              <LinkButton onClick={onDone}>Ir para o login</LinkButton>
            </div>
          </>
        ) : !info ? (
          <div className="h-32 animate-pulse rounded-2xl bg-surface" aria-busy="true" />
        ) : (
          <>
            {info.kind === "invite" && (
              <>
                <Field label="Seu nome" htmlFor="invite-name">
                  <TextInput id="invite-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={60} />
                </Field>
                <div className="flex gap-3 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
                  <ShieldCheck size={20} className="mt-0.5 shrink-0 text-accent" />
                  <p>
                    Seus dados são só seus: outras pessoas não veem nada, a não ser o que você compartilhar. Como administra o LifeOS, {admin} tem
                    acesso técnico ao banco de dados. Você pode baixar ou excluir seus dados quando quiser, em Ajustes.
                  </p>
                </div>
              </>
            )}
            {!supportsPasskeys() && (
              <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">Este navegador não suporta passkeys. Abra o link no Safari (iPhone) ou no Chrome.</p>
            )}
            {error && <p className="text-center text-sm font-medium text-danger">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || (info.kind === "invite" && !name.trim())}>
              <KeyRound size={18} /> {busy ? "Aguardando o aparelho…" : info.kind === "recovery" ? "Cadastrar passkey" : "Criar minha conta"}
            </Button>
            <p className="text-center text-xs text-muted">
              A passkey fica no seu aparelho (Face ID, digital ou PIN) e sincroniza pela sua conta Apple ou Google. Não há senha para lembrar.
            </p>
          </>
        )}
      </form>
    </div>
  );
}
