import { Activity, Bike, Dumbbell, Footprints, WavesLadder } from "lucide-react";
import {
  formatClock,
  formatDistance,
  formatPlanDuration,
  isDoneStatus,
  pace,
  SPORT_LABEL,
  type Sport,
  type TrainingSession,
  WORKOUT_TYPE_LABEL,
} from "../../../shared/training";
import { api } from "../../api";
import { relativeDay } from "../../dates";
import { useApp, useMutation } from "../../state";
import { Badge, CheckCircle, cx, Row } from "../../ui";

export function SportIcon({ sport, size = 16 }: { sport: Sport; size?: number }) {
  const Icon = { run: Footprints, bike: Bike, swim: WavesLadder, strength: Dumbbell, other: Activity }[sport];
  return <Icon size={size} aria-hidden />;
}

export function sessionTitle(s: TrainingSession): string {
  return s.title ?? (s.workout_type ? `${SPORT_LABEL[s.sport]} · ${WORKOUT_TYPE_LABEL[s.workout_type]}` : SPORT_LABEL[s.sport]);
}

/** "10 km · 50 min · Z2" */
export function planSummary(s: TrainingSession): string {
  return [
    s.planned_distance_m && formatDistance(s.planned_distance_m, s.sport),
    s.planned_duration_s && formatPlanDuration(s.planned_duration_s),
    s.planned_intensity,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "10,2 km · 52:10 · 5:07/km" */
export function resultSummary(s: TrainingSession): string {
  return [
    s.actual_distance_m && formatDistance(s.actual_distance_m, s.sport),
    s.actual_duration_s && formatClock(s.actual_duration_s),
    pace(s.actual_duration_s, s.actual_distance_m, s.sport),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function TrainingRow({ session: s, showDay }: { session: TrainingSession; showDay?: boolean }) {
  const { today, openSheet } = useApp();
  const { run } = useMutation();
  const done = isDoneStatus(s.status);
  const hasPlan = !!(s.planned_duration_s || s.planned_distance_m);
  const open = () => openSheet({ kind: "training", item: s });
  // Toque no círculo: planejado com metas vira "feito como planejado"; sem metas, abre o formulário para registrar
  const quickDone = () =>
    s.status === "planned" && hasPlan ? run(() => api.patch(`/api/training/${s.id}`, { status: "done", as_planned: true }), "Treino registrado") : open();
  const missed = s.status === "planned" && s.date < today;
  return (
    <Row
      label={sessionTitle(s)}
      left={
        s.status === "skipped" || s.status === "cancelled" ? (
          <span className="flex h-7 w-7 items-center justify-center text-muted">
            <SportIcon sport={s.sport} size={18} />
          </span>
        ) : (
          <CheckCircle checked={done} label={done ? `Ver registro: ${sessionTitle(s)}` : `Registrar: ${sessionTitle(s)}`} onClick={done ? open : quickDone} />
        )
      }
      title={
        <span className={cx("inline-flex items-center gap-1.5", (s.status === "skipped" || s.status === "cancelled") && "text-muted line-through")}>
          {done || s.status === "planned" ? <SportIcon sport={s.sport} size={15} /> : null}
          {sessionTitle(s)}
        </span>
      }
      subtitle={
        <>
          {(showDay || s.time) && (
            <span className="num font-medium text-text/80">
              {showDay && relativeDay(s.date, today)}
              {showDay && s.time && " · "}
              {s.time}
            </span>
          )}
          {done ? <span className="num">{resultSummary(s) || "Registrado"}</span> : planSummary(s) && <span className="num">{planSummary(s)}</span>}
          {done && hasPlan && !s.unplanned && <span className="text-muted/80">plano: {planSummary(s)}</span>}
          {s.status === "partial" && <Badge tone="warn">Parcial</Badge>}
          {s.status === "skipped" && <Badge tone="danger">Não realizado</Badge>}
          {s.status === "cancelled" && <Badge>Cancelado</Badge>}
          {s.unplanned && <Badge>Sem plano</Badge>}
          {missed && <Badge tone="warn">Sem registro</Badge>}
          {s.rpe && <span>esforço {s.rpe}/10</span>}
        </>
      }
      onClick={open}
    />
  );
}
