// AC-H44 · AC-H47 · HUB-FR-146 · plan-d2 §3–§4, §10 S2/S9/S10/S12, D2-13: use case lớp 2 `runToolStage` với cổng GIẢ (không DB):
// tx1 đọc công tắc/quyền ngay trước gọi, tenant = tenant của run, 64 KB kiểm trên BYTE trước JSON.parse, lỗi tạm ⇒ thử lại qua
// đúng đường `handleJobFailure` (markWaiting + hẹn `retry:<sr>:<round>:<attempt>:<n>`). Nạp qua CỔNG LỚP
// `loadLayer("application", …)` (barrel `P/application/index.ts`, T17) ⇒ vắng = đỏ "chưa có cổng lớp" / "chưa có tính năng".
import { describe, expect, it } from "bun:test";
import { layerFn, loadLayer } from "../../_support/modules";

const N = new Date("2026-11-20T01:00:00.000Z");
const TEN = "d2a00000-0000-4000-8000-000000000001";
const LINK = {
  runId: "d2a00000-0000-4000-8000-000000000011",
  stageRunId: "d2a00000-0000-4000-8000-000000000012",
  hubRunId: "d2a00000-0000-4000-8000-000000000013",
  tenantId: TEN,
};
type Res =
  | { kind: "ok"; text: string }
  | { kind: "failed"; code: string; httpStatus: number | null; sent: boolean };
type Load = Record<string, unknown>;

function load(o: Load = {}): Load {
  return {
    stageName: "Xuất HĐ",
    toolKey: "xuat-hoa-don",
    workflowId: "d2a00000-0000-4000-8000-000000000021",
    sideEffect: false,
    timeoutS: 60,
    args: {
      tong_tien: { from: "field", stageKey: "s0", field: "tong_tien" },
      ma_kh: { from: "input", key: "ma-kh" },
    },
    outputFields: [{ key: "so_hd", type: "string", required: true }],
    inputs: new Map([["ma-kh", "KH1"]]),
    fields: new Map([["s0", { tong_tien: 25_000_000 }]]),
    startedBy: "d2a00000-0000-4000-8000-000000000031",
    usable: true,
    canRun: true,
    switchOn: true,
    wfEnabled: true,
    state: { retryCount: 0, retryAttempt: null, retryRound: null, attempt: 1, round: 1 },
    ...o,
  };
}

/** Cổng giả: ghi nhật ký theo thứ tự để kiểm "đọc quyền ngay trước gọi" và "không gọi". */
function harness(l: Load, res: Res) {
  const log: string[] = [];
  const calls: Load[] = [];
  const decided: string[] = [];
  const settled: Load[] = [];
  const waiting: Load[] = [];
  const timers: Load[] = [];
  const systemTenants: string[] = [];
  const repos = {
    tenantId: TEN,
    runs: {
      lock: async () => (
        log.push("runs.lock"), { id: LINK.runId, tenantId: TEN, status: "running" }
      ),
    },
    tools: {
      loadCall: async () => (log.push("loadCall"), l),
      lockRunning: async () => (log.push("lockRunning"), true),
      settleOk: async (x: Load) => {
        log.push("settleOk");
        settled.push(x);
      },
      decide: async (x: { reason: string }) => {
        log.push("decide");
        decided.push(x.reason);
      },
      audit: async () => {
        log.push("audit");
      },
    },
    retry: {
      loadRetryState: async () => l.state,
      markWaiting: async (_id: string, w: Load) => {
        log.push("markWaiting");
        waiting.push(w);
      },
      resetRetry: async () => undefined,
    },
    timers: {
      countByStageKind: async () => 0,
      insert: async (t: Load) => {
        log.push("timers.insert");
        timers.push(t);
      },
      cancelForRun: async () => 0,
    },
    sideEffect: { sent: async () => false },
    outbox: { push: () => undefined, add: () => undefined },
  };
  const uow = {
    system: async <T>(tenantId: string, fn: (r: typeof repos) => Promise<T>) => {
      systemTenants.push(tenantId);
      log.push("tx");
      return fn(repos);
    },
  };
  const invoker = {
    call: async (c: Load) => {
      log.push("invoke");
      calls.push(c);
      return res;
    },
  };
  return {
    d: { uow, invoker, clock: { now: () => N } },
    log,
    calls,
    decided,
    settled,
    waiting,
    timers,
    systemTenants,
  };
}
async function run(l: Load, res: Res = { kind: "ok", text: '{"so_hd":"HD-1"}' }) {
  const f = await layerFn("application", "runToolStage", "T18-2");
  const h = harness(l, res);
  await f(h.d, LINK);
  return h;
}

describe("S2/S9/S10 · đọc công tắc + quyền NGAY trước gọi, theo tenant của run [plan-d2 §4 bước 1, §10]", () => {
  it("AC-H44 · HUB-FR-146 · ok ⇒ 1 lời gọi bằng người bắt đầu, args đúng, settleOk + audit; tx luôn tenant của run", async () => {
    const h = await run(load());
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      tenantId: TEN,
      userId: load().startedBy,
      hubRunId: LINK.hubRunId,
      args: { tong_tien: 25_000_000, ma_kh: "KH1" },
    });
    expect(h.settled).toHaveLength(1);
    expect(h.settled[0]?.fields).toEqual({ so_hd: "HD-1" });
    expect(h.log).toContain("audit");
    expect(new Set(h.systemTenants)).toEqual(new Set([TEN]));
  });
  it("AC-H47 · S10 · loadCall (canRun/usable/công tắc) là bước đọc CUỐI ngay trước invoke — không tx nào chen giữa", async () => {
    const h = await run(load());
    const i = h.log.indexOf("invoke");
    expect(h.log.slice(0, i)).toEqual(["tx", "loadCall"]);
  });
  it("AC-H47 · S10 · canRun=false ⇒ permission_lost, 0 lời gọi; usable=false ⇒ user_inactive, 0 lời gọi", async () => {
    const a = await run(load({ canRun: false }));
    expect([a.calls.length, a.decided]).toEqual([0, ["permission_lost"]]);
    const b = await run(load({ usable: false }));
    expect([b.calls.length, b.decided]).toEqual([0, ["user_inactive"]]);
  });
  it("AC-H47 · S2/S9 · công tắc tắt / workflow disabled ⇒ tool_failed, Dify 0 lời gọi", async () => {
    const a = await run(load({ switchOn: false }));
    expect([a.calls.length, a.decided]).toEqual([0, ["tool_failed"]]);
    const b = await run(load({ wfEnabled: false }));
    expect([b.calls.length, b.decided]).toEqual([0, ["tool_failed"]]);
  });
  it("AC-H44 · PD2-I09 · nguồn field null (stage skipped) ⇒ tool_failed, 0 lời gọi", async () => {
    const h = await run(load({ fields: new Map([["s0", null]]) }));
    expect([h.calls.length, h.decided]).toEqual([0, ["tool_failed"]]);
  });
});

const PREFIX = '{"so_hd":"';
describe("S12 · trần 64 KB trên BYTE, trước JSON.parse [plan-d2 §4 bước 4]", () => {
  it("AC-H44 · S12 · 65.536 byte ASCII ⇒ settleOk; 65.537 byte ⇒ tool_failed (không settle)", async () => {
    const at = `${PREFIX}${"x".repeat(65_536 - PREFIX.length - 2)}"}`;
    expect(new TextEncoder().encode(at).byteLength).toBe(65_536);
    const ok = await run(load(), { kind: "ok", text: at });
    expect([ok.settled.length, ok.decided]).toEqual([1, []]);
    const over = `${PREFIX}${"x".repeat(65_537 - PREFIX.length - 2)}"}`;
    const bad = await run(load(), { kind: "ok", text: over });
    expect([bad.settled.length, bad.decided]).toEqual([0, ["tool_failed"]]);
  });
  it("AC-H44 · S12 · 32.770 ký tự 'đ' (≤ 65.536 ký tự nhưng > 65.536 byte UTF-8) ⇒ tool_failed (đếm byte, không đếm ký tự)", async () => {
    const text = `${PREFIX}${"đ".repeat(32_770)}"}`;
    expect(text.length).toBeLessThan(65_536);
    expect(new TextEncoder().encode(text).byteLength).toBeGreaterThan(65_536);
    const h = await run(load(), { kind: "ok", text });
    expect([h.settled.length, h.decided]).toEqual([0, ["tool_failed"]]);
  });
  it("AC-H44 · D2-05 · không phải JSON / sai kiểu trường ⇒ template_invalid ngay", async () => {
    const a = await run(load(), { kind: "ok", text: "khong-phai-json" });
    expect(a.decided).toEqual(["template_invalid"]);
    const b = await run(load({ outputFields: [{ key: "so", type: "number", required: true }] }), {
      kind: "ok",
      text: '{"so":"abc"}',
    });
    expect(b.decided).toEqual(["template_invalid"]);
  });
});

describe("D2-13 · thử lại tool dùng chung đường handleJobFailure (scheduleRetry)", () => {
  it("HUB-BR-12 · PD2-I05 · 503 đã gửi, không side effect ⇒ markWaiting(retryCount 1) + hẹn retry +30 s khoá retry:<sr>:1:1:1; không decide", async () => {
    const h = await run(load(), {
      kind: "failed",
      code: "UPSTREAM_ERROR",
      httpStatus: 503,
      sent: true,
    });
    expect(h.decided).toEqual([]);
    expect(h.waiting).toEqual([expect.objectContaining({ retryCount: 1, attempt: 1, round: 1 })]);
    expect(h.timers).toEqual([
      expect.objectContaining({
        kind: "retry",
        stageRunId: LINK.stageRunId,
        dueAt: new Date(N.getTime() + 30_000),
        key: `retry:${LINK.stageRunId}:1:1:1`,
      }),
    ]);
    expect(h.log.indexOf("markWaiting")).toBeLessThan(h.log.indexOf("timers.insert"));
  });
  it("HUB-BR-12 · PD2-I04 · side effect + đã gửi + 500 ⇒ tool_failed, 0 hẹn", async () => {
    const h = await run(load({ sideEffect: true }), {
      kind: "failed",
      code: "UPSTREAM_ERROR",
      httpStatus: 500,
      sent: true,
    });
    expect([h.decided, h.timers.length]).toEqual([["tool_failed"], 0]);
  });
  it("HUB-BR-12 · PD2-I08 · đã 3 lượt ⇒ retry_exhausted", async () => {
    const st = { retryCount: 3, retryAttempt: 1, retryRound: 1, attempt: 1, round: 1 };
    const h = await run(load({ state: st }), {
      kind: "failed",
      code: "TIMEOUT",
      httpStatus: null,
      sent: true,
    });
    expect([h.decided, h.timers.length]).toEqual([["retry_exhausted"], 0]);
  });
  it("HUB-BR-12 · D2-13 · handleToolFailure + handleJobFailure cùng có ở cổng application", async () => {
    expect(typeof (await loadLayer("application", "handleToolFailure", "T18-2"))).toBe("function");
    expect(typeof (await loadLayer("application", "handleJobFailure", "T17"))).toBe("function");
  });
});
