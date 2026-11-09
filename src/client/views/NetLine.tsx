import type { NetDebt } from "../../shared/connections";
import { formatBRL } from "../../shared/money";

/** Acerto com uma pessoa conectada: o que ela te deve menos o que você deve a ela (só aparece quando há os dois lados). */
export function NetLine({ name, net }: { name: string; net: NetDebt | undefined }) {
  if (!net || !net.they_owe_cents || !net.i_owe_cents) return null;
  const result =
    net.net_cents > 0 ? `${name} te deve ${formatBRL(net.net_cents)}` : net.net_cents < 0 ? `você deve ${formatBRL(-net.net_cents)}` : "vocês estão quites";
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-border bg-accent-soft px-4 py-2 text-sm text-accent">
      <span className="num">
        Te deve {formatBRL(net.they_owe_cents)} − você deve {formatBRL(net.i_owe_cents)}
      </span>
      <b className="num">Acerto: {result}</b>
    </div>
  );
}
