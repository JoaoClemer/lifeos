import { Link2, MapPin, Repeat, Users } from "lucide-react";
import type { AgendaItem } from "../../../shared/agenda";
import { relativeDay, timeLabel } from "../../dates";
import { useApp } from "../../state";
import { Badge, CheckCircle, cx, Row } from "../../ui";
import { useToggleTask } from "../tasks/TaskRow";

export type EventItem = Extract<AgendaItem, { kind: "event" }>;

/** Cor do evento (nome da paleta) como valor CSS; sem cor usa o destaque do app. */
export const eventColor = (color: string | null) => (color ? `var(--ev-${color})` : "var(--accent)");

/** `day`: dia mostrado (para eventos que começaram antes); `showDay`: inclui o dia no texto (listas de vários dias). */
export function EventRow({ item, day, showDay }: { item: EventItem; day?: string; showDay?: boolean }) {
  const { today, openSheet } = useApp();
  const toggle = useToggleTask();
  const done = item.task?.status === "done";
  return (
    <Row
      label={item.title}
      left={
        item.task ? (
          <CheckCircle checked={done} label={done ? `Reabrir: ${item.task.title}` : `Concluir: ${item.task.title}`} onClick={() => toggle(item.task!)} />
        ) : (
          <span className="h-9 w-1.5 rounded-full" style={{ background: eventColor(item.color) }} aria-hidden />
        )
      }
      title={<span className={cx(done && "text-muted line-through")}>{item.title}</span>}
      subtitle={
        <>
          <span className="num font-medium text-text/80">
            {showDay && `${relativeDay(item.start_at.slice(0, 10), today)} · `}
            {timeLabel(item, day)}
          </span>
          {item.rrule && <Repeat size={13} aria-label="Repete" />}
          {item.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin size={13} /> <span className="truncate">{item.location}</span>
            </span>
          )}
          {item.url && <Link2 size={13} aria-label="Tem link" />}
          {item.category && <span>{item.category}</span>}
          {item.task && <Badge tone="accent">Tarefa</Badge>}
          {item.invite && (
            <Badge tone={item.invite.status === "accepted" ? "neutral" : "accent"}>
              {item.invite.status === "accepted" ? `de ${item.invite.owner_name ?? "pessoa"}` : `convite de ${item.invite.owner_name ?? "pessoa"}`}
            </Badge>
          )}
          {item.participants > 0 && (
            <span className="inline-flex items-center gap-1" aria-label={`${item.participants} convidado(s)`}>
              <Users size={13} /> {item.participants}
            </span>
          )}
        </>
      }
      onClick={() => openSheet({ kind: "event", item })}
    />
  );
}
