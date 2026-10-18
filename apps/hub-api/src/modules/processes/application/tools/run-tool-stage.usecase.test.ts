// HUB-FR-146 · AC-H44 · D2-05/D2-17 · S12: `settleOf` — byte (không ký tự) > 64 KB ⇒ tool_failed trước JSON.parse; không
// JSON / sai khai báo ⇒ template_invalid; đạt ⇒ .md + fields lọc theo khai báo.
import { describe, expect, it } from "bun:test";
import { runToolStage, settleOf } from "./run-tool-stage.usecase";

const l = { stageName: "T", outputFields: [{ key: "so", type: "number", required: true }] };

describe("settleOf", () => {
  it("HUB-FR-146 · ok ⇒ fields lọc + md", () => {
    const r = settleOf(l, { kind: "ok", text: '{"so":1,"thua":2}' });
    expect(r).toMatchObject({ kind: "ok", fields: { so: 1 } });
  });
  it("HUB-FR-146 · S12 · 'é' × 33000 (< 64 Ki ký tự, > 64 KB) ⇒ tool_failed", () => {
    const text = `{"so":1,"x":"${"é".repeat(33_000)}"}`;
    expect(settleOf(l, { kind: "ok", text })).toEqual({ kind: "decide", reason: "tool_failed" });
  });
  it("HUB-FR-146 · D2-05 · không JSON / thiếu required ⇒ template_invalid; lỗi gọi ⇒ fail (T18-2 quyết thử lại)", () => {
    expect(settleOf(l, { kind: "ok", text: "x" })).toEqual({
      kind: "decide",
      reason: "template_invalid",
    });
    expect(settleOf(l, { kind: "ok", text: "{}" })).toEqual({
      kind: "decide",
      reason: "template_invalid",
    });
    const f = {
      kind: "failed" as const,
      code: "TIMEOUT",
      httpStatus: null,
      sent: true,
      reason: null,
    };
    expect(settleOf(l, f)).toEqual({
      kind: "fail",
      failure: { code: "TIMEOUT", httpStatus: null, sent: true, reason: null },
    });
  });
});

/** T18-2 · runToolStage với UoW giả: đếm lời gọi repo, kiểm thử lại / chặn gọi lại side_effect / audit. */
type Ev = string;
type FakeOpts = {
  sideEffect: boolean;
  res: unknown;
  retryCount?: number;
  realAction?: boolean;
  inputSchemaOk?: boolean;
};
function loadOf(o: FakeOpts) {
  const state = {
    retryCount: o.retryCount ?? 0,
    retryAttempt: o.retryCount ? 1 : null,
    retryRound: o.retryCount ? 1 : null,
    attempt: 1,
    round: 1,
  };
  return {
    stageName: "T",
    toolKey: "k",
    workflowId: "w",
    sideEffect: o.sideEffect,
    // def hợp lệ: tool side_effect chỉ ở stage real_action (PD2-U03) ⇒ mặc định theo sideEffect.
    realAction: o.realAction ?? o.sideEffect,
    inputSchemaOk: o.inputSchemaOk ?? true,
    timeoutS: 60,
    args: {},
    outputFields: [{ key: "so", type: "number", required: true }],
    inputs: new Map(),
    fields: new Map(),
    startedBy: "u",
    usable: true,
    canRun: true,
    switchOn: true,
    wfEnabled: true,
    state,
  };
}
function fakeDeps(o: FakeOpts) {
  const ev: Ev[] = [];
  const load = loadOf(o);
  const r = {
    runs: { lock: async () => ev.push("lockRun") > 0 },
    tools: {
      loadCall: async () => load,
      lockRunning: async () => ev.push("lockRunning") > 0,
      audit: async (x: { status: string; code: string | null }) =>
        void ev.push(`audit:${x.status}:${x.code}`),
      settleOk: async () => void ev.push("ok"),
      decide: async (x: { reason: string }) => void ev.push(`decide:${x.reason}`),
      retried: async () => void ev.push("retried"),
    },
    retry: {
      markWaiting: async (_: string, w: { retryCount: number }) =>
        void ev.push(`wait:${w.retryCount}`),
    },
    timers: {
      countByStageKind: async () => 0,
      insert: async (t: { dueAt: Date }) => void ev.push(`timer:${t.dueAt.toISOString()}`),
    },
  };
  const d = {
    uow: { system: async <T>(_t: string, fn: (x: never) => Promise<T>) => fn(r as never) },
    invoker: { call: async () => o.res },
    clock: { now: () => new Date("2026-11-20T01:00:00.000Z") },
  };
  return { d: d as never, ev };
}
const link = { runId: "r", stageRunId: "s", hubRunId: "h", tenantId: "t" };
const fail = (code: string, sent: boolean, httpStatus: number | null = null) => ({
  kind: "failed",
  code,
  httpStatus,
  sent,
  reason: "upstream",
});

describe("runToolStage · T18-2 lỗi/thử lại/audit [PD2-R05, PD2-R09, D2-13]", () => {
  it("HUB-BR-12 · lỗi tạm chưa gửi (side_effect) ⇒ audit + hẹn retry +30 s, không decide", async () => {
    const { d, ev } = fakeDeps({ sideEffect: true, res: fail("UPSTREAM_ERROR", false) });
    expect(await runToolStage(d, link)).toEqual({ kind: "retry" });
    expect(ev).toEqual([
      "audit:failed:UPSTREAM_ERROR",
      "lockRun",
      "lockRunning",
      "wait:1",
      "timer:2026-11-20T01:00:30.000Z",
      "retried",
    ]);
  });
  it("HUB-BR-12 · S4 · side_effect ĐÃ gửi + lỗi tạm (503) ⇒ tool_failed, 0 hẹn (không gọi lại)", async () => {
    const { d, ev } = fakeDeps({ sideEffect: true, res: fail("UPSTREAM_ERROR", true, 503) });
    expect(await runToolStage(d, link)).toEqual({ kind: "decide", reason: "tool_failed" });
    expect(ev.filter((e) => e.startsWith("timer") || e.startsWith("decide"))).toEqual([
      "decide:tool_failed",
    ]);
  });
  it("HUB-BR-12 · không side_effect, đã 3 lượt ⇒ retry_exhausted", async () => {
    const { d } = fakeDeps({ sideEffect: false, res: fail("TIMEOUT", true), retryCount: 3 });
    expect(await runToolStage(d, link)).toEqual({ kind: "decide", reason: "retry_exhausted" });
  });
  it("HUB-FR-146 · PD2-R09 · ok ⇒ audit ok (không giá trị) rồi settleOk", async () => {
    const { d, ev } = fakeDeps({ sideEffect: false, res: { kind: "ok", text: '{"so":7}' } });
    expect(await runToolStage(d, link)).toMatchObject({ kind: "ok", fields: { so: 7 } });
    expect(ev).toEqual(["audit:ok:null", "lockRun", "lockRunning", "ok"]);
  });
});

describe("runToolStage · security P-d2 M1/m1 — kiểm lại cấu hình workflow lúc chạy [review.md]", () => {
  it("M1/S4 · side_effect bật sau lưu def, stage không real_action ⇒ tool_failed, không gọi (0 audit)", async () => {
    const res = { kind: "ok", text: '{"so":7}' };
    const { d, ev } = fakeDeps({ sideEffect: true, realAction: false, res });
    expect(await runToolStage(d, link)).toEqual({ kind: "decide", reason: "tool_failed" });
    expect(ev).toEqual(["lockRun", "lockRunning", "decide:tool_failed"]);
  });
  it("M1 · side_effect ở stage real_action ⇒ vẫn gọi (ok)", async () => {
    const res = { kind: "ok", text: '{"so":7}' };
    const { d, ev } = fakeDeps({ sideEffect: true, realAction: true, res });
    expect((await runToolStage(d, link)).kind).toBe("ok");
    expect(ev[0]).toBe("audit:ok:null");
  });
  it("m1 · input_schema hỏng ⇒ tool_failed, không gọi (0 audit)", async () => {
    const res = { kind: "ok", text: '{"so":7}' };
    const { d, ev } = fakeDeps({ sideEffect: false, inputSchemaOk: false, res });
    expect(await runToolStage(d, link)).toEqual({ kind: "decide", reason: "tool_failed" });
    expect(ev).toEqual(["lockRun", "lockRunning", "decide:tool_failed"]);
  });
});
