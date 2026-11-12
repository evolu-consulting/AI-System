// CR-127 · E5 · spec §5.4 · R#13 · R#14 · Q12 · "Cần: tất cả" ở cổng kiểm (task `need='all'`): MỘT thẻ, mỗi người trong tập một phiếu
// (`hub.review_task_votes`). Chạy TRONG tx quyết định, SAU khi khoá run `FOR UPDATE` (§10) ⇒ phiếu đồng thời nối tiếp, người sau thấy phiếu
// đã COMMIT của người trước ⇒ chỉ MỘT lần chuyển bước. Khác "A + B cùng duyệt" (CR-125 `parallel-approve`: một thẻ mỗi nhóm).
// - Duyệt chưa đủ n ⇒ chỉ ghi phiếu (+ bằng chứng của phiếu), thẻ vẫn mở (`allPartialOut`).
// - Duyệt đủ n/n, hoặc một Trả lại/Từ chối ⇒ `final`: người gọi đi đường quyết định thường (đóng thẻ, chuyển bước).
// - Người không có phiếu: chỉ quyết được như việc một người khi có hàng chuyển cấp riêng / nhóm chuyển cấp / nhóm "cũng quyết" (đường
//   quá hạn — phiếu đã có giữ nguyên trong hồ sơ); thành viên phòng không có trong tập ⇒ 404. Bỏ phiếu lần hai ⇒ 409 `REVIEW_TASK_CLOSED`.
import type { ReviewDecisionRequest, TaskDetail } from "@ai/contracts/chat";
import type { UserEvent } from "../../../lib/user-stream";
import { allVoteFacts, insertVote } from "../core/all-vote.sql";
import { processError } from "../core/errors";
import { processUpdated } from "../core/events";
import { loadTaskDetails, type ViewerCtx } from "../core/task-view";
import { voteAs, voteVerdict } from "../domain/tasks/all-vote.rules";
import { recordTaskEvidence } from "./gate-task.repo";
import { type Gx, type Locked, notFound } from "./gates.effects";
import type * as g from "./gates.repo";

/** `evidenceId` = bằng chứng đã ghi cùng phiếu (người gọi không ghi lần hai); null khi không có phiếu / phiếu không kèm bằng chứng. */
export type AllVoteOut = {
  mode: "none" | "single" | "partial" | "final";
  evidenceId: string | null;
};

/** Bước thường (`need` ≠ 'all') ⇒ `none`, không câu SQL nào. */
export async function allVoteStep(
  gx: Gx,
  p: { run: Locked; task: g.GateTask; b: ReviewDecisionRequest },
  viewer: { userId: string; groupIds: ReadonlySet<string> },
  onEvidence?: (evidenceId: string) => void,
): Promise<AllVoteOut> {
  const { run, task, b } = p;
  if (task.need !== "all") return { mode: "none", evidenceId: null };
  const key = { taskId: task.id, tenantId: run.tenantId, userId: viewer.userId };
  const f = await allVoteFacts(gx.tx, key);
  if (!f.open) throw processError("REVIEW_TASK_CLOSED"); // đọc SAU khoá run: thẻ đã chốt bởi phiếu/quyết định trước
  const as = voteAs(viewer.userId, f.voters, f.votes, f.delegatedFor);
  if (as.kind === "voted") throw processError("REVIEW_TASK_CLOSED", { already_voted: true });
  if (as.kind === "excluded") throw notFound();
  if (as.kind === "none") {
    const inGroup = (id: string | null | undefined) => !!id && viewer.groupIds.has(id);
    const alt =
      f.escalatedUser ||
      inGroup(task.escalated_group_id) ||
      (task.also_group_ids ?? []).some(inGroup);
    if (alt) return { mode: "single", evidenceId: null };
    throw notFound();
  }
  // Bằng chứng mỗi phiếu (E4): `on_behalf_of` = A tự gắn khi người bỏ là người được uỷ quyền.
  const evidenceId = b.evidence
    ? await recordTaskEvidence(gx.tx, { ...key, evidence: b.evidence })
    : null;
  const ok = await insertVote(gx.tx, {
    taskId: task.id,
    tenantId: run.tenantId,
    userId: as.userId,
    onBehalfOf: as.onBehalfOf,
    result: b.result,
    evidenceId,
    at: gx.d.now(),
  });
  if (!ok) throw processError("REVIEW_TASK_CLOSED", { already_voted: true });
  if (evidenceId) onEvidence?.(evidenceId);
  const mode = voteVerdict(f.voters, f.votes, { userId: as.userId, result: b.result });
  return { mode, evidenceId };
}

/** Duyệt chưa đủ n: thẻ vẫn mở (không đóng, không chuyển bước) — trả thẻ (tiến độ x/n, `can_act=false` cho người vừa bỏ) + `process.updated`. */
export async function allPartialOut(
  gx: Gx,
  run: Locked,
  taskId: string,
  viewer: ViewerCtx & { recipients: string[] },
): Promise<{ body: TaskDetail; events: UserEvent[]; kick: false; runId: string }> {
  const [body] = await loadTaskDetails(gx.tx, viewer, [taskId]);
  if (!body) throw notFound();
  const u = { id: run.id, status: run.status, stageIdx: Number(run.currentStageIdx) };
  const events = processUpdated(viewer.recipients, {
    ...u,
    step: Number(run.currentStep),
  } as never);
  return { body, events, kick: false, runId: run.id };
}
