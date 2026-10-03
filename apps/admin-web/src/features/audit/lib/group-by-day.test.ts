// ADM-FR-51 · test nhóm theo ngày và nhãn ngày.
import { describe, expect, test } from "bun:test";
import type { AuditItem } from "@ai/contracts";
import { dayLabel, groupByDay } from "./group-by-day";

const at = (h: number, d = 3) => new Date(2026, 9, d, h, 0).toISOString();
const item = (id: string, when: string) => ({ id, at: when }) as unknown as AuditItem;

describe("groupByDay", () => {
  test("gom theo ngày, giữ thứ tự", () => {
    const g = groupByDay([item("a", at(10)), item("b", at(9)), item("c", at(20, 2))]);
    expect(g.map((x) => [x.day, x.items.length])).toEqual([
      ["2026-10-03", 2],
      ["2026-10-02", 1],
    ]);
  });
  test("nhãn ngày", () => {
    const now = new Date(2026, 9, 3, 12);
    expect(dayLabel("2026-10-03", now)).toBe("today");
    expect(dayLabel("2026-10-02", now)).toBe("yesterday");
    expect(dayLabel("2026-09-28", now)).toBe("28/09/2026");
  });
});
