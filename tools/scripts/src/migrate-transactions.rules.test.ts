// CR-101 DOC-deals · unit luật thuần của script chuyển G1 → chứng từ: cờ (mặc định chạy thử), bất biến hội tụ / khớp kế hoạch.
import { describe, expect, it } from "bun:test";
import {
  type Applied,
  assertConverged,
  assertMatches,
  type Plan,
  parseFlags,
  report,
} from "./migrate-transactions.rules";

const plan = (o: Partial<Plan> = {}): Plan => ({
  transactions: 2,
  byStatus: { draft: 1, posted: 1, cancelled: 0 },
  ids: ["a", "b"],
  lines: 3,
  obligations: 1,
  stockMoves: 1,
  milestones: 3,
  conflicts: [],
  noCreator: [],
  ...o,
});
const applied = (o: Partial<Applied> = {}): Applied => ({
  contracts: 2,
  items: 3,
  obligations: 1,
  stockMoves: 1,
  milestones: 3,
  milestoneLinks: 1,
  milestoneItems: 1,
  events: 2,
  ...o,
});

describe("migrate-transactions.rules", () => {
  it("parseFlags: mặc định chạy thử; --apply ghi; cần đúng một phạm vi", () => {
    expect(parseFlags(["--tenant", "demo"])).toEqual({
      tenants: ["demo"],
      all: false,
      apply: false,
    });
    expect(parseFlags(["--all", "--apply"])).toEqual({ tenants: [], all: true, apply: true });
    expect(
      parseFlags(["--tenant", "demo", "--tenant", "titi-group-company", "--dry-run"]).tenants,
    ).toEqual(["demo", "titi-group-company"]);
    expect(() => parseFlags([])).toThrow();
    expect(() => parseFlags(["--all", "--tenant", "demo"])).toThrow();
    expect(() => parseFlags(["--tenant", "demo", "--apply", "--dry-run"])).toThrow();
    expect(() => parseFlags(["--tenant", "Bad Key"])).toThrow();
  });

  it("assertMatches / assertConverged: lệch kế hoạch hoặc còn hàng ⇒ huỷ", () => {
    expect(() => assertMatches(plan(), applied())).not.toThrow();
    expect(() => assertMatches(plan(), applied({ items: 2 }))).toThrow();
    const empty = plan({ transactions: 0, obligations: 0, stockMoves: 0, milestones: 0 });
    expect(() => assertConverged(empty)).not.toThrow();
    expect(() => assertConverged(plan())).toThrow();
  });

  it("report: chạy thử ghi rõ không ghi + Câu 7 chỉ báo", () => {
    const lines = report(
      "demo",
      plan(),
      { sure: ["m1"], ambiguous: [{ id: "m2", why: ["source_text"] }] },
      null,
    );
    expect(lines[0]).toContain("CHẠY THỬ");
    expect(lines.join("\n")).toContain("m2 [source_text]");
  });
});
