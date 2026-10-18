// HUB-FR-144 · AC-H41 · PD-R10/R13/R14 · use case `enterWait` với repo giả (không DB): nguồn field giải theo key stage,
// hẹn ghi theo múi giờ tenant + khoá `n`, ngày không hợp lệ ⇒ `invalid` KHÔNG ghi stage/hẹn.
import { describe, expect, it } from "bun:test";
import type { NewTimer } from "../ports";
import { type EnterWaitIn, type EnterWaitRepos, enterWait } from "./enter-wait.usecase";
import type { WaitSource } from "./wait.ports";

function fakeRepos(base: string | null, expiresAt: Date | null, tz = "Asia/Ho_Chi_Minh") {
  const log: { src: WaitSource[]; waiting: string[]; timers: NewTimer[] } = {
    src: [],
    waiting: [],
    timers: [],
  };
  const r: EnterWaitRepos = {
    wait: {
      loadBase: async (_runId, src) => {
        log.src.push(src);
        return { base, expiresAt };
      },
      markWaiting: async (id) => void log.waiting.push(id),
    },
    tz: { read: async () => tz },
    timers: {
      countByStageKind: async () => log.timers.length,
      insert: async (t) => void log.timers.push(t),
    },
  };
  return { r, log };
}

const IN: EnterWaitIn = {
  runId: "run-1",
  stageRunId: "sr-1",
  round: 1,
  attempt: 2,
  wait: { from: { kind: "field", stageKey: "doc", field: "ngay_het_han" }, offsetDays: -3 },
  stageKeys: ["doc", "cho", "xong"],
  now: new Date("2026-11-01T03:00:00Z"),
};

describe("enterWait [HUB-FR-144][AC-H41]", () => {
  it("PD-R13 · field của stage `doc` (idx 0) ⇒ stage chờ + hẹn 2026-11-17T02:00Z HCM, khoá n = 1", async () => {
    const { r, log } = fakeRepos("2026-11-20", new Date("2026-12-01T03:00:00Z"));
    const out = await enterWait(r, IN);
    expect(out).toEqual({
      kind: "waiting",
      dueAt: new Date("2026-11-17T02:00:00.000Z"),
      timezone: "Asia/Ho_Chi_Minh",
    });
    expect(log.src).toEqual([{ kind: "field", stageIdx: 0, field: "ngay_het_han" }]);
    expect(log.waiting).toEqual(["sr-1"]);
    expect(log.timers).toEqual([
      {
        runId: "run-1",
        stageRunId: "sr-1",
        kind: "wait_until",
        dueAt: new Date("2026-11-17T02:00:00.000Z"),
        key: "wait_until:sr-1:1:2:1",
        timezone: "Asia/Ho_Chi_Minh",
      },
    ]);
  });
});

describe("enterWait · múi giờ + hạn đã qua [TZ-R04][D-PD09]", () => {
  it("TZ-R04 · tenant Europe/Berlin + nguồn input ⇒ 07:00Z (CEST)", async () => {
    const { r, log } = fakeRepos("2026-04-01", null, "Europe/Berlin");
    const out = await enterWait(r, {
      ...IN,
      wait: { from: { kind: "input", key: "han" }, offsetDays: -3, time: "09:00" },
      now: new Date("2026-03-01T03:00:00Z"),
    });
    expect(out).toMatchObject({ kind: "waiting", timezone: "Europe/Berlin" });
    expect(log.timers[0]?.dueAt.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(log.src).toEqual([{ kind: "input", key: "han" }]);
  });

  it("D-PD09 · hạn đã qua ⇒ vẫn ghi hẹn (tới hạn ngay)", async () => {
    const { r, log } = fakeRepos("2026-10-31", null);
    expect(await enterWait(r, IN)).toMatchObject({ kind: "waiting" });
    expect(log.timers[0]?.dueAt.toISOString()).toBe("2026-10-28T02:00:00.000Z");
  });
});

describe("enterWait · ngày không hợp lệ ⇒ invalid [PD-R14]", () => {
  it("PD-R14 · stage nguồn không có trong snapshot ⇒ missing, không đọc DB, không ghi", async () => {
    const { r, log } = fakeRepos("2026-11-20", null);
    const out = await enterWait(r, { ...IN, stageKeys: ["khac"] });
    expect(out).toEqual({ kind: "invalid", why: "missing" });
    expect(log).toEqual({ src: [], waiting: [], timers: [] });
  });

  it("PD-R14 · hạn > expires_at ⇒ after_expiry, không ghi stage/hẹn", async () => {
    const { r, log } = fakeRepos("2026-11-20", new Date("2026-11-08T03:00:00Z"));
    expect(await enterWait(r, IN)).toEqual({ kind: "invalid", why: "after_expiry" });
    expect({ waiting: log.waiting, timers: log.timers }).toEqual({ waiting: [], timers: [] });
  });
});
