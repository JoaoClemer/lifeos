import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { useApp, useMutation } from "../../state";
import { Avatar, Button, Card, LinkButton } from "../../ui";

/** Abriu um link de conexão (#/conectar/<token>): confirma e conecta com quem mandou. */
export function ConnectView({ token }: { token: string }) {
  const { navigate } = useApp();
  const [from, setFrom] = useState<{ name: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { run, busy } = useMutation();

  useEffect(() => {
    api
      .post<{ name: string | null }>("/api/connections/inspect", { token })
      .then(setFrom)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  async function accept() {
    if (await run(() => api.post("/api/connections/accept", { token }), "Conectados!")) setDone(true);
  }

  return (
    <Card className="mx-auto max-w-md space-y-4 p-6 text-center">
      <span className="inline-flex rounded-2xl bg-accent-soft p-3 text-accent">
        <Link2 size={26} />
      </span>
      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : !from ? (
        <div className="h-16 animate-pulse rounded-xl bg-surface-2" />
      ) : done ? (
        <p className="text-sm">
          Você e <b>{from.name ?? "a pessoa"}</b> estão conectados. Agora vocês podem dividir gastos e compartilhar eventos, listas e metas.
        </p>
      ) : (
        <>
          <div className="flex items-center justify-center gap-3">
            <Avatar name={from.name ?? "?"} />
            <p className="text-lg font-semibold">{from.name ?? "Pessoa"}</p>
          </div>
          <p className="text-sm text-muted">
            quer se conectar com você. Conectados, vocês podem dividir gastos (o que um deve aparece para o outro) e compartilhar eventos, listas
            de tarefas e metas. Nada mais da sua conta fica visível.
          </p>
          <Button className="w-full" disabled={busy} onClick={accept}>
            Conectar
          </Button>
        </>
      )}
      <LinkButton onClick={() => navigate("today")}>Voltar para o início</LinkButton>
    </Card>
  );
}
