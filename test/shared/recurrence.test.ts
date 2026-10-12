import { describe, expect, it } from "vitest";
import { addDays } from "../../src/shared/datetime";
import { countBefore, describeRRule, formatRRule, isOccurrence, nextDateAfter, occurrences, parseRRule, type RRule } from "../../src/shared/recurrence";

const all = (start: string, rule: string, from: string, to: string) => occurrences(start, parseRRule(rule), from, to);

describe("parseRRule / formatRRule", () => {
  it("lê e escreve a forma canônica", () => {
    const r = parseRRule("RRULE:freq=weekly;interval=2;byday=WE,MO;until=20261231");
    expect(r).toEqual({ freq: "WEEKLY", interval: 2, byday: ["MO", "WE"], until: "2026-12-31" });
    expect(formatRRule(r)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231");
    expect(formatRRule(parseRRule("FREQ=DAILY;COUNT=5"))).toBe("FREQ=DAILY;COUNT=5");
  });

  it.each([
    ["", "FREQ"],
    ["FREQ=HOURLY", "FREQ"],
    ["FREQ=DAILY;INTERVAL=0", "INTERVAL"],
    ["FREQ=DAILY;BYDAY=MO", "BYDAY"],
    ["FREQ=WEEKLY;BYDAY=XX", "BYDAY"],
    ["FREQ=DAILY;COUNT=3;UNTIL=20261231", "COUNT ou UNTIL"],
    ["FREQ=MONTHLY;BYMONTHDAY=1", "BYMONTHDAY"],
  ])("recusa %j", (text, message) => {
    expect(() => parseRRule(text)).toThrow(message);
  });
});

describe("describeRRule e nextDateAfter", () => {
  it("descreve em português", () => {
    expect(describeRRule(parseRRule("FREQ=DAILY"))).toBe("todo dia");
    expect(describeRRule(parseRRule("FREQ=DAILY;INTERVAL=3"))).toBe("a cada 3 dias");
    expect(describeRRule(parseRRule("FREQ=WEEKLY;BYDAY=WE,MO"))).toBe("toda semana (seg, qua)");
    expect(describeRRule(parseRRule("FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231"))).toBe("a cada 2 semanas até 31/12/2026");
    expect(describeRRule(parseRRule("FREQ=MONTHLY"), "2026-10-05")).toBe("todo mês no dia 5");
    expect(describeRRule(parseRRule("FREQ=YEARLY;COUNT=3"), "2026-03-15")).toBe("todo ano em 15/03, 3 vezes");
  });

  it("próxima data depois de um dia", () => {
    expect(nextDateAfter("2026-10-12", parseRRule("FREQ=WEEKLY;BYDAY=MO,TH"), "2026-10-12")).toBe("2026-10-15");
    expect(nextDateAfter("2026-01-31", parseRRule("FREQ=MONTHLY"), "2026-01-31")).toBe("2026-03-31");
    expect(nextDateAfter("2026-10-15", parseRRule("FREQ=DAILY;UNTIL=20261015"), "2026-10-15")).toBeNull();
  });
});

describe("occurrences", () => {
  it("diária com intervalo e quantidade", () => {
    expect(all("2026-10-01T08:00", "FREQ=DAILY;INTERVAL=2;COUNT=4", "2026-09-01T00:00", "2027-01-01T00:00")).toEqual([
      "2026-10-01T08:00",
      "2026-10-03T08:00",
      "2026-10-05T08:00",
      "2026-10-07T08:00",
    ]);
  });

  it("semanal em vários dias, só dentro da janela [from, to)", () => {
    expect(all("2026-10-05T19:00", "FREQ=WEEKLY;BYDAY=MO,WE,FR", "2026-10-07T00:00", "2026-10-13T00:00")).toEqual([
      "2026-10-07T19:00",
      "2026-10-09T19:00",
      "2026-10-12T19:00",
    ]);
  });

  it("semanal começando no meio da semana não volta para antes do início", () => {
    // Início numa quarta: a segunda daquela semana não conta
    expect(all("2026-10-07T07:00", "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3", "2026-10-01T00:00", "2026-11-01T00:00")).toEqual([
      "2026-10-07T07:00",
      "2026-10-12T07:00",
      "2026-10-14T07:00",
    ]);
  });

  it("quinzenal até uma data (inclusive)", () => {
    expect(all("2026-10-06T10:00", "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261103", "2026-10-01T00:00", "2027-01-01T00:00")).toEqual([
      "2026-10-06T10:00",
      "2026-10-20T10:00",
      "2026-11-03T10:00",
    ]);
  });

  it("mensal no dia 31 pula os meses sem dia 31", () => {
    expect(all("2026-08-31T09:00", "FREQ=MONTHLY;COUNT=4", "2026-01-01T00:00", "2028-01-01T00:00")).toEqual([
      "2026-08-31T09:00",
      "2026-10-31T09:00",
      "2026-12-31T09:00",
      "2027-01-31T09:00",
    ]);
  });

  it("anual em 29 de fevereiro só nos anos bissextos", () => {
    expect(all("2024-02-29T00:00", "FREQ=YEARLY", "2024-01-01T00:00", "2033-01-01T00:00")).toEqual([
      "2024-02-29T00:00",
      "2028-02-29T00:00",
      "2032-02-29T00:00",
    ]);
  });

  it("pular direto para a janela dá o mesmo resultado que percorrer a série do início", () => {
    const cases: [string, RRule][] = [
      ["2025-01-01T06:30", { freq: "DAILY", interval: 3, count: 200 }],
      ["2025-01-01T06:30", { freq: "DAILY", interval: 1 }],
      ["2025-03-05T18:00", { freq: "WEEKLY", interval: 2, byday: ["MO", "WE", "SA"], count: 150 }],
      ["2025-03-05T18:00", { freq: "WEEKLY", interval: 1, byday: ["SU"] }],
      ["2025-03-05T18:00", { freq: "WEEKLY", interval: 3 }],
    ];
    for (const [start, rule] of cases) {
      const everything = occurrences(start, rule, start, "2027-12-31T00:00", 100_000);
      for (const from of ["2025-06-10", "2026-01-01", "2026-10-11", "2027-07-04"]) {
        const to = addDays(from, 45);
        const expected = everything.filter((o) => o >= `${from}T00:00` && o < `${to}T00:00`);
        expect(occurrences(start, rule, `${from}T00:00`, `${to}T00:00`), `${JSON.stringify(rule)} ${from}`).toEqual(expected);
      }
    }
  });

  it("isOccurrence e countBefore", () => {
    const r = parseRRule("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(isOccurrence("2026-10-06T10:00", r, "2026-10-15T10:00")).toBe(true);
    expect(isOccurrence("2026-10-06T10:00", r, "2026-10-15T11:00")).toBe(false);
    expect(isOccurrence("2026-10-06T10:00", r, "2026-10-14T10:00")).toBe(false);
    expect(countBefore("2026-10-06T10:00", r, "2026-10-15T10:00")).toBe(3);
  });
});
