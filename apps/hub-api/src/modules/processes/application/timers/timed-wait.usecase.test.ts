// CR-120 · G3/G4 · `enterTimedWait` + `signalEvent` với repo giả (không DB): hẹn N giờ / hạn sự kiện, sự kiện tới trước ⇒ hẹn tới hạn
// ngay, `signalEvent` thả đúng stage `wait_event` (khoá run → stage → huỷ hẹn → finishWait), run kết thúc/không có ⇒ `no_run`.
import { describe, expect, it } from "bun:test";
import type { NewTimer, TxRepos } from "../ports";
import { enterTimedWait } from "./enter-timed-wait.usecase";
import { signalEvent } from "./signal-event.usecase";

const NOW = new Date("2026-11-05T03:00:00Z");

function fakeEnter(early: boolean) {
  const log: { waiting: string[]; timers: NewTimer[] } = { waiting: [], timers: [] };
  return {
    log,
    r: {
      wait: { markWaiting: async (id: string) => void log.waiting.push(id) },
      tz: { read: async () => "Asia/Ho_Chi_Minh" },
      timers: {
        countByStageKind: async () => log.timers.length,
        insert: async (t: NewTimer) => void log.timers.push(t),
      },
      events: { has: async () => early },
    },
  };
}
const IN = { runId: "r1", stageRunId: "s1", round: 1, attempt: 1, hours: 48, now: NOW };

describe("CR-120 · enterTimedWait", () => {
  it("G3 · wait_for 48 h ⇒ stage chờ + hẹn wait_until due = now + 48 h, khoá n = 1, mũi giờ tenant", async () => {
    const { r, log } = fakeEnter(false);
    const out = await enterTimedWait(r, IN);
    expect(out).toEqual({
      dueAt: new Date("2026-11-07T03:00:00.000Z"),
      timezone: "Asia/Ho_Chi_Minh",
      early: false,
    });
    expect(log.waiting).toEqual(["s1"]);
    expect(log.timers).toEqual([
      {
        runId: "r1",
        stageRunId: "s1",
        kind: "wait_until",
        dueAt: new Date("2026-11-07T03:00:00.000Z"),
        key: "wait_until:s1:1:1:1",
        timezone: "Asia/Ho_Chi_Minh",
      },
    ]);
  });

  it("G4 · wait_event chưa có sự kiện ⇒ hạn = now + timeout_h; đã có ⇒ hẹn tới hạn NGAY (due = now)", async () => {
    const a = await enterTimedWait(fakeEnter(false).r, { ...IN, event: "esign.completed" });
    expect(a.dueAt).toEqual(new Date("2026-11-07T03:00:00.000Z"));
    expect(a.early).toBe(false);
    const b = fakeEnter(true);
    const out = await enterTimedWait(b.r, { ...IN, event: "esign.completed" });
    expect(out.early).toBe(true);
    expect(b.log.timers[0]?.dueAt).toEqual(NOW);
  });
});

function fakeSignal(o: {
  run?: string | null;
  waiting?: string[];
  stage?: string;
  expected?: boolean;
}) {
  const log: string[] = [];
  const r = {
    runs: {
      lock: async () => {
        log.push("lock:run");
        return o.run === null
          ? null
          : { id: "r1", tenantId: "t", status: o.run ?? "waiting_timer" };
      },
    },
    runEvents: {
      expected: async () => o.expected ?? true,
      record: async (_r: string, e: string) => void log.push(`record:${e}`),
      waitingStages: async () => o.waiting ?? [],
    },
    stageTimers: {
      lockStage: async (_r: string, s: string) => {
        log.push(`lock:stage:${s}`);
        return { id: s, status: o.stage ?? "waiting_timer" };
      },
      finishWait: async (_r: string, s: string) => void log.push(`finish:${s}`),
    },
    timers: {
      cancelForRun: async (_r: string, ids: readonly string[] | "all") => {
        log.push(`cancel:${ids === "all" ? "all" : ids.join(",")}`);
        return 1;
      },
    },
  } as unknown as Pick<TxRepos, "runs" | "timers" | "stageTimers" | "runEvents">;
  return { r, log };
}
const SIG = { runId: "r1", event: "esign.completed", now: NOW };

describe("CR-120 · signalEvent", () => {
  it("thả stage chờ: khoá run → ghi sự kiện → khoá stage → huỷ hẹn → finishWait", async () => {
    const { r, log } = fakeSignal({ waiting: ["s4"] });
    expect(await signalEvent(r, SIG)).toEqual({ kind: "ok", released: 1 });
    expect(log).toEqual([
      "lock:run",
      "record:esign.completed",
      "lock:stage:s4",
      "cancel:s4",
      "finish:s4",
    ]);
  });

  it("run không còn stage wait_event đúng khoá (đã qua / không có) ⇒ KHÔNG ghi sự kiện (tránh sự kiện cũ qua bước chờ sau)", async () => {
    const { r, log } = fakeSignal({ expected: false, waiting: [] });
    expect(await signalEvent(r, SIG)).toEqual({ kind: "ok", released: 0 });
    expect(log).toEqual(["lock:run"]);
  });

  it("chưa tới bước chờ ⇒ chỉ ghi sự kiện (released 0)", async () => {
    const { r, log } = fakeSignal({ waiting: [] });
    expect(await signalEvent(r, SIG)).toEqual({ kind: "ok", released: 0 });
    expect(log).toEqual(["lock:run", "record:esign.completed"]);
  });

  it("run không thấy (tenant khác) hoặc đã kết thúc ⇒ no_run, KHÔNG ghi gì", async () => {
    for (const run of [null, "done", "cancelled"] as const) {
      const { r, log } = fakeSignal({ run });
      expect(await signalEvent(r, SIG)).toEqual({ kind: "no_run" });
      expect(log).toEqual(["lock:run"]);
    }
  });

  it("stage đã đổi trạng thái sau khoá ⇒ bỏ qua (không huỷ hẹn, không finishWait)", async () => {
    const { r, log } = fakeSignal({ waiting: ["s4"], stage: "done" });
    expect(await signalEvent(r, SIG)).toEqual({ kind: "ok", released: 0 });
    expect(log).not.toContain("finish:s4");
  });
});
