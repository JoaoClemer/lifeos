import { Check } from "lucide-react";
import type { Connection } from "../shared/connections";
import { useData } from "./state";
import { cx } from "./ui";

/** Escolha de pessoas conectadas (convidados de evento, membros de lista ou de meta). */
export function PeoplePicker({ value, onChange, empty }: { value: number[]; onChange: (ids: number[]) => void; empty?: string }) {
  const connections = useData<Connection[]>("/api/connections").data;
  if (!connections) return null;
  if (!connections.length) {
    return <p className="text-sm text-muted">{empty ?? "Conecte-se a alguém em Ajustes → Conexões para compartilhar."}</p>;
  }
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {connections.map((c) => {
        const on = value.includes(c.user_id);
        return (
          <button
            key={c.user_id}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(c.user_id)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition",
              on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-text",
            )}
          >
            {on && <Check size={14} strokeWidth={3} />}
            {c.name ?? "Pessoa"}
          </button>
        );
      })}
    </div>
  );
}
