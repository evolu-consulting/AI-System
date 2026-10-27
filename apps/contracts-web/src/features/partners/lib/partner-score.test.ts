// U3 · R36 · R39 · R44–R46: mức/huy hiệu (MỚI · tạm tính), cờ đỏ tách khỏi điểm, gộp vai, "cần xem lại", top, kiểm sơ bộ cách tính.
import { describe, expect, test } from "bun:test";
import type { PartnerRole, PartnerRow, RepAttentionRow, RepPartnerRow } from "@ai/contracts";
import {
  badgeOf,
  flagsOf,
  fromAttention,
  fromRep,
  partiesOf,
  partnersToReview,
  roleRows,
  scoringIssue,
  topPartners,
  weightSum,
  worstOf,
} from "./partner-score";

const row = (name: string, role: PartnerRole, o: Partial<PartnerRow> = {}): PartnerRow => ({
  party: name.toLowerCase(),
  name,
  role,
  roles: [role],
  score: 85,
  band: "good",
  reason: "",
  event_count: 5,
  adjust: 0,
  contracts: 1,
  ...o,
});
const provisional = (name: string, role: PartnerRole, p: number, o: Partial<PartnerRow> = {}) =>
  row(name, role, {
    score: null,
    band: null,
    provisional: true,
    provisional_score: p,
    event_count: 1,
    ...o,
  });
const flagged = (name: string, role: PartnerRole, o: Partial<PartnerRow> = {}) =>
  row(name, role, { red_flag: true, red_flags: [{ type: "fraud", n: 1 }], ...o });

describe("U3 · huy hiệu", () => {
  test("điểm thường ⇒ mức theo band; có điểm tạm ⇒ MỚI · tạm tính; chưa có việc ⇒ –", () => {
    expect(badgeOf(row("a", "customer"))).toEqual({ level: "good", shown: 85, provisional: false });
    expect(badgeOf(provisional("b", "customer", 20))).toEqual({
      level: "new",
      shown: 20,
      provisional: true,
    });
    expect(badgeOf(row("c", "customer", { score: null, band: null }))).toEqual({
      level: "none",
      shown: null,
      provisional: false,
    });
  });
  test("mức xấu nhất: CHÚ Ý < KHÁ < TỐT < MỚI < chưa có", () => {
    expect(
      worstOf([row("a", "customer"), row("b", "supplier", { band: "watch", score: 50 })]),
    ).toBe("watch");
    expect(worstOf([row("a", "customer"), provisional("b", "supplier", 10)])).toBe("good");
    expect(worstOf([])).toBe("none");
  });
});

describe("U3 · cờ đỏ + gộp vai", () => {
  test("cờ gộp mọi vai, cùng loại cộng số lần", () => {
    const a = flagged("a", "customer", { red_flags: [{ type: "fraud", n: 1 }] });
    const b = flagged("a", "supplier", {
      red_flags: [
        { type: "fraud", n: 2 },
        { type: "no_delivery", n: 1 },
      ],
    });
    expect(flagsOf([a, b])).toEqual([
      { type: "fraud", n: 3 },
      { type: "no_delivery", n: 1 },
    ]);
    expect(flagsOf([row("x", "customer")])).toEqual([]);
  });
  test("roleRows gắn vai theo danh sách nguồn; partiesOf: một dòng mỗi đối tác, cờ đỏ trước, số HĐ", () => {
    const rows = roleRows({
      customer: [row("Beta", "customer"), flagged("Zed", "customer")],
      supplier: [row("Beta", "supplier", { band: "watch", score: 40 })],
    });
    const l = partiesOf(rows, new Map([["beta", 3]]));
    expect(
      l.map((p) => [p.name, p.roles.map((r) => r.role), p.contracts, p.worst, p.red_flag]),
    ).toEqual([
      ["Zed", ["customer"], 0, "good", true],
      ["Beta", ["supplier", "customer"], 3, "watch", false],
    ]);
  });
});

describe("U3 · tổng quan", () => {
  test("cần xem lại = có cờ đỏ (kể cả điểm cao / MỚI) hoặc CHÚ Ý; cờ đỏ trước, điểm thấp trước", () => {
    const rows = [
      row("Beta", "customer", { band: "watch", score: 55 }),
      row("Alpha", "customer"),
      flagged("Gamma", "supplier"),
      provisional("Delta", "customer", 20),
      flagged("Eps", "customer", { score: null, band: null }),
      row("Zeta", "supplier", { band: "watch", score: 30 }),
    ];
    expect(partnersToReview(rows).map((p) => p.name)).toEqual(["Gamma", "Eps", "Zeta", "Beta"]);
    expect(partnersToReview(undefined)).toEqual([]);
  });
  test("top theo vai: nhiều việc trước, tối đa 3, bỏ 0 việc", () => {
    const r = (n: string, role: PartnerRole, e: number) => row(n, role, { event_count: e });
    const rows = [
      r("a", "supplier", 2),
      r("b", "supplier", 9),
      r("c", "supplier", 4),
      r("d", "supplier", 7),
      r("z", "supplier", 0),
      r("e", "customer", 1),
    ];
    expect(topPartners(rows, "supplier").map((p) => p.name)).toEqual(["b", "d", "c"]);
    expect(topPartners(rows, "customer").map((p) => p.name)).toEqual(["e"]);
  });
});

describe("U3 · cách tính điểm", () => {
  const rules = {
    good_from: 80,
    fair_from: 60,
    min_events: 3,
    window_months: 12,
    recency_months: 3,
  };
  test("tổng trọng số tiêu chí bật phải 100; thứ tự mức; khoảng thời gian", () => {
    const cs = [
      { enabled: true, weight: 60 },
      { enabled: true, weight: 40 },
      { enabled: false, weight: 30 },
    ];
    expect(weightSum(cs)).toBe(100);
    expect(scoringIssue(cs, rules)).toBeNull();
    expect(scoringIssue([{ enabled: true, weight: 50 }], rules)).toBe("sum");
    expect(scoringIssue(cs, { ...rules, fair_from: 80 })).toBe("order");
    expect(scoringIssue(cs, { ...rules, min_events: 101 })).toBe("min");
    expect(scoringIssue(cs, { ...rules, recency_months: 13 })).toBe("window");
    expect(scoringIssue(cs, { ...rules, window_months: 0 })).toBe("window");
  });
});

// ---------- REP-v3-ui · engine V2-E ----------
const rep = (o: Partial<RepPartnerRow> = {}): RepPartnerRow => ({
  party: "p1",
  name: "P1",
  role: "supplier",
  score: 90,
  level: "good",
  jobs: 6,
  groups: [],
  ...o,
});

describe("REP-v3-ui · quy đổi dòng V2-E về dòng chung", () => {
  test("TỐT/KHÁ/CHÚ Ý giữ điểm + mức; MỚI có điểm ⇒ MỚI · tạm tính; MỚI không điểm ⇒ –", () => {
    expect(badgeOf(fromRep(rep()))).toEqual({ level: "good", shown: 90, provisional: false });
    expect(badgeOf(fromRep(rep({ score: 72, level: "fair" }))).level).toBe("fair");
    expect(badgeOf(fromRep(rep({ score: 40, level: "watch" }))).level).toBe("watch");
    expect(badgeOf(fromRep(rep({ score: 55, level: "new", jobs: 1 })))).toEqual({
      level: "new",
      shown: 55,
      provisional: true,
    });
    expect(badgeOf(fromRep(rep({ score: null, level: "new", jobs: 0 }))).level).toBe("none");
  });
  test("cờ đỏ tách khỏi điểm: giữ nguyên, không đổi mức; vai bên trả hoa hồng giữ nguyên", () => {
    const r = fromRep(
      rep({ role: "commission_payer", red_flag: true, red_flags: [{ type: "fraud", n: 2 }] }),
    );
    expect(r.role).toBe("commission_payer");
    expect(r.red_flag).toBe(true);
    expect(flagsOf([r])).toEqual([{ type: "fraud", n: 2 }]);
    expect(badgeOf(r).level).toBe("good");
    expect(fromRep(rep()).red_flag).toBe(false);
  });
  test("gộp vai: cờ đỏ lên đầu, vai sắp supplier → customer → commission_payer", () => {
    const rows = [
      fromRep(rep({ party: "a", name: "A", role: "commission_payer" })),
      fromRep(rep({ party: "a", name: "A", role: "customer" })),
      fromRep(
        rep({ party: "b", name: "B", red_flag: true, red_flags: [{ type: "no_delivery", n: 1 }] }),
      ),
    ];
    const l = partiesOf(rows, new Map());
    expect(l.map((p) => p.party)).toEqual(["b", "a"]);
    expect(l[1]?.roles.map((r) => r.role)).toEqual(["customer", "commission_payer"]);
  });
  test("TQ-04: dòng CHÚ Ý mang lý do + số điểm đã giảm", () => {
    const a: RepAttentionRow = {
      ...rep({ score: 70, level: "fair" }),
      reasons: ["drop"],
      before: 76,
      drop: 6,
    };
    const x = fromAttention(a);
    expect(x.reasons).toEqual(["drop"]);
    expect([x.before, x.drop, x.score]).toEqual([76, 6, 70]);
  });
});
