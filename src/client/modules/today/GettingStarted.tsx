import { Bot, Check, CreditCard, Wallet, X } from "lucide-react";
import { useState } from "react";
import type { Account } from "../../../shared/types";
import type { McpTokenInfo } from "../../../shared/users";
import { useSettings } from "../../forms/common";
import { useApp, useData } from "../../state";
import { Card, cx } from "../../ui";

const dismissKey = (userId: number) => `lifeos:primeiros-passos:${userId}`;

/** Primeiros passos de quem acabou de entrar. Some quando tudo estiver feito ou quando a pessoa fechar. */
export function GettingStarted() {
  const { me, navigate } = useApp();
  const accounts = useData<Account[]>("/api/accounts").data;
  const settings = useSettings();
  const tokens = useData<McpTokenInfo[]>("/api/me/mcp-tokens").data;
  const legacy = useData<{ configured: boolean }>("/api/mcp-info").data;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey(me.id)) === "1";
    } catch {
      return false;
    }
  });
  // Só decide depois de carregar tudo (evita piscar para quem já fez os passos)
  if (dismissed || !accounts || !settings || !tokens || !legacy) return null;
  const steps = [
    { done: accounts.length > 0, icon: <CreditCard size={16} />, label: "Cadastre seus cartões e contas" },
    { done: settings.income_cents != null, icon: <Wallet size={16} />, label: "Informe seu salário líquido" },
    { done: tokens.length > 0 || legacy.configured, icon: <Bot size={16} />, label: "Conecte o Claude" },
  ];
  if (steps.every((s) => s.done)) return null;
  const close = () => {
    try {
      localStorage.setItem(dismissKey(me.id), "1");
    } catch {
      // sem armazenamento: só esconde nesta visita
    }
    setDismissed(true);
  };
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">Primeiros passos{me.name ? `, ${me.name.split(" ")[0]}` : ""}</p>
          <p className="text-sm text-muted">Três coisas para o LifeOS ficar com a sua cara.</p>
        </div>
        <button type="button" aria-label="Fechar primeiros passos" onClick={close} className="rounded-full p-1.5 text-muted hover:bg-surface-2">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-1">
        {steps.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => navigate("settings")}
            className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm transition hover:bg-surface-2"
          >
            <span className={cx("flex h-7 w-7 items-center justify-center rounded-full", s.done ? "bg-success text-white" : "bg-surface-2 text-muted")}>
              {s.done ? <Check size={15} strokeWidth={3} /> : s.icon}
            </span>
            <span className={cx("flex-1", s.done && "text-muted line-through")}>{s.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
