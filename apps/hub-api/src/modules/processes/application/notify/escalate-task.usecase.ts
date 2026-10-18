// HUB-FR-145 · AC-H42 · AC-H46 · HUB-BR-43 · PD-R20/R22 · K3/K4 · plan §4.9 · plan-addendum A10/A11 · use case lớp 2 chuyển
// cấp THEO TẬP trong tx lô của vòng nhắc: MỘT câu claim-update (SKIP LOCKED, đặt `escalated_at`); có hàng ⇒ luật lớp 1
// `escalateAction` chọn thêm Group / bỏ qua trên mảng ⇒ assignee, audit, notice `escalated` mỗi loại MỘT câu nhiều hàng.
// `tenant_id` mọi hàng ghi lấy từ hàng nguồn (task), không từ caller.
import { escalateAction } from "../../domain/notify/escalate.rules";
import type {
  BatchRepos,
  ClaimedEscalation,
  EscalateAuditRow,
  EscalatedAssigneeRow,
  NoticeMetaRow,
} from "../ports";

export async function escalateBatch(
  r: BatchRepos,
  now: Date,
  limit: number,
): Promise<{ n: number; more: boolean }> {
  const { tasks, claimed, more } = await r.reviewTasks.claimDueEscalations(limit, now);
  // Lô đầy tính theo số đã khoá (gồm task bị bỏ vì run đang bị giữ — T12 #1) ⇒ không dừng xả sớm.
  const full = more && claimed >= limit;
  if (tasks.length === 0) return { n: 0, more: full };
  const add: EscalatedAssigneeRow[] = [];
  const audits: EscalateAuditRow[] = [];
  const notices: NoticeMetaRow[] = [];
  for (const t of tasks) {
    const act = escalateAction({
      groupId: t.toGroupId,
      groupExists: t.groupTenantId !== null,
      groupTenantId: t.groupTenantId,
      taskTenantId: t.tenantId,
    });
    audits.push(auditOf(t, act.kind === "add_group" ? "escalate" : "escalate_skipped"));
    if (act.kind !== "add_group") continue;
    add.push({ tenantId: t.tenantId, taskId: t.taskId, groupId: act.groupId });
    notices.push(...noticeRows(t));
  }
  if (add.length > 0) await r.reviewTasks.addEscalatedGroups(add);
  await r.reviewTasks.auditEscalations(audits);
  if (notices.length > 0) await r.notices.notifyMany("escalated", notices);
  return { n: add.length, more: full };
}

function auditOf(t: ClaimedEscalation, action: EscalateAuditRow["action"]): EscalateAuditRow {
  return {
    tenantId: t.tenantId,
    taskId: t.taskId,
    action,
    entityName: t.stageName ?? t.processName,
    fromGroupId: t.fromGroupId,
    toGroupId: t.toGroupId,
  };
}

function noticeRows(t: ClaimedEscalation): NoticeMetaRow[] {
  return [...new Set(t.memberIds)].map((userId) => ({
    tenantId: t.tenantId,
    userId,
    processRunId: t.processRunId,
    taskId: t.taskId,
    payload: { process_name: t.processName, stage_name: t.stageName },
    processName: t.processName,
    stageName: t.stageName,
  }));
}
