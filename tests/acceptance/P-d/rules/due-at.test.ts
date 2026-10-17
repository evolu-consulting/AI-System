// HUB-FR-144 · HUB-BR-42 · AC-H41 · TZ-R04 · PD-R13/R14/R15 — `domain/timers/due-at.rules.ts` (plan-domain §4.12,
// plan §4.7 thuật toán IANA + DST). test-plan-rules PD-U43…U53. Module vắng ⇒ đỏ "module vắng: …".
import { describe, expect, it } from "bun:test";
import { domainExport, domainFn } from "../_support/modules";

const REL = "timers/due-at.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");
const DAY = 86_400_000;
const HCM = "Asia/Ho_Chi_Minh";
const BER = "Europe/Berlin";
const f = (name: string) => domainFn(REL, name);
const iso = (d: Date) => d.toISOString();

describe("localToUtc — giờ địa phương ⇒ UTC theo IANA [TZ-R04, plan §4.7]", () => {
  it("TZ-R04 · PD-U43 · 2026-11-17 09:00 Asia/Ho_Chi_Minh ⇒ 2026-11-17T02:00:00.000Z", async () => {
    const g = await f("localToUtc");
    expect(iso(g("2026-11-17", "09:00", HCM))).toBe("2026-11-17T02:00:00.000Z");
  });
  it("TZ-R04 · PD-U44 · Berlin DST: 2026-03-29 09:00 ⇒ 07:00Z (CEST); 2026-03-28 09:00 ⇒ 08:00Z (CET)", async () => {
    const g = await f("localToUtc");
    expect(iso(g("2026-03-29", "09:00", BER))).toBe("2026-03-29T07:00:00.000Z");
    expect(iso(g("2026-03-28", "09:00", BER))).toBe("2026-03-28T08:00:00.000Z");
  });
  it("TZ-R04 · PD-U45 · giờ rơi vào khe tiến giờ ⇒ dùng offset TRƯỚC chuyển (Berlin, New York, Sydney)", async () => {
    const g = await f("localToUtc");
    expect(iso(g("2026-03-29", "02:30", BER))).toBe("2026-03-29T01:30:00.000Z");
    expect(iso(g("2026-03-08", "02:30", "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
    expect(iso(g("2026-10-04", "02:30", "Australia/Sydney"))).toBe("2026-10-03T16:30:00.000Z");
  });
  it("TZ-R04 · PD-U46 · giờ lặp lúc lùi giờ ⇒ lần ĐẦU (Berlin, New York, Lord_Howe lệch 30')", async () => {
    const g = await f("localToUtc");
    expect(iso(g("2026-10-25", "02:30", BER))).toBe("2026-10-25T00:30:00.000Z");
    expect(iso(g("2026-11-01", "01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
    expect(iso(g("2026-04-05", "01:45", "Australia/Lord_Howe"))).toBe("2026-04-04T14:45:00.000Z");
  });
});

describe("wallClockOf, addDaysIso [TZ-R04]", () => {
  it("TZ-R04 · PD-U47 · wallClockOf(2026-03-29T01:30Z, Berlin) ⇒ {date:2026-03-29, time:03:30}", async () => {
    const g = await f("wallClockOf");
    expect(g(new Date("2026-03-29T01:30:00.000Z"), BER)).toEqual({
      date: "2026-03-29",
      time: "03:30",
    });
    expect(g(new Date("2026-11-17T02:00:00.000Z"), HCM)).toEqual({
      date: "2026-11-17",
      time: "09:00",
    });
  });
  it("HUB-FR-144 · PD-U48 · addDaysIso qua năm nhuận 2028-02-29, ±365, âm qua đầu tháng", async () => {
    const g = await f("addDaysIso");
    expect(g("2028-02-28", 1)).toBe("2028-02-29");
    expect(g("2027-02-28", 1)).toBe("2027-03-01");
    expect(g("2027-03-01", 365)).toBe("2028-02-29");
    expect(g("2028-02-29", -365)).toBe("2027-03-01");
    expect(g("2026-03-02", -3)).toBe("2026-02-27");
  });
});

type In = {
  base: string | null;
  offsetDays: number;
  time: string;
  tz: string;
  now: Date;
  expiresAt: Date | null;
};
const inp = (o: Partial<In> = {}): In => ({
  base: "2026-11-20",
  offsetDays: -3,
  time: "09:00",
  tz: HCM,
  now: N,
  expiresAt: null,
  ...o,
});

describe("waitDueAt — hạn chờ [HUB-FR-144, PD-R13]", () => {
  it("HUB-FR-144 · AC-H41 · PD-U49 · base 2026-11-20, −3, 09:00, HCM ⇒ {ok:true, dueAt:2026-11-17T02:00Z}", async () => {
    const g = await f("waitDueAt");
    expect(g(inp())).toEqual({ ok: true, dueAt: new Date("2026-11-17T02:00:00.000Z") });
  });
  it("HUB-FR-144 · PD-U50 · base null ⇒ missing; 2026-02-30 ⇒ invalid; quá expiresAt ⇒ after_expiry; quá 730 ngày ⇒ beyond_horizon", async () => {
    const g = await f("waitDueAt");
    expect(g(inp({ base: null }))).toEqual({ ok: false, why: "missing" });
    expect(g(inp({ base: "2026-02-30" }))).toEqual({ ok: false, why: "invalid" });
    const exp = new Date("2026-11-10T00:00:00.000Z");
    expect(g(inp({ expiresAt: exp }))).toEqual({ ok: false, why: "after_expiry" });
    // N + 800 ngày = 2028-12-27 (2026-10-19 → 2028-10-19 = 731 ngày, +69)
    expect(g(inp({ base: "2028-12-27", offsetDays: 0 }))).toEqual({
      ok: false,
      why: "beyond_horizon",
    });
  });
  it("HUB-FR-144 · PD-U51 · biên: dueAt = now + 730 ngày đúng ⇒ ok, +1 phút ⇒ beyond_horizon; dueAt = now − 1 ngày ⇒ ok (tới hạn ngay); dueAt = expiresAt ⇒ ok", async () => {
    const g = await f("waitDueAt");
    const edge = new Date(N.getTime() + 730 * DAY); // 2028-10-18T01:00Z = 08:00 HCM
    expect(iso(edge)).toBe("2028-10-18T01:00:00.000Z");
    expect(g(inp({ base: "2028-10-18", offsetDays: 0, time: "08:00" }))).toEqual({
      ok: true,
      dueAt: edge,
    });
    expect(g(inp({ base: "2028-10-18", offsetDays: 0, time: "08:01" }))).toEqual({
      ok: false,
      why: "beyond_horizon",
    });
    expect(g(inp({ base: "2026-10-18", offsetDays: 0, time: "08:00" }))).toEqual({
      ok: true,
      dueAt: new Date(N.getTime() - DAY),
    });
    const due = new Date("2026-11-17T02:00:00.000Z");
    expect(g(inp({ expiresAt: due }))).toEqual({ ok: true, dueAt: due });
  });
});

describe("Văn bản output stage chờ [PD-R14, PD-R15]", () => {
  it("HUB-FR-144 · PD-U52 · waitedText, WAIT_SKIP_TEXT, waitOutputMd đúng nguyên văn", async () => {
    const text = await f("waitedText");
    const line = text(new Date("2026-11-17T02:00:00.000Z"), HCM);
    expect(line).toBe("Đã chờ tới 2026-11-17 09:00 (Asia/Ho_Chi_Minh).");
    expect(await domainExport(REL, "WAIT_SKIP_TEXT")).toBe("Bỏ chờ theo quyết định.");
    const md = await f("waitOutputMd");
    expect(md("Chờ hạn", line)).toBe(`# Chờ hạn\n\n${line}\n\n## Bàn giao\n${line}\n`);
  });
});

describe("Tất định [CA-R05]", () => {
  it("TZ-R04 · PD-U53 · localToUtc/wallClockOf/waitDueAt không đọc đồng hồ: đổi Date.now giả ⇒ cùng kết quả", async () => {
    const toUtc = await f("localToUtc");
    const wall = await f("wallClockOf");
    const due = await f("waitDueAt");
    const run = () => [
      iso(toUtc("2026-03-29", "02:30", BER)),
      iso(toUtc("2026-10-25", "02:30", BER)),
      wall(new Date("2026-03-29T01:30:00.000Z"), BER),
      due(inp()),
    ];
    const before = run();
    const realNow = Date.now;
    let after: unknown;
    try {
      Date.now = () => 0;
      after = run();
    } finally {
      Date.now = realNow;
    }
    expect(after).toEqual(before);
    expect(before[0]).toBe("2026-03-29T01:30:00.000Z");
  });
});
