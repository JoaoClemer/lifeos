import { CalendarCheck, CalendarX, Link2, MapPin } from "lucide-react";
import type { Occurrence } from "../../../shared/agenda";
import { longDate, timeLabel } from "../../dates";
import { api } from "../../api";
import { useMutation } from "../../state";
import { Badge, Button } from "../../ui";

/** Evento de outra pessoa para o qual você foi convidado(a): só leitura, com aceitar ou recusar. */
export function InvitedEvent({ item, onDone }: { item: Occurrence; onDone: () => void }) {
  const { run, busy } = useMutation();
  const invite = item.invite!;
  const respond = async (status: "accepted" | "declined") =>
    (await run(() => api.post(`/api/events/${item.event_id}/rsvp`, { status }), status === "accepted" ? "Convite aceito" : "Convite recusado")) && onDone();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xl font-bold">{item.title}</p>
        <p className="text-sm text-muted">
          {longDate(item.start_at.slice(0, 10))} · {timeLabel(item)}
          {item.rrule && " · repete"}
        </p>
        <div className="pt-1">
          <Badge tone={invite.status === "accepted" ? "success" : "accent"}>
            convite de {invite.owner_name ?? "pessoa conectada"}
            {invite.status === "accepted" ? " · aceito" : ""}
          </Badge>
        </div>
      </div>
      {item.location && (
        <p className="flex items-center gap-2 text-sm">
          <MapPin size={16} className="text-muted" /> {item.location}
        </p>
      )}
      {item.description && <p className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{item.description}</p>}
      {item.url && (
        <Button variant="secondary" className="w-full" onClick={() => window.open(item.url!, "_blank", "noopener")}>
          <Link2 size={16} /> Abrir link
        </Button>
      )}
      <p className="text-xs text-muted">Só {invite.owner_name ?? "quem criou"} altera este evento.{item.rrule ? " A resposta vale para todas as ocorrências." : ""}</p>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => respond("declined")}>
          <CalendarX size={16} /> Recusar
        </Button>
        {invite.status !== "accepted" && (
          <Button className="flex-1" disabled={busy} onClick={() => respond("accepted")}>
            <CalendarCheck size={16} /> Aceitar
          </Button>
        )}
      </div>
    </div>
  );
}
