import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../ui";

/** Link para copiar (e compartilhar, no celular). */
export function CopyField({ value, shareText }: { value: string; shareText?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copie o link:", value);
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 pl-3">
      <code className="min-w-0 flex-1 truncate text-xs">{value}</code>
      {shareText && typeof navigator.share === "function" && (
        <Button
          variant="secondary"
          className="h-9 shrink-0 px-3 text-sm"
          aria-label="Compartilhar"
          onClick={() => navigator.share({ text: shareText, url: value }).catch(() => {})}
        >
          <Share2 size={16} />
        </Button>
      )}
      <Button variant="secondary" className="h-9 shrink-0 px-3 text-sm" onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

/** "2026-10-26 18:03:00" (UTC, do banco) -> "26/10/2026". */
export function dateOf(sqlDateTime: string | null): string {
  if (!sqlDateTime) return "—";
  const d = new Date(`${sqlDateTime.replace(" ", "T")}Z`);
  return d.toLocaleDateString("pt-BR");
}
