// REP-v3 · CR-101b (R23, R61, R63, R71): luật thuần — cờ engine (fail-closed), xem trước "N đối tác đổi mức nếu bật" (HD8 vs V2-E),
// cờ đỏ gắn bảng V2-E không đổi điểm, TQ-04 (CHÚ Ý / cờ đỏ / giảm ≥ 3 điểm so với kỳ chốt 3 tháng trước).
import { describe, expect, test } from "bun:test";
import {
  attentionOf,
  flagsByParty,
  periodBefore,
  repEngineOf,
  switchDiff,
  withFlags,
} from "./rep-current.rules";

describe("cờ REPUTATION_ENGINE", () => {
  test("chỉ 'v2e' (không phân biệt hoa/thường, khoảng trắng) bật; vắng/lạ ⇒ hd8", () => {
    expect([" V2E ", "v2e"].map(repEngineOf)).toEqual(["v2e", "v2e"]);
    expect([undefined, null, "", "on", "true", "hd8", "v2"].map(repEngineOf)).toEqual(
      Array(7).fill("hd8"),
    );
  });
});

const h = (party: string, band: "good" | "fair" | "watch" | null, score: number | null = null) => ({
  party,
  name: party,
  score,
  band,
});
type L = "good" | "fair" | "watch" | "new";
type Role = "supplier" | "customer" | "commission_payer";
const v = (party: string, role: Role, level: L, score: number | null = null) => ({
  party,
  name: party,
  role,
  score,
  level,
});

describe("xem trước bật V2-E (switchDiff)", () => {
  test("đếm đổi mức theo (đối tác, vai); thiếu một phía ⇒ new; bên trả HH so với Khách HD8", () => {
    const r = switchDiff(
      {
        customer: [h("A", "good", 90), h("C", "fair", 75)],
        supplier: [h("B", null), h("D", "watch", 50)],
      },
      [
        v("A", "customer", "good", 88), // giữ
        v("A", "commission_payer", "fair", 72), // HD8 khách A good ⇒ fair: đổi
        v("B", "supplier", "good", 95), // new ⇒ good
        v("E", "supplier", "new"), // không ở HD8 ⇒ new = new: giữ
      ],
    );
    // C khách (fair ⇒ new) + D NCC (watch ⇒ new) không có ở V2-E ⇒ new.
    expect([r.total, r.changed, r.partners]).toEqual([6, 4, 4]);
    expect(r.items.map((i) => `${i.party}:${i.role}:${i.hd8.level}>${i.v2e.level}`)).toEqual([
      "A:commission_payer:good>fair",
      "B:supplier:new>good",
      "C:customer:fair>new",
      "D:supplier:watch>new",
    ]);
    expect(r.moves.reduce((s, m) => s + m.n, 0)).toBe(4);
  });
  test("không có gì ⇒ 0", () => {
    expect(switchDiff({ customer: [], supplier: [] }, [])).toEqual({
      total: 0,
      changed: 0,
      partners: 0,
      moves: [],
      items: [],
    });
  });
});

describe("cờ đỏ U2 trên bảng V2-E", () => {
  test("gom theo đối tác, bỏ loại lạ / n ≤ 0; không đổi điểm, mức", () => {
    const f = flagsByParty([
      ["A", "fraud", 1],
      ["A", "no_delivery", 2],
      ["B", "late", 3],
      ["C", "fraud", 0],
    ]);
    expect([...f.keys()]).toEqual(["A"]);
    const rows = withFlags([v("A", "supplier", "good", 90), v("B", "customer", "fair", 75)], f);
    expect(rows.map((r) => [r.party, r.score, r.level, r.red_flag, r.red_flags?.length])).toEqual([
      ["A", 90, "good", true, 2],
      ["B", 75, "fair", false, undefined],
    ]);
  });
});

describe("TQ-04 đối tác cần xem lại (R71)", () => {
  test("CHÚ Ý, cờ đỏ, hoặc giảm ≥ 3 điểm so với kỳ chốt; cờ đỏ lên đầu", () => {
    const rows = withFlags(
      [
        v("A", "supplier", "good", 90), // giảm 2 ⇒ không
        v("B", "supplier", "good", 86), // giảm 3 ⇒ có
        v("C", "customer", "watch", 60), // CHÚ Ý
        v("D", "customer", "good", 95), // cờ đỏ
        v("E", "customer", "fair", null), // không điểm ⇒ không giảm
      ],
      flagsByParty([["D", "fraud", 1]]),
    );
    const before = new Map([
      ["A\u0001supplier", 92],
      ["B\u0001supplier", 89],
      ["E\u0001customer", 99],
    ]);
    const out = attentionOf(rows, before);
    expect(out.map((r) => [r.party, r.reasons.join("+"), r.drop])).toEqual([
      ["D", "red_flag", null],
      ["B", "drop", 3],
      ["C", "watch", null],
    ]);
  });
  test("kỳ chốt 3 tháng trước (qua năm)", () => {
    expect(periodBefore("2026-02-15", 3)).toBe("2025-11-01");
    expect(periodBefore("2026-10-27", 3)).toBe("2026-07-01");
  });
});
