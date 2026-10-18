import { describe, expect, test } from "bun:test";
import type { HistoryItem } from "@ai/contracts/chat";
import { detailOf } from "./RunLog";

const t = (k: string, o?: Record<string, string | number>) => `${k}|${o?.step}|${o?.rule}`;
const base = { at: "2026-10-18T00:00:00.000Z", task_id: null, stage_idx: 0, actor: null };

describe("RunLog detailOf (Rẽ nhánh)", () => {
  test("branch: to_step 0-based hiển thị +1, kèm số luật", () => {
    const h = { ...base, kind: "branch", to_step: 3, rule: 2 } as HistoryItem;
    expect(detailOf(h, t)).toBe("process.admin.run.log.branchDetail|4|2");
  });
  test("kind khác: chỉ nối feedback/note", () => {
    const h = { ...base, kind: "review", feedback: "ok", note: "n" } as HistoryItem;
    expect(detailOf(h, t)).toBe("ok · n");
  });
});
