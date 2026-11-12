// CR-127 · E2 · spec §5.1 · R#27 · vòng tự trả việc đã nhận THEO TẬP (khuôn `remind-tasks.usecase`): mỗi lô MỘT tx `systemBatch`,
// số câu cố định — trả về nhóm (1 câu `releaseDueClaims`) + chèn notice `task_released` (notifyMany). Người nhận báo: trưởng phòng
// của nhóm; nhóm không có trưởng phòng ⇒ quản trị công ty (`releaseRecipients`). "Không thao tác" = quá `claim_deadline_at`; xem/mở
// thẻ không gia hạn. Đồng hồ = tham số `now()` (seam) — test gọi `releaseClaims` trực tiếp với đồng hồ giả, không ngủ.
import { releaseRecipients } from "../../domain/tasks/claim.rules";
import type { BatchRepos, NoticeMetaRow, ReleasedClaim, SystemUow } from "../ports";

/** Mỗi lô ≤ 100 hàng (khuôn vòng nhắc). */
export const CLAIM_RELEASE_BATCH = 100;
const DRAIN_BUDGET_MS = 60_000;

export type ClaimReleaseDeps = { sysUow: SystemUow; now(): Date; elapsedMs(): number };

/** Một lượt: trả tổng số việc vừa tự trả (mọi lô). */
export async function releaseClaims(d: ClaimReleaseDeps): Promise<number> {
  const t0 = d.elapsedMs();
  let total = 0;
  for (;;) {
    const now = d.now();
    const b = await d.sysUow.systemBatch((r) => releaseBatch(r, now, CLAIM_RELEASE_BATCH));
    total += b.n;
    if (!b.more || d.elapsedMs() - t0 >= DRAIN_BUDGET_MS) return total;
  }
}

export async function releaseBatch(
  r: BatchRepos,
  now: Date,
  limit: number,
): Promise<{ n: number; more: boolean }> {
  const { tasks, claimed, more } = await r.reviewTasks.releaseDueClaims(limit, now);
  if (tasks.length > 0) await r.notices.notifyMany("task_released", tasks.flatMap(noticeRows));
  // Khoá ≥ 1 mà giữ 0 (mọi run đang bị giữ) ⇒ lô sau gặp lại đúng chúng: dừng lượt, lượt kế thử lại.
  const stalled = claimed > 0 && tasks.length === 0;
  return { n: tasks.length, more: more && claimed >= limit && !stalled };
}

function noticeRows(t: ReleasedClaim): NoticeMetaRow[] {
  return releaseRecipients(t.head, t.tenantAdminIds).map((userId) => ({
    tenantId: t.tenantId,
    userId,
    processRunId: t.processRunId,
    taskId: t.taskId,
    payload: {
      process_name: t.processName,
      stage_name: t.stageName,
      released_from: t.claimedBy,
      to_admin: t.head === null,
    },
    processName: t.processName,
    stageName: t.stageName,
  }));
}
