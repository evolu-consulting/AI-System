// HUB-FR-106 · HUB-FR-107 · HUB-FR-110 · AC-H28 · R-S01…R-S20 — `transition`, `isTerminal` (domain/runs/run-state.rules.ts,
// plan §3.1–3.2, plan-contract §7). Hiệu ứng so như TẬP (sắp xếp) — thứ tự không thuộc contract.
import { describe, expect, it } from "bun:test";
import { fn, type Loose, tryLoad } from "../../_support/modules";

const RUN_STATE = "apps/hub-api/src/modules/processes/domain/runs/run-state.rules.ts";

const ACTIVE = ["running", "waiting_review", "waiting_answer", "needs_decision"] as const;
const TERMINAL = ["done", "cancelled", "failed", "expired"] as const;
const ALL_EVENTS: Loose[] = [
  { kind: "stage_output", templateOk: true },
  { kind: "need_input" },
  { kind: "limit", reason: "team_calls" },
  { kind: "review", result: "pass" },
  { kind: "answer" },
  { kind: "decide", option: "add_attempt" },
  { kind: "cancel" },
  { kind: "expire" },
  { kind: "permission_lost" },
];

type StageO = Partial<{
  status: string;
  attempt: number;
  attemptLimit: number;
  asksCount: number;
  askLimit: number;
  after: "review" | "auto";
  hasOutput: boolean;
}>;
/** RunState mặc định: running, stage 0/2 đang chạy, attempt 1/4, hỏi 0/3, gate review. */
function st(
  o: { status?: string; stageIdx?: number; stageCount?: number; reason?: string | null } = {},
  s: StageO = {},
): Loose {
  const status = o.status ?? "running";
  return {
    status,
    stageIdx: o.stageIdx ?? 0,
    stageCount: o.stageCount ?? 2,
    stage: {
      status: s.status ?? (status === "running" ? "running" : status),
      attempt: 1,
      attemptLimit: 4,
      asksCount: 0,
      askLimit: 3,
      after: "review",
      hasOutput: false,
      ...s,
    },
    decisionReason: o.reason ?? null,
  };
}
const tr = async () => fn(await tryLoad(RUN_STATE), "transition");
const fx = (r: Loose) => [...(r.effects ?? [])].sort();
const sorted = (xs: string[]) => [...xs].sort();

describe("R-S · máy trạng thái run [plan §3.1]", () => {
  it("HUB-FR-106 · R-S01 · output đạt template, gate review ⇒ waiting_review + open_review", async () => {
    const r = (await tr())(st(), { kind: "stage_output", templateOk: true });
    expect(r.ok).toBe(true);
    expect(r.next.status).toBe("waiting_review");
    expect(fx(r)).toEqual(["open_review"]);
  });
  it("HUB-FR-106 · R-S02 · gate auto, chưa stage cuối ⇒ running stage kế + queue_next_stage", async () => {
    const r = (await tr())(st({}, { after: "auto" }), { kind: "stage_output", templateOk: true });
    expect(r.next).toMatchObject({ status: "running", stageIdx: 1 });
    expect(fx(r)).toEqual(["queue_next_stage"]);
  });
  it("HUB-FR-106 · R-S03 · gate auto, stage cuối ⇒ done + finish_run", async () => {
    const r = (await tr())(st({ stageIdx: 1 }, { after: "auto" }), {
      kind: "stage_output",
      templateOk: true,
    });
    expect(r.next.status).toBe("done");
    expect(fx(r)).toEqual(["finish_run"]);
  });
  it("HUB-FR-114 · R-S04 · template hỏng, attempt 1 < 4 ⇒ chạy lại cùng stage attempt 2 (M3)", async () => {
    const r = (await tr())(st(), { kind: "stage_output", templateOk: false });
    expect(r.next).toMatchObject({ status: "running", stageIdx: 0 });
    expect(r.next.stage.attempt).toBe(2);
    expect(fx(r)).toEqual(["queue_stage"]);
  });
  it("HUB-FR-114 · R-S05 · template hỏng, attempt = limit ⇒ needs_decision template_invalid", async () => {
    const r = (await tr())(st({}, { attempt: 4 }), { kind: "stage_output", templateOk: false });
    expect(r.next).toMatchObject({ status: "needs_decision", decisionReason: "template_invalid" });
    expect(fx(r)).toEqual(["open_decision"]);
  });
  it("HUB-FR-110 · R-S06 · need_input asksCount 0..2 ⇒ waiting_answer, asksCount+1, attempt giữ", async () => {
    const f = await tr();
    for (const n of [0, 1, 2]) {
      const r = f(st({}, { asksCount: n, attempt: 2 }), { kind: "need_input" });
      expect(r.next.status).toBe("waiting_answer");
      expect(r.next.stage).toMatchObject({ asksCount: n + 1, attempt: 2 });
      expect(fx(r)).toEqual(["open_ask"]);
    }
  });
  it("HUB-FR-110 · R-S07 · need_input asksCount 3 ⇒ needs_decision ask_limit", async () => {
    const r = (await tr())(st({}, { asksCount: 3 }), { kind: "need_input" });
    expect(r.next).toMatchObject({ status: "needs_decision", decisionReason: "ask_limit" });
  });
  it("HUB-FR-107 · R-S08 · review pass giữa ⇒ running idx+1 [close_open_tasks, queue_next_stage]; cuối ⇒ done", async () => {
    const f = await tr();
    const mid = f(st({ status: "waiting_review" }, { hasOutput: true }), {
      kind: "review",
      result: "pass",
    });
    expect(mid.next).toMatchObject({ status: "running", stageIdx: 1 });
    expect(fx(mid)).toEqual(sorted(["close_open_tasks", "queue_next_stage"]));
    const last = f(st({ status: "waiting_review", stageIdx: 1 }, { hasOutput: true }), {
      kind: "review",
      result: "pass",
    });
    expect(last.next.status).toBe("done");
    expect(last.effects).toContain("finish_run");
  });
  it("HUB-FR-107 · R-S09 · review fail attempt 1..3 ⇒ running attempt+1 [queue_stage]", async () => {
    const f = await tr();
    for (const a of [1, 2, 3]) {
      const r = f(st({ status: "waiting_review" }, { attempt: a, hasOutput: true }), {
        kind: "review",
        result: "fail",
      });
      expect(r.next).toMatchObject({ status: "running", stageIdx: 0 });
      expect(r.next.stage.attempt).toBe(a + 1);
      expect(fx(r)).toEqual(["queue_stage"]);
    }
  });
  it("AC-H28 · R-S10 · review fail attempt 4 = limit ⇒ needs_decision redo_limit", async () => {
    const r = (await tr())(st({ status: "waiting_review" }, { attempt: 4, hasOutput: true }), {
      kind: "review",
      result: "fail",
    });
    expect(r.next).toMatchObject({ status: "needs_decision", decisionReason: "redo_limit" });
  });
  it("HUB-FR-110 · R-S11 · waiting_answer + answer ⇒ running [queue_stage], attempt giữ", async () => {
    const r = (await tr())(st({ status: "waiting_answer" }, { attempt: 2, asksCount: 1 }), {
      kind: "answer",
    });
    expect(r.next.status).toBe("running");
    expect(r.next.stage.attempt).toBe(2);
    expect(fx(r)).toEqual(["queue_stage"]);
  });
  it("HUB-FR-115 · R-S12 · decide add_attempt: redo_limit ⇒ attemptLimit+1; ask_limit ⇒ askLimit+1; team_calls ⇒ attempt+1", async () => {
    const f = await tr();
    const ev = { kind: "decide", option: "add_attempt" };
    const a = f(st({ status: "needs_decision", reason: "redo_limit" }, { attempt: 4 }), ev);
    expect(a.next.stage.attemptLimit).toBe(5);
    const b = f(st({ status: "needs_decision", reason: "ask_limit" }, { asksCount: 3 }), ev);
    expect(b.next.stage.askLimit).toBe(4);
    const c = f(st({ status: "needs_decision", reason: "team_calls" }, { attempt: 1 }), ev);
    expect(c.next.stage.attempt).toBe(2);
    for (const r of [a, b, c]) {
      expect(r.next.status).toBe("running");
      expect(fx(r)).toEqual(["queue_stage"]);
    }
  });
  it("HUB-FR-115 · R-S13 · use_current khi chưa có output ⇒ NO_OUTPUT", async () => {
    const r = (await tr())(
      st({ status: "needs_decision", reason: "team_calls" }, { hasOutput: false }),
      {
        kind: "decide",
        option: "use_current",
      },
    );
    expect(r).toEqual({ ok: false, code: "NO_OUTPUT" });
  });
  it("HUB-FR-115 · R-S14 · use_current: lý do ≠ redo_limit + review ⇒ waiting_review; redo_limit ⇒ như pass; auto ⇒ như stage done", async () => {
    const f = await tr();
    const ev = { kind: "decide", option: "use_current" };
    const a = f(st({ status: "needs_decision", reason: "team_calls" }, { hasOutput: true }), ev);
    expect(a.next.status).toBe("waiting_review");
    expect(fx(a)).toEqual(["open_review"]);
    const b = f(
      st({ status: "needs_decision", reason: "redo_limit" }, { hasOutput: true, attempt: 4 }),
      ev,
    );
    expect(b.next).toMatchObject({ status: "running", stageIdx: 1 });
    expect(b.effects).toContain("queue_next_stage");
    const c = f(
      st({ status: "needs_decision", reason: "team_calls" }, { hasOutput: true, after: "auto" }),
      ev,
    );
    expect(c.next).toMatchObject({ status: "running", stageIdx: 1 });
    expect(c.effects).toContain("queue_next_stage");
  });
  it("HUB-FR-106 · R-S15 · decide cancel / cancel từ 4 trạng thái active ⇒ cancelled + huỷ stage, đóng task, kết thúc", async () => {
    const f = await tr();
    const want = sorted(["cancel_stage_run", "close_open_tasks", "finish_run"]);
    const d = f(st({ status: "needs_decision", reason: "redo_limit" }), {
      kind: "decide",
      option: "cancel",
    });
    expect(d.next.status).toBe("cancelled");
    expect(fx(d)).toEqual(want);
    for (const s of ACTIVE) {
      const r = f(st({ status: s, reason: s === "needs_decision" ? "redo_limit" : null }), {
        kind: "cancel",
      });
      expect(r.next.status).toBe("cancelled");
      expect(fx(r)).toEqual(want);
    }
  });
  it("HUB-FR-106 · R-S16 · expire từ 4 trạng thái active ⇒ expired, đóng task, không tự duyệt", async () => {
    const f = await tr();
    for (const s of ACTIVE) {
      const r = f(
        st(
          { status: s, reason: s === "needs_decision" ? "redo_limit" : null },
          { hasOutput: true },
        ),
        {
          kind: "expire",
        },
      );
      expect(r.next.status).toBe("expired");
      expect(r.effects).toContain("close_open_tasks");
      expect(r.effects).not.toContain("queue_next_stage");
      expect(r.next.stage.status).not.toBe("done");
    }
  });
  it("HUB-FR-115 · R-S17 · limit{reason} × 10 lý do ⇒ needs_decision cùng lý do", async () => {
    const f = await tr();
    const reasons = [
      "template_invalid",
      "ask_limit",
      "team_calls",
      "team_tokens",
      "team_time",
      "team_no_change",
      "job_timeout",
      "stage_tokens",
      "run_tokens",
      "agent_failed",
    ];
    for (const reason of reasons) {
      const r = f(st(), { kind: "limit", reason });
      expect(r.next).toMatchObject({ status: "needs_decision", decisionReason: reason });
    }
  });
  it("HUB-FR-106 · R-S18 · permission_lost / user_inactive / interrupted ⇒ needs_decision cùng tên", async () => {
    const f = await tr();
    for (const k of ["permission_lost", "user_inactive", "interrupted"]) {
      const r = f(st({}, { status: "queued" }), { kind: k });
      expect(r.next).toMatchObject({ status: "needs_decision", decisionReason: k });
    }
  });
  it("HUB-FR-106 · R-S19 · sự kiện sai trạng thái ⇒ PROCESS_RUN_STATE", async () => {
    const f = await tr();
    const bad = { ok: false, code: "PROCESS_RUN_STATE" };
    for (const s of TERMINAL)
      for (const e of ALL_EVENTS) expect(f(st({ status: s }), e)).toEqual(bad);
    expect(f(st({ status: "running" }), { kind: "review", result: "pass" })).toEqual(bad);
    expect(f(st({ status: "waiting_review" }), { kind: "answer" })).toEqual(bad);
    for (const s of ["running", "waiting_review", "waiting_answer"])
      expect(f(st({ status: s }), { kind: "decide", option: "add_attempt" })).toEqual(bad);
  });
  it("HUB-FR-106 · R-S20 · isTerminal đúng 4 trạng thái kết thúc", async () => {
    const f = fn(await tryLoad(RUN_STATE), "isTerminal");
    for (const s of TERMINAL) expect(f(s)).toBe(true);
    for (const s of ACTIVE) expect(f(s)).toBe(false);
  });
});
