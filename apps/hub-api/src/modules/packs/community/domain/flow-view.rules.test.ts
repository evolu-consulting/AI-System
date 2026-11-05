// CR-120 · cr120-community-flows · unit cho chiếu hàng 3 khe Community sang FlowView (task chỉ cho người duyệt + bước đang mở).
import { describe, expect, it } from "bun:test";
import { FlowViewSchema } from "@ai/contracts/flow";
import {
  type JoinViewRow,
  joinView,
  type ModViewRow,
  moderationView,
  type ReportViewRow,
  reportView,
  summaryOf,
} from "./flow-view.rules";

const T0 = Date.parse("2026-11-05T00:00:00Z");
const AT = new Date(T0).toISOString();
const dec = { decided_by: null, decided_name: null, decided_at: null, feedback: null };
const mod = (p: Partial<ModViewRow>): ModViewRow => ({
  id: "p1",
  moderation: "pending",
  mod_screen: "flagged",
  mod_at: AT,
  mod_task_id: "7e5d0000-0000-4000-8000-000000000001",
  mod_reason: "nghi spam",
  ...dec,
  ...p,
});
const join = (p: Partial<JoinViewRow>): JoinViewRow => ({
  id: "j1",
  status: "pending",
  task_id: "7e5d0000-0000-4000-8000-000000000002",
  created_at: AT,
  company: "X",
  ...dec,
  ...p,
});
const rep = (p: Partial<ReportViewRow>): ReportViewRow => ({
  id: "r1",
  status: "pending",
  triage: "done",
  triage_kind: "spam",
  triage_level: "high",
  action: null,
  task_id: "7e5d0000-0000-4000-8000-000000000003",
  ...dec,
  ...p,
});

describe("moderationView", () => {
  it("moderation=none ⇒ state none, không bước, không task", () => {
    const v = moderationView(mod({ moderation: "none", mod_screen: null }), {
      reviewer: true,
      now: T0,
    });
    expect(v).toMatchObject({ state: "none", steps: [], tasks: [] });
  });
  it("gắn cờ + người duyệt ⇒ bước review open + task [approve, reject], id task = mod_task_id", () => {
    const v = moderationView(mod({}), { reviewer: true, now: T0 + 25 * 3_600_000 });
    expect(v.state).toBe("running");
    expect(v.steps.map((s) => s.status)).toEqual(["passed", "open", "pending"]);
    expect(v.steps[1]).toMatchObject({ overdue: true, escalated: false });
    expect(v.tasks).toHaveLength(1);
    expect(v.tasks[0]).toMatchObject({
      task_id: "7e5d0000-0000-4000-8000-000000000001",
      step_key: "review",
    });
    expect(v.tasks[0]?.actions.map((a) => a.key)).toEqual(["approve", "reject"]);
    expect(FlowViewSchema.safeParse(v).success).toBe(true);
  });
  it("người không duyệt (tác giả/đối tác) ⇒ không có task", () => {
    const v = moderationView(mod({}), { reviewer: false, now: T0 });
    expect(v.tasks).toEqual([]);
    expect(summaryOf(v).attention).toBe(false);
  });
  it("screen đang chạy chưa quá hạn ⇒ không mở, không task, sạch ⇒ done + ghi chú", () => {
    const run = moderationView(mod({ mod_screen: "running" }), { reviewer: true, now: T0 + 1000 });
    expect(run.steps[0]?.status).toBe("running");
    expect(run.tasks).toEqual([]);
    const ok = moderationView(mod({ moderation: "approved", mod_screen: "clean" }), {
      reviewer: true,
      now: T0,
    });
    expect(ok.state).toBe("done");
    expect(ok.note).toContain("sạch");
    expect(ok.steps[1]?.status).toBe("skipped");
    expect(ok.tasks).toEqual([]);
  });
  it("từ chối ⇒ rejected, bước đăng rejected, đã duyệt tay ⇒ review passed + người quyết", () => {
    const rej = moderationView(
      mod({ moderation: "rejected", decided_by: "u1", decided_name: "A" }),
      {
        reviewer: true,
        now: T0,
      },
    );
    expect(rej.state).toBe("rejected");
    expect(rej.steps.map((s) => s.status)).toEqual(["passed", "rejected", "rejected"]);
    const ok = moderationView(
      mod({ moderation: "approved", decided_by: "u1", decided_name: "A" }),
      {
        reviewer: false,
        now: T0,
      },
    );
    expect(ok.steps[1]).toMatchObject({ status: "passed", decided_by: { id: "u1", name: "A" } });
  });
});

describe("joinView", () => {
  it("pending + admin ⇒ task, đối tác ⇒ không task, đã quyết ⇒ state done/rejected", () => {
    expect(joinView(join({}), { reviewer: true }).tasks[0]?.task_id).toBe(
      "7e5d0000-0000-4000-8000-000000000002",
    );
    expect(joinView(join({}), { reviewer: false }).tasks).toEqual([]);
    expect(joinView(join({ status: "approved" }), { reviewer: true })).toMatchObject({
      state: "done",
      tasks: [],
    });
    const r = joinView(join({ status: "rejected" }), { reviewer: true });
    expect(r.state).toBe("rejected");
    expect(r.steps[2]?.status).toBe("skipped");
    expect(FlowViewSchema.safeParse(r).success).toBe(true);
  });
});

describe("reportView", () => {
  it("pending + điều phối viên ⇒ task 3 hành động, resolved ⇒ phase = action, không task", () => {
    const v = reportView(rep({}), { reviewer: true });
    expect(v.tasks[0]?.actions.map((a) => a.key)).toEqual(["hide", "warn", "dismiss"]);
    expect((v.steps[0] as { agent?: { summary: string | null } }).agent?.summary).toBe(
      "spam · high",
    );
    const done = reportView(rep({ status: "resolved", action: "hide" }), { reviewer: true });
    expect(done).toMatchObject({ state: "done", phase: "hide", tasks: [] });
    expect(FlowViewSchema.safeParse(done).success).toBe(true);
  });
  it("triage lỗi ⇒ bước failed nhưng vẫn vào xử lý tay", () => {
    const v = reportView(rep({ triage: "error", triage_kind: null, triage_level: null }), {
      reviewer: true,
    });
    expect(v.steps[0]?.status).toBe("failed");
    expect(v.tasks).toHaveLength(1);
  });
});
