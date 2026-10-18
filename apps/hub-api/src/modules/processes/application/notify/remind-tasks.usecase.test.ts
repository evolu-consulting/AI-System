// HUB-FR-112 · HUB-FR-145 · PD-R18…R20 · A10/A11 · use case vòng nhắc + chuyển cấp với repo lô giả: số lời gọi repo mỗi lô
// cố định (không theo số hàng), mốc nhắc kế theo lớp 1, chuyển cấp thêm Group / bỏ qua (`escalate_skipped`), tenant hàng nguồn.
import { describe, expect, it } from "bun:test";
import type {
  BatchRepos,
  ClaimedEscalation,
  ClaimedReminder,
  EscalateAuditRow,
  EscalatedAssigneeRow,
  NoticeMetaRow,
  ReminderMark,
  SystemUow,
} from "../ports";
import { remindTasks } from "./remind-tasks.usecase";

const NOW = new Date("2026-10-18T00:00:00Z");
const H = 3_600_000;
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const rem = (id: string, o: Partial<ClaimedReminder> = {}): ClaimedReminder => ({
  taskId: id,
  tenantId: A,
  processRunId: `run-${id}`,
  groupId: "g1",
  processName: "P",
  stageName: "S",
  userIds: ["u1"],
  groupMemberIds: ["u1", "u2"],
  remindAt: new Date(NOW.getTime() - H),
  remindedAt: null,
  remindEveryH: null,
  remindCount: 0,
  ...o,
});
const esc = (id: string, o: Partial<ClaimedEscalation> = {}): ClaimedEscalation => ({
  taskId: id,
  tenantId: A,
  processRunId: `run-${id}`,
  fromGroupId: "g1",
  toGroupId: "g2",
  groupTenantId: A,
  processName: "P",
  stageName: "S",
  memberIds: ["h1", "h2"],
  ...o,
});

function fake(reminders: ClaimedReminder[], escalations: ClaimedEscalation[]) {
  const calls: string[] = [];
  const marks: ReminderMark[] = [];
  const notices: { kind: string; rows: readonly NoticeMetaRow[] }[] = [];
  const added: EscalatedAssigneeRow[] = [];
  const audits: EscalateAuditRow[] = [];
  const r = {
    reviewTasks: {
      claimDueReminders: async () => {
        calls.push("claim");
        return { tasks: reminders, more: false };
      },
      markRemindedMany: async (rows: readonly ReminderMark[]) => {
        calls.push("mark");
        marks.push(...rows);
      },
      claimDueEscalations: async () => {
        calls.push("esc");
        return { tasks: escalations, more: false };
      },
      addEscalatedGroups: async (rows: readonly EscalatedAssigneeRow[]) => {
        calls.push("add");
        added.push(...rows);
      },
      auditEscalations: async (rows: readonly EscalateAuditRow[]) => {
        calls.push("audit");
        audits.push(...rows);
      },
    },
    notices: {
      notifyMany: async (kind: string, rows: readonly NoticeMetaRow[]) => {
        calls.push(`notify:${kind}`);
        notices.push({ kind, rows });
        return rows.length;
      },
    },
  } as unknown as BatchRepos;
  const sysUow = { systemBatch: (fn: (x: BatchRepos) => unknown) => fn(r) } as unknown as SystemUow;
  return { sysUow, calls, marks, notices, added, audits };
}

const run = (f: ReturnType<typeof fake>) =>
  remindTasks({ sysUow: f.sysUow, now: () => NOW, elapsedMs: () => 0 });

describe("remindTasks (A10 · ≤ 3 câu nhắc / lô)", () => {
  it("HUB-FR-112 · lô rỗng ⇒ chỉ claim nhắc + claim chuyển cấp", async () => {
    const f = fake([], []);
    expect(await run(f)).toBe(0);
    expect(f.calls).toEqual(["claim", "esc"]);
  });

  it("HUB-FR-145 · PD-R19 · 1 hay 3 task ⇒ cùng số lời gọi; lặp ⇒ remindAt += N giờ, count+1; cũ ⇒ giữ nguyên", async () => {
    const one = fake([rem("t1")], []);
    await run(one);
    const repeat = rem("t2", { remindEveryH: 4, remindCount: 2 });
    const three = fake([rem("t1"), repeat, rem("t3", { tenantId: B })], []);
    expect(await run(three)).toBe(3);
    expect(three.calls).toEqual(one.calls);
    expect(three.calls).toEqual(["claim", "mark", "notify:reminder", "esc"]);
    const m = new Map(three.marks.map((x) => [x.taskId, x]));
    expect(m.get("t1")).toEqual({
      taskId: "t1",
      tenantId: A,
      remindAt: rem("t1").remindAt,
      remindCount: 0,
    });
    expect(m.get("t2")).toEqual({
      taskId: "t2",
      tenantId: A,
      remindAt: new Date(repeat.remindAt.getTime() + 4 * H),
      remindCount: 3,
    });
    // K3 lô: notice mang tenant của hàng nguồn; người nhận khử trùng (u1 ở cả user + group).
    const rows = three.notices[0]?.rows ?? [];
    expect(rows.filter((x) => x.taskId === "t3").map((x) => [x.tenantId, x.userId])).toEqual([
      [B, "u1"],
      [B, "u2"],
    ]);
  });

  it("HUB-FR-145 · PD-R18 · lặp đã đủ 10 lần ⇒ không nhắc", async () => {
    const f = fake([rem("t1", { remindEveryH: 4, remindCount: 10 })], []);
    expect(await run(f)).toBe(0);
    expect(f.calls).toEqual(["claim", "esc"]);
  });

  it("HUB-FR-145 · PD-R20 · K4 · Group hợp lệ ⇒ assignee + audit escalate + notice; Group khác tenant/đã xoá ⇒ escalate_skipped", async () => {
    const f = fake([], [esc("e1"), esc("e2", { groupTenantId: null, tenantId: B })]);
    await run(f);
    expect(f.calls).toEqual(["claim", "esc", "add", "audit", "notify:escalated"]);
    expect(f.added).toEqual([{ tenantId: A, taskId: "e1", groupId: "g2" }]);
    expect(f.audits.map((a) => [a.taskId, a.tenantId, a.action])).toEqual([
      ["e1", A, "escalate"],
      ["e2", B, "escalate_skipped"],
    ]);
    expect(f.notices[0]?.rows.map((x) => [x.tenantId, x.userId])).toEqual([
      [A, "h1"],
      [A, "h2"],
    ]);
  });
});
