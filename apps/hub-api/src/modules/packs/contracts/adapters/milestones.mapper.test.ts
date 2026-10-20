// V2-A · KN-04 · 5.4a: mapper mốc — DTO khớp `MilestoneSchema`/`ContractDetailSchema`; giai đoạn từ tóm tắt SQL của danh sách
// (`toProgress`) ≡ giai đoạn từ dãy mốc của chi tiết (`stageOf`) trên cùng dữ liệu.
import { describe, expect, it } from "bun:test";
import { ContractProgressSchema, MilestoneSchema } from "@ai/contracts";
import type { MilestoneRow } from "../application/milestones.ports";
import { milestonesView, toProgress } from "./milestones.mapper";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, o: Partial<MilestoneRow>): MilestoneRow => ({
  id: U(n),
  contract_id: U(99),
  kind: "payment",
  direction: "receive",
  title: null,
  seq: n,
  due_date: "2026-11-01",
  owner: "partner",
  qty: null,
  amount: null,
  status: "open",
  done_at: null,
  fault: null,
  postponed_to: null,
  source: "manual",
  ...o,
});

/** Tóm tắt kiểu SQL của danh sách từ cùng dãy hàng. */
function summary(rows: MilestoneRow[], start: string | null) {
  const req = rows.filter((r) => r.kind !== "renewal" && r.status !== "cancelled");
  const open = rows
    .filter((r) => r.status === "open")
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.seq - b.seq)[0];
  return {
    id: U(99),
    deal: "sell" as const,
    start_date: start,
    n_req: req.length,
    n_req_done: req.filter((r) => r.status === "done").length,
    n_done: rows.filter((r) => r.status === "done").length,
    next: open
      ? {
          id: open.id,
          kind: open.kind,
          direction: open.direction,
          title: open.title,
          due_date: open.due_date,
        }
      : null,
  };
}

describe("V2-A · milestones.mapper", () => {
  it("DTO: loại BA, tên mặc định, số tiền tính (NUMERIC chuỗi ⇒ số), đã xác nhận; khớp schema", () => {
    const v = milestonesView(
      [
        row(1, { kind: "delivery", qty: "12.5000", owner: "ours" }),
        row(2, { amount: null }),
        row(3, { amount: "40", status: "done", done_at: "2026-10-01", fault: "partner" }),
      ],
      { deal: "sell", value: "100", pct: null, fixed: null, start: null, today: "2026-10-20" },
    );
    for (const m of v.milestones) expect(MilestoneSchema.parse(m)).toEqual(m);
    expect(
      v.milestones.map((m) => [m.kind, m.title, m.qty, m.amount, m.amount_effective, m.confirmed]),
    ).toEqual([
      ["delivery", "Giao hàng", 12.5, null, null, false],
      ["collect", "Thu tiền", null, null, 60, false],
      ["collect", "Thu tiền", null, 40, 40, true],
    ]);
    expect([v.stage, v.next_milestone_id]).toEqual(["in_progress", U(1)]);
  });

  it("giai đoạn danh sách (tóm tắt) ≡ giai đoạn chi tiết (dãy mốc) trên mọi ca", () => {
    const cases: [MilestoneRow[], string | null, string][] = [
      [[], null, "2026-10-20"],
      [[], "2026-01-01", "2026-10-20"],
      [[row(1, {}), row(2, { kind: "delivery" })], "2026-12-01", "2026-10-20"],
      [[row(1, {}), row(2, { kind: "delivery" })], "2026-10-01", "2026-10-20"],
      [[row(1, { status: "done" }), row(2, { kind: "renewal" })], null, "2026-10-20"],
      [[row(1, { status: "done" }), row(2, { status: "cancelled" })], "2027-01-01", "2026-10-20"],
      [[row(1, { kind: "renewal", status: "done" })], "2027-01-01", "2026-10-20"],
    ];
    for (const [rows, start, today] of cases) {
      const full = milestonesView(rows, {
        deal: "sell",
        value: 1,
        pct: null,
        fixed: null,
        start,
        today,
      });
      const p = toProgress(summary(rows, start), today);
      expect(ContractProgressSchema.parse(p)).toEqual(p);
      expect([p.stage, p.next?.id ?? null]).toEqual([full.stage, full.next_milestone_id]);
    }
  });
});
