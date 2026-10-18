// HUB-FR-144 · PD-R11/R12 · T8b: `fireTimer` khoá run → stage → timer, kiểm lại sau khoá, hành động theo `fireAction`;
// `cancelTimers` "all" / quay lại chỉ stage bước ≥ đích (0 câu khi không có stage nào). Repo giả ghi nhật ký lời gọi.
import { describe, expect, it } from "bun:test";
import type { StageRunStatus, Timer } from "../../domain/types";
import type { TxRepos } from "../ports";
import { cancelTimers } from "./cancel-timers.usecase";
import { fireTimer } from "./fire-timer.usecase";

const NOW = new Date("2026-11-17T02:00:00Z");
const C = { id: "t1", runId: "r1", stageRunId: "s1" };

type FakeOpts = {
  run?: string | null;
  stage?: StageRunStatus | null;
  timer?: Partial<Timer> | null;
};

const timerOf = (t: Partial<Timer> | null | undefined): (Timer & { timezone: string }) | null =>
  t === null
    ? null
    : {
        id: "t1",
        tenantId: "x",
        runId: "r1",
        stageRunId: "s1",
        kind: "retry",
        dueAt: NOW,
        firedAt: null,
        cancelledAt: null,
        timezone: "Asia/Ho_Chi_Minh",
        ...t,
      };

function fake(o: FakeOpts) {
  const log: string[] = [];
  const timer = timerOf(o.timer);
  const r = {
    runs: {
      lock: async () => {
        log.push("lock:run");
        return o.run === null ? null : { id: "r1", tenantId: "x", status: o.run ?? "running" };
      },
    },
    stageTimers: {
      lockStage: async () => {
        log.push("lock:stage");
        return o.stage === null ? null : { id: "s1", status: o.stage ?? "waiting_timer" };
      },
      requeue: async () => void log.push("requeue"),
      finishWait: async (_r: string, _s: string, w: { timezone: string }) =>
        void log.push(`finish:${w.timezone}`),
    },
    timers: {
      lockById: async () => {
        log.push("lock:timer");
        return timer;
      },
      markFired: async () => {
        log.push("fired");
        return true;
      },
      cancelForRun: async (_r: string, ids: readonly string[] | "all") => {
        log.push(`cancel:${ids === "all" ? "all" : ids.join(",")}`);
        return 1;
      },
    },
    kicker: { kick: () => void log.push("kick") },
  } as unknown as Pick<TxRepos, "runs" | "timers" | "stageTimers" | "kicker">;
  return { r, log };
}

describe("T8b · fireTimer [PD-R11]", () => {
  it("retry tới hạn ⇒ khoá run → stage → timer, fired, requeue, kick", async () => {
    const { r, log } = fake({});
    expect(await fireTimer(r, C, NOW)).toBe("fired");
    expect(log).toEqual(["lock:run", "lock:stage", "lock:timer", "fired", "requeue", "kick"]);
  });
  it("wait_until tới hạn ⇒ finishWait theo múi giờ đã chốt trên hẹn", async () => {
    const { r, log } = fake({ timer: { kind: "wait_until" } });
    expect(await fireTimer(r, C, NOW)).toBe("fired");
    expect(log.slice(3)).toEqual(["fired", "finish:Asia/Ho_Chi_Minh"]);
  });
  it("đã huỷ/đã bắn sau khoá ⇒ skipped, không ghi", async () => {
    for (const timer of [{ cancelledAt: NOW }, { firedAt: NOW }, null]) {
      const { r, log } = fake({ timer });
      expect(await fireTimer(r, C, NOW)).toBe("skipped");
      expect(log).toEqual(["lock:run", "lock:stage", "lock:timer"]);
    }
  });
  it("run kết thúc / stage đã đổi ⇒ dropped (cancelled_at stage đó), không kick", async () => {
    for (const o of [{ run: "cancelled" }, { stage: "running" as const }, { stage: null }]) {
      const { r, log } = fake(o);
      expect(await fireTimer(r, C, NOW)).toBe("dropped");
      expect(log.at(-1)).toBe("cancel:s1");
      expect(log).not.toContain("kick");
    }
  });
  it("run không thấy (tenant khác) ⇒ skipped trước khi khoá stage/timer", async () => {
    const { r, log } = fake({ run: null });
    expect(await fireTimer(r, C, NOW)).toBe("skipped");
    expect(log).toEqual(["lock:run"]);
  });
});

describe("T8b · cancelTimers [PD-R12]", () => {
  const stages = [
    { stageRunId: "a", step: 0 },
    { stageRunId: "b", step: 1 },
    { stageRunId: "c", step: 2 },
  ];
  it("all ⇒ mọi stage; quay lại bước 1 ⇒ stage bước ≥ 1; không stage nào ⇒ 0 câu", async () => {
    const { r, log } = fake({});
    await cancelTimers(r, "r1", { kind: "all" }, NOW);
    await cancelTimers(r, "r1", { kind: "back", stages, toStep: 1 }, NOW);
    expect(await cancelTimers(r, "r1", { kind: "back", stages, toStep: 3 }, NOW)).toBe(0);
    expect(log).toEqual(["cancel:all", "cancel:b,c"]);
  });
});
