import { X } from "lucide-react";
import { useState } from "react";
import {
  formatClock,
  formatDistance,
  formatPlanDuration,
  HAS_DISTANCE,
  isDoneStatus,
  pace,
  parseDistance,
  parseDuration,
  SPORT_LABEL,
  SPORTS,
  type Sport,
  STATUS_LABEL,
  type TrainingSession,
  type TrainingStatus,
  TRANSITIONS,
  WORKOUT_TYPE_LABEL,
  WORKOUT_TYPES,
  type WorkoutType,
} from "../../../shared/training";
import { api } from "../../api";
import { confirmDelete, FormFooter } from "../../forms/common";
import { useApp, useMutation } from "../../state";
import { Button, Chips, Field, TextArea, TextInput } from "../../ui";
import { SportIcon } from "./TrainingRow";

const durationText = (s: number | null, clock: boolean) => (s == null ? "" : clock ? formatClock(s) : formatPlanDuration(s).replace(" min", "").replace(" h ", "h").replace(" h", "h"));
const distanceText = (m: number | null, sport: Sport) => (m == null ? "" : sport === "swim" ? String(m) : (m / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const intOrNull = (v: string) => (v.trim() ? Math.round(Number(v)) || null : null);

export function TrainingForm({ item, defaults, onDone }: { item?: TrainingSession; defaults?: { date?: string }; onDone: () => void }) {
  const { today } = useApp();
  const { run, busy } = useMutation();

  const [sport, setSport] = useState<Sport>(item?.sport ?? "run");
  const [type, setType] = useState<WorkoutType | null>(item?.workout_type ?? null);
  const [title, setTitle] = useState(item?.title ?? "");
  const [date, setDate] = useState(item?.date ?? defaults?.date ?? today);
  const [time, setTime] = useState(item?.time ?? "");
  const [plannedDur, setPlannedDur] = useState(durationText(item?.planned_duration_s ?? null, false));
  const [plannedDist, setPlannedDist] = useState(distanceText(item?.planned_distance_m ?? null, item?.sport ?? "run"));
  const [intensity, setIntensity] = useState(item?.planned_intensity ?? "");
  const [instructions, setInstructions] = useState(item?.instructions ?? "");
  const [status, setStatus] = useState<TrainingStatus>(item?.status ?? "planned");
  const [actualDur, setActualDur] = useState(durationText(item?.actual_duration_s ?? null, true));
  const [actualDist, setActualDist] = useState(distanceText(item?.actual_distance_m ?? null, item?.sport ?? "run"));
  const [avgHr, setAvgHr] = useState(item?.avg_hr ? String(item.avg_hr) : "");
  const [maxHr, setMaxHr] = useState(item?.max_hr ? String(item.max_hr) : "");
  const [rpe, setRpe] = useState<number | null>(item?.rpe ?? null);
  const [notes, setNotes] = useState(item?.notes ?? "");

  const withDistance = HAS_DISTANCE[sport];
  const done = isDoneStatus(status);
  const pDur = parseDuration(plannedDur);
  const pDist = withDistance ? parseDistance(plannedDist, sport) : null;
  const aDur = parseDuration(actualDur);
  const aDist = withDistance ? parseDistance(actualDist, sport) : null;
  const invalid =
    (plannedDur.trim() && pDur == null) ||
    (withDistance && plannedDist.trim() && pDist == null) ||
    (done && actualDur.trim() && aDur == null) ||
    (done && withDistance && actualDist.trim() && aDist == null);
  const statusOptions: TrainingStatus[] = item ? [item.status, ...TRANSITIONS[item.status]] : ["planned", "done"];
  const distUnit = sport === "swim" ? "m" : "km";

  async function save() {
    if (invalid) return;
    const body: Record<string, unknown> = {
      sport,
      workout_type: type,
      title: title.trim() || null,
      date,
      time: time || null,
      planned_duration_s: pDur,
      planned_distance_m: pDist,
      planned_intensity: intensity.trim() || null,
      instructions: instructions.trim() || null,
      status,
      notes: notes.trim() || null,
    };
    if (done) {
      Object.assign(body, {
        actual_duration_s: aDur,
        actual_distance_m: aDist,
        avg_hr: intOrNull(avgHr),
        max_hr: intOrNull(maxHr),
        rpe,
        // Sem nada preenchido, "realizado" usa o que foi planejado
        as_planned: aDur == null && aDist == null,
      });
    }
    const ok = item
      ? await run(() => api.patch(`/api/training/${item.id}`, body), done ? "Treino registrado" : "Treino salvo")
      : await run(() => api.post("/api/training", body), done ? "Treino registrado" : "Treino planejado");
    if (ok) onDone();
  }

  async function remove() {
    if (!item) return;
    if (!confirmDelete("este treino")) return;
    if (await run(() => api.del(`/api/training/${item.id}`), "Treino excluído")) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label="Modalidade">
        <Chips<Sport> options={SPORTS.map((s) => ({ value: s, label: SPORT_LABEL[s], icon: <SportIcon sport={s} size={15} /> }))} value={sport} onChange={setSport} />
      </Field>
      <Field label="Tipo de treino">
        <Chips<WorkoutType | null> options={[{ value: null, label: "—" }, ...WORKOUT_TYPES.map((t) => ({ value: t, label: WORKOUT_TYPE_LABEL[t] }))]} value={type} onChange={setType} />
      </Field>
      <Field label="Título (opcional)" htmlFor="tr-title">
        <TextInput id="tr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Longão, 6x800 m, Treino A" />
      </Field>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <Field label="Dia" htmlFor="tr-date">
          <TextInput id="tr-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </Field>
        <Field label="Horário (opcional)" htmlFor="tr-time">
          <div className="flex items-center gap-1">
            <TextInput id="tr-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className="w-28" />
            {time && (
              <button type="button" aria-label="Sem horário" className="rounded-full p-1 text-muted hover:text-text" onClick={() => setTime("")}>
                <X size={16} />
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="space-y-3 rounded-2xl border border-border p-3">
        <p className="text-sm font-semibold">Planejado</p>
        <div className={withDistance ? "grid grid-cols-2 gap-3" : ""}>
          <Field label="Duração" htmlFor="tr-pdur" hint={pDur ? formatPlanDuration(pDur) : "Minutos ou 1h30"}>
            <TextInput id="tr-pdur" inputMode="text" value={plannedDur} onChange={(e) => setPlannedDur(e.target.value)} placeholder="45" />
          </Field>
          {withDistance && (
            <Field label={`Distância (${distUnit})`} htmlFor="tr-pdist" hint={pDist ? formatDistance(pDist, sport) : undefined}>
              <TextInput id="tr-pdist" inputMode="decimal" value={plannedDist} onChange={(e) => setPlannedDist(e.target.value)} placeholder={sport === "swim" ? "1500" : "10"} />
            </Field>
          )}
        </div>
        <Field label="Intensidade" htmlFor="tr-int">
          <TextInput id="tr-int" value={intensity} onChange={(e) => setIntensity(e.target.value)} placeholder="Ex.: Z2, leve, 5:30/km, RPE 6" />
        </Field>
        <Field label={sport === "strength" ? "Exercícios e séries" : "Instruções"} htmlFor="tr-inst">
          <TextArea
            id="tr-inst"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder={sport === "strength" ? "Ex.: Agachamento 4x10, Supino 4x8…" : "Ex.: 10 min aquecimento, 6x800 m forte, 10 min solto"}
          />
        </Field>
      </div>

      <Field label="Situação">
        <Chips<TrainingStatus>
          options={statusOptions.map((s) => ({ value: s, label: s === "planned" && item && isDoneStatus(item.status) ? "Planejado (desfazer registro)" : STATUS_LABEL[s] }))}
          value={status}
          onChange={setStatus}
          wrap
        />
      </Field>

      {done && (
        <div className="space-y-3 rounded-2xl border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Realizado</p>
            {(pDur || pDist) && (
              <Button
                variant="ghost"
                className="h-8 px-2 text-sm"
                onClick={() => {
                  setActualDur(durationText(pDur, true));
                  setActualDist(distanceText(pDist, sport));
                }}
              >
                Igual ao planejado
              </Button>
            )}
          </div>
          <div className={withDistance ? "grid grid-cols-2 gap-3" : ""}>
            <Field label="Duração" htmlFor="tr-adur" hint={aDur ? formatClock(aDur) : "Ex.: 52:10 ou 1:02:30"}>
              <TextInput id="tr-adur" value={actualDur} onChange={(e) => setActualDur(e.target.value)} placeholder="52:10" />
            </Field>
            {withDistance && (
              <Field label={`Distância (${distUnit})`} htmlFor="tr-adist" hint={pace(aDur, aDist, sport) ?? undefined}>
                <TextInput id="tr-adist" inputMode="decimal" value={actualDist} onChange={(e) => setActualDist(e.target.value)} placeholder={sport === "swim" ? "1500" : "10,2"} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="FC média (bpm)" htmlFor="tr-avg">
              <TextInput id="tr-avg" inputMode="numeric" value={avgHr} onChange={(e) => setAvgHr(e.target.value.replace(/\D/g, ""))} placeholder="Opcional" />
            </Field>
            <Field label="FC máxima (bpm)" htmlFor="tr-max">
              <TextInput id="tr-max" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value.replace(/\D/g, ""))} placeholder="Opcional" />
            </Field>
          </div>
          <Field label="Esforço percebido (1 = muito leve, 10 = máximo)">
            <Chips<number | null> options={[{ value: null, label: "—" }, ...Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))]} value={rpe} onChange={setRpe} />
          </Field>
        </div>
      )}

      <Field label="Observações" htmlFor="tr-notes">
        <TextArea id="tr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={done ? "Como foi o treino?" : "Opcional"} />
      </Field>

      <FormFooter onSave={save} busy={busy} disabled={!!invalid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : done ? "Registrar treino" : "Planejar treino"} />
    </div>
  );
}
