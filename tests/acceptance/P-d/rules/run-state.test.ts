// HUB-FR-143 · HUB-FR-144 · AC-H39 · AC-H41 · test-plan §4 PD-U20…U25: máy trạng thái run sau tách
// `P/domain/runs/run-state.rules.ts` (plan-domain §4.3: `retry_exhausted`, `timer_invalid`, `waiting_timer`). Builder `st()`
// như `P-a/step0/rules/process-state.test.ts`; PD-U25 hồi quy R-S17/R-S18 (cùng dữ liệu). Module vắng ⇒ đỏ.
import { describe, expect, it } from "bun:test";
import { domainFn, type Loose } from "../_support/modules";

const REL = "runs/run-state.rules.ts";

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
const tr = () => domainFn(REL, "transition");
const ADD = { kind: "decide", option: "add_attempt" };
const USE = { kind: "decide", option: "use_current" };

describe("PD-U20…U23 · quyết định retry_exhausted / timer_invalid [plan-domain §4.3]", () => {
  it("AC-H39 · PD-U20 · retry_exhausted + add_attempt ⇒ stage queued, attempt giữ, run running, effects ⊇ queue_stage + reset_retry", async () => {
    const r = (await tr())(
      st({ status: "needs_decision", reason: "retry_exhausted" }, { attempt: 2 }),
      ADD,
    );
    expect(r.ok).toBe(true);
    expect(r.next.status).toBe("running");
    expect(r.next.stage).toMatchObject({ status: "queued", attempt: 2 });
    expect(r.effects).toEqual(expect.arrayContaining(["queue_stage", "reset_retry"]));
  });
  it("AC-H41 · PD-U21 · timer_invalid + add_attempt ⇒ stage queued, attempt giữ, queue_stage, không reset_retry", async () => {
    const r = (await tr())(
      st({ status: "needs_decision", reason: "timer_invalid" }, { attempt: 2, after: "auto" }),
      ADD,
    );
    expect(r.ok).toBe(true);
    expect(r.next.status).toBe("running");
    expect(r.next.stage).toMatchObject({ status: "queued", attempt: 2 });
    expect(r.effects).toContain("queue_stage");
    expect(r.effects).not.toContain("reset_retry");
  });
  it("AC-H41 · PD-U22 · timer_invalid + use_current, stage KHÔNG output ⇒ không NO_OUTPUT; write_wait_skip + advance", async () => {
    const f = await tr();
    const mid = f(
      st(
        { status: "needs_decision", reason: "timer_invalid" },
        { after: "auto", hasOutput: false },
      ),
      USE,
    );
    expect(mid.ok).toBe(true);
    expect(mid.next).toMatchObject({ status: "running", stageIdx: 1 });
    expect(mid.effects).toEqual(expect.arrayContaining(["write_wait_skip", "queue_next_stage"]));
    const last = f(
      st(
        { status: "needs_decision", reason: "timer_invalid", stageIdx: 1 },
        { after: "auto", hasOutput: false },
      ),
      USE,
    );
    expect(last.ok).toBe(true);
    expect(last.next.status).toBe("done");
    expect(last.effects).toEqual(expect.arrayContaining(["write_wait_skip", "finish_run"]));
  });
  it("AC-H39 · PD-U23 · retry_exhausted + use_current, không output ⇒ NO_OUTPUT (luật cũ)", async () => {
    const r = (await tr())(
      st({ status: "needs_decision", reason: "retry_exhausted" }, { hasOutput: false }),
      USE,
    );
    expect(r).toEqual({ ok: false, code: "NO_OUTPUT" });
  });
});

describe("PD-U24…U25 · waiting_timer + hồi quy [plan-domain §4.3]", () => {
  it("AC-H41 · PD-U24 · run waiting_timer + cancel ⇒ cancelled; + expire ⇒ expired; isTerminal(waiting_timer) = false", async () => {
    const f = await tr();
    const c = f(st({ status: "waiting_timer" }), { kind: "cancel" });
    expect(c.ok).toBe(true);
    expect(c.next.status).toBe("cancelled");
    const e = f(st({ status: "waiting_timer" }), { kind: "expire" });
    expect(e.ok).toBe(true);
    expect(e.next.status).toBe("expired");
    expect((await domainFn(REL, "isTerminal"))("waiting_timer")).toBe(false);
  });
  it("HUB-FR-143 · PD-U25 · hồi quy R-S17: limit{reason} × 10 lý do ⇒ needs_decision cùng lý do", async () => {
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
  it("HUB-FR-143 · PD-U25 · hồi quy R-S18: permission_lost / user_inactive / interrupted ⇒ needs_decision cùng tên", async () => {
    const f = await tr();
    for (const k of ["permission_lost", "user_inactive", "interrupted"]) {
      const r = f(st({}, { status: "queued" }), { kind: k });
      expect(r.next).toMatchObject({ status: "needs_decision", decisionReason: k });
    }
  });
});
