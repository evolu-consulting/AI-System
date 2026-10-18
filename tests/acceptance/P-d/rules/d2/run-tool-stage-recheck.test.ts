// AC-H47 · HUB-FR-146 · security P-d2 M1/S4 (review.md "Security P-d2") · test-plan-d2 §3.6b PD2-U30: use case lớp 2
// `runToolStage` với cổng GIẢ — `side_effect` của workflow bật sau khi def lưu (tải `sideEffect:true`) mà stage KHÔNG
// `real_action` (tải `realAction:false`) ⇒ `tool_failed`, 0 lời gọi (preCallReason). Nạp qua `layerFn` như run-tool-stage.test.ts.
import { describe, expect, it } from "bun:test";
import { layerFn } from "../../_support/modules";

const TEN = "d2a00000-0000-4000-8000-000000000001";
const LINK = {
  runId: "d2a00000-0000-4000-8000-000000000011",
  stageRunId: "d2a00000-0000-4000-8000-000000000012",
  hubRunId: "d2a00000-0000-4000-8000-000000000013",
  tenantId: TEN,
};
type Load = Record<string, unknown>;
const load = (o: Load): Load => ({
  stageName: "Xuất HĐ",
  toolKey: "xuat-hoa-don",
  workflowId: "d2a00000-0000-4000-8000-000000000021",
  sideEffect: false,
  timeoutS: 60,
  args: { ma_kh: { from: "input", key: "ma-kh" } },
  outputFields: [{ key: "so_hd", type: "string", required: true }],
  inputs: new Map([["ma-kh", "KH1"]]),
  fields: new Map(),
  startedBy: "d2a00000-0000-4000-8000-000000000031",
  usable: true,
  canRun: true,
  switchOn: true,
  wfEnabled: true,
  state: { retryCount: 0, retryAttempt: null, retryRound: null, attempt: 1, round: 1 },
  ...o,
});

async function run(l: Load) {
  const f = await layerFn("application", "runToolStage", "T18-2");
  const calls: Load[] = [];
  const decided: string[] = [];
  const repos = {
    tenantId: TEN,
    runs: { lock: async () => ({ id: LINK.runId, tenantId: TEN, status: "running" }) },
    tools: {
      loadCall: async () => l,
      lockRunning: async () => true,
      settleOk: async () => undefined,
      decide: async (x: { reason: string }) => void decided.push(x.reason),
      audit: async () => undefined,
    },
    retry: {
      loadRetryState: async () => l.state,
      markWaiting: async () => undefined,
      resetRetry: async () => undefined,
    },
    timers: {
      countByStageKind: async () => 0,
      insert: async () => undefined,
      cancelForRun: async () => 0,
    },
    sideEffect: { sent: async () => false },
    outbox: { push: () => undefined, add: () => undefined },
  };
  const d = {
    uow: { system: async <T>(_t: string, fn: (r: typeof repos) => Promise<T>) => fn(repos) },
    invoker: {
      call: async (c: Load) => {
        calls.push(c);
        return { kind: "ok", text: '{"so_hd":"HD-1"}' };
      },
    },
    clock: { now: () => new Date("2026-11-20T01:00:00.000Z") },
  };
  await f(d, LINK);
  return { calls, decided };
}

describe("security P-d2 M1/S4 · side_effect mà stage không real_action [review.md]", () => {
  it("AC-H47 · PD2-U30 · sideEffect=true ∧ realAction=false ⇒ tool_failed, 0 lời gọi", async () => {
    const h = await run(load({ sideEffect: true, realAction: false }));
    expect({ calls: h.calls.length, decided: h.decided }).toEqual({
      calls: 0,
      decided: ["tool_failed"],
    });
  });
});
