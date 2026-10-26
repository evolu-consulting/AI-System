// CR-097 U2 · R36 · R39: luật thuần — "MỚI · tạm tính" (provisional) và cờ đỏ (severe) của engine điểm; cờ tách khỏi điểm.
import { describe, expect, test } from "bun:test";
import { addDays } from "./local-time.rules";
import { redFlagsOf } from "./partners.rules";
import { type Ev, score } from "./scoring.rules";
import { addGroup, aggregate, emptyAgg, isSevere, windowOf } from "./scoring-agg.rules";
import { defaultConfig } from "./scoring-config.rules";

const TODAY = "2026-10-13";
const ev = (type: string, daysAgo: number, kw: Partial<Ev> = {}): Ev => ({
  type,
  at: addDays(TODAY, -daysAgo),
  voided: false,
  ...kw,
});
const cfg = defaultConfig("customer");
const at = { today: TODAY, role: "customer" as const };
const recv = (n: number) =>
  Array.from({ length: n }, (_, i) => ev("received", 5 + 10 * i, { days_late: 0 }));

describe("R36 · MỚI · tạm tính (min_events mặc định 3)", () => {
  test("0 việc ⇒ không điểm, không tạm", () => {
    const s = score([], cfg, at);
    expect([s.score, s.provisional, s.provisional_score]).toEqual([null, false, null]);
  });
  test("1 và 2 việc ⇒ score null + provisional + điểm tạm (đúng công thức)", () => {
    for (const n of [1, 2]) {
      const s = score(recv(n), cfg, at);
      expect([s.score, s.provisional, s.provisional_score, s.event_count]).toEqual([
        null,
        true,
        100,
        n,
      ]);
    }
  });
  test("đủ min_events ⇒ điểm thường, hết tạm", () => {
    const s = score(recv(3), cfg, at);
    expect([s.score, s.provisional, s.provisional_score]).toEqual([100, false, null]);
  });
  test("chỉ có việc không tính điểm (cờ/chỉnh tay) ⇒ không tạm", () => {
    const s = score([ev("fraud", 1, {})], cfg, at);
    expect([s.score, s.provisional, s.event_count]).toEqual([null, false, 0]);
  });
});

describe("R39 · cờ đỏ tách khỏi điểm", () => {
  const win = windowOf(cfg.rules, TODAY);
  test("loại nghiêm trọng: no_delivery, fraud", () => {
    expect([isSevere("fraud"), isSevere("no_delivery"), isSevere("complaint")]).toEqual([
      true,
      true,
      false,
    ]);
  });
  test("không đổi điểm và không tính vào event_count", () => {
    const base = score(recv(4), cfg, at);
    const flagged = score([...recv(4), ev("fraud", 2), ev("no_delivery", 3)], cfg, at);
    expect([flagged.score, flagged.event_count]).toEqual([base.score, base.event_count]);
  });
  test("aggregate đếm dòng chưa huỷ trong khoảng tính; dòng huỷ / ngoài khoảng bị bỏ", () => {
    const a = aggregate(
      [ev("fraud", 2), ev("fraud", 3, { voided: true }), ev("no_delivery", 400)],
      win,
      "customer",
    );
    expect(a.severe).toEqual({ fraud: 1 });
  });
  test("addGroup (đường SQL) ≡ aggregate (đường từng dòng)", () => {
    const g = emptyAgg();
    addGroup(g, { type: "fraud", nw: true, n: 2, on: 0, late: 0, delta: 0 }, "customer");
    addGroup(g, { type: "no_delivery", nw: false, n: 1, on: 0, late: 0, delta: 0 }, "customer");
    const a = aggregate([ev("fraud", 1), ev("fraud", 2), ev("no_delivery", 200)], win, "customer");
    expect(g.severe).toEqual(a.severe);
    expect(g.counted).toBe(0);
  });
  test("redFlagsOf cộng hai vai của đối tác", () => {
    const a = emptyAgg();
    a.severe = { fraud: 1 };
    const b = emptyAgg();
    b.severe = { fraud: 1, no_delivery: 2 };
    const m = new Map([
      ["customer|p", a],
      ["supplier|p", b],
    ]);
    expect(redFlagsOf(m, "p")).toEqual([
      { type: "no_delivery", n: 2 },
      { type: "fraud", n: 2 },
    ]);
    expect(redFlagsOf(m, "q")).toEqual([]);
  });
});
