import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, fromLocal, isValidDate, isValidLocal, nowIn, startOfWeek, toLocal } from "../../src/shared/datetime";

const SP = "America/Sao_Paulo";
const LISBON = "Europe/Lisbon";

describe("toLocal / nowIn", () => {
  it("converte um instante para o relógio local", () => {
    expect(toLocal(Date.UTC(2026, 9, 11, 12, 0), SP)).toBe("2026-10-11T09:00");
    expect(toLocal(Date.UTC(2026, 9, 12, 2, 59), SP)).toBe("2026-10-11T23:59"); // depois das 21h em UTC ainda é o mesmo dia
    expect(toLocal(Date.UTC(2026, 9, 12, 3, 0), SP)).toBe("2026-10-12T00:00");
    expect(toLocal(Date.UTC(2026, 6, 1, 12, 0), LISBON)).toBe("2026-07-01T13:00");
  });

  it("nowIn devolve data e hora local válida", () => {
    expect(isValidLocal(nowIn(SP))).toBe(true);
  });
});

describe("fromLocal", () => {
  it("horário comum", () => {
    expect(fromLocal("2026-10-11T09:00", SP)).toEqual({ ms: Date.UTC(2026, 9, 11, 12, 0), kind: "ok" });
    expect(fromLocal("2026-12-31T23:30", SP)).toEqual({ ms: Date.UTC(2027, 0, 1, 2, 30), kind: "ok" });
  });

  it("início do horário de verão em São Paulo (04/11/2018): 00:00–00:59 não existiu", () => {
    const r = fromLocal("2018-11-04T00:30", SP);
    expect(r.kind).toBe("nonexistent");
    expect(toLocal(r.ms, SP)).toBe("2018-11-04T01:30");
    expect(fromLocal("2018-11-04T01:00", SP)).toEqual({ ms: Date.UTC(2018, 10, 4, 3, 0), kind: "ok" });
  });

  it("fim do horário de verão em São Paulo (16/02/2019): 23:00–23:59 aconteceu duas vezes", () => {
    expect(fromLocal("2019-02-16T23:30", SP)).toEqual({ ms: Date.UTC(2019, 1, 17, 1, 30), kind: "ambiguous" });
    expect(fromLocal("2019-02-16T22:30", SP)).toEqual({ ms: Date.UTC(2019, 1, 17, 0, 30), kind: "ok" });
  });

  it("outro fuso com horário de verão em vigor (Lisboa, 2026)", () => {
    expect(fromLocal("2026-03-29T01:30", LISBON).kind).toBe("nonexistent");
    expect(fromLocal("2026-10-25T01:30", LISBON)).toEqual({ ms: Date.UTC(2026, 9, 25, 0, 30), kind: "ambiguous" });
  });

  it("ida e volta em todas as meias horas de um ano com horário de verão", () => {
    for (let ms = Date.UTC(2018, 0, 1); ms < Date.UTC(2019, 3, 1); ms += 30 * 60_000) {
      const local = toLocal(ms, SP);
      const back = fromLocal(local, SP);
      // Na hora repetida, o instante devolvido é o da primeira vez
      if (back.kind === "ambiguous") expect(back.ms).toBeLessThanOrEqual(ms);
      else expect(back).toEqual({ ms, kind: "ok" });
    }
  });

  it("recusa datas inválidas no calendário", () => {
    expect(() => fromLocal("2026-02-30T10:00", SP)).toThrow(RangeError);
    expect(() => fromLocal("2026-10-11 09:00", SP)).toThrow(RangeError);
    expect(() => fromLocal("2026-10-11T24:00", SP)).toThrow(RangeError);
  });
});

describe("datas", () => {
  it("isValidDate", () => {
    expect(isValidDate("2028-02-29")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-01")).toBe(false);
  });

  it("addDays atravessa meses e anos", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-10-11", 0)).toBe("2026-10-11");
  });

  it("semana de segunda a domingo", () => {
    expect(dayOfWeek("2026-10-11")).toBe(0); // domingo
    expect(startOfWeek("2026-10-11")).toBe("2026-10-05");
    expect(startOfWeek("2026-10-12")).toBe("2026-10-12");
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28");
  });
});
