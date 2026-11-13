// CR-127 · E2 · spec §5.1 · §4.2 · "Nhận việc" / "Trả về nhóm" / "Giao cho người khác" của task nhóm `need='one'`.
// Nhận = MỘT câu UPDATE có điều kiện (đua: một người thắng, người sau 409 `TASK_CLAIMED{by}`); đọc lại chỉ ở đường hụt ⇒ ≤ 2 câu.
// Scope user (RLS T) như cổng duyệt; người không thuộc nhóm / khác tenant ⇒ 404 (không lộ task).
import type { ClaimTaskResponse, ReassignReviewTaskRequest } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import * as cr from "../adapters/claim/claim.repo";
import type { NoticeRow } from "../application/ports";
import { claimError, processN2Error } from "../core/errors";
import type { PackTaskEventIn, ProcessDeps } from "../core/ports";
import { claimMissOutcome, reassignBlock } from "../domain/tasks/claim.rules";
import { writeNotices } from "../notify/batch.repo";
import { emitPackTaskEvents } from "../runs/pack-task-events";
import { notFound } from "./gates.effects";

type Ctx = { u: AuthUser; tenantId: string; groupIds: ReadonlySet<string> };
const person = (id: string, name: string | null) => ({ id, display_name: name || id });

export class ClaimService {
  constructor(
    private readonly d: Pick<ProcessDeps, "db" | "config" | "now"> &
      Partial<Pick<ProcessDeps, "log" | "packTaskEvents">>,
  ) {}

  /** [AUDIT] · đã COMMIT ⇒ báo gói một dòng lịch sử (run gắn gói). Không ném. */
  async #emit(c: Ctx, taskId: string, kind: PackTaskEventIn["kind"], to: string | null = null) {
    const { db, log, packTaskEvents } = this.d;
    if (!packTaskEvents || !log) return;
    const at = this.d.now().toISOString();
    const e = { tenantId: c.tenantId, taskId, kind, actor: c.u.userId, to, reason: null, at };
    await emitPackTaskEvents({ db, log, packTaskEvents }, [e]);
  }

  async #ctx(u: AuthUser, tq?: string): Promise<Ctx> {
    const groupIds = (await this.d.config.user(u.userId))?.groupIds ?? new Set<string>();
    const tenantId = u.role === "platform_admin" && tq ? tq : u.tenantId;
    return { u, tenantId, groupIds };
  }

  #tx<T>(c: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withHubScope(this.d.db, { kind: "user", userId: c.u.userId, tenantId: c.tenantId }, fn);
  }

  // ── POST /review-tasks/:id/claim ──
  async claim(u: AuthUser, taskId: string, tq?: string): Promise<ClaimTaskResponse> {
    const c = await this.#ctx(u, tq);
    let won = false;
    const out = await this.#tx(c, async (tx) => {
      const a = { taskId, tenantId: c.tenantId, groupIds: c.groupIds };
      const hit = await cr.claimTask(tx, { ...a, userId: u.userId, now: this.d.now() });
      won = hit !== null;
      if (hit) return mine(u.userId, hit.byName, hit.claimedAt);
      const m = await cr.claimMiss(tx, { ...a, userId: u.userId });
      const out = claimMissOutcome(m, u.userId);
      if (out === "not_found" || !m) throw notFound();
      if (out === "STARTER_CANNOT_REVIEW") throw processN2Error(out);
      if (out === "mine") return mine(u.userId, m.byName, m.claimedAt ?? this.d.now());
      if (out === "TASK_CLAIMED")
        throw claimError("TASK_CLAIMED", { by: person(m.claimedBy as string, m.byName) });
      throw claimError(out);
    });
    if (won) await this.#emit(c, taskId, "claim");
    return out;
  }

  // ── POST /review-tasks/:id/release — chỉ người đang giữ ──
  async release(u: AuthUser, taskId: string, tq?: string): Promise<ClaimTaskResponse> {
    const c = await this.#ctx(u, tq);
    const out = await this.#tx<ClaimTaskResponse>(c, async (tx) => {
      const a = { taskId, tenantId: c.tenantId };
      if (await cr.releaseTask(tx, { ...a, userId: u.userId }))
        return { claim: { state: "unclaimed" } };
      const m = await cr.claimMiss(tx, { ...a, groupIds: c.groupIds });
      if (!m || (!m.member && m.claimedBy !== u.userId)) throw notFound();
      if (m.status !== "open") throw claimError("TASK_CLOSED");
      throw claimError("NOT_CLAIMER");
    });
    await this.#emit(c, taskId, "release");
    return out;
  }

  // ── POST /review-tasks/:id/reassign — trưởng phòng của nhóm / quản trị công ty giao cho một người trong nhóm ──
  async reassign(
    u: AuthUser,
    taskId: string,
    b: ReassignReviewTaskRequest,
    tq?: string,
  ): Promise<ClaimTaskResponse> {
    const c = await this.#ctx(u, tq);
    let notice: NoticeRow | null = null;
    const out = await this.#tx<ClaimTaskResponse>(c, async (tx) => {
      const a = { taskId, tenantId: c.tenantId };
      const t = await cr.reassignTarget(tx, { ...a, toUserId: b.to_user_id });
      assertMayReassign(u, t);
      const hit = await cr.assignClaim(tx, { ...a, toUserId: b.to_user_id, now: this.d.now() });
      if (!hit) throw claimError("TASK_CLOSED");
      // CR-127 · E3b · báo người được giao (ghi sau COMMIT ở scope system — RLS notice chỉ cho system ghi). Chính mình ⇒ không báo.
      if (b.to_user_id !== u.userId)
        notice = {
          tenantId: c.tenantId,
          userId: b.to_user_id,
          processRunId: t.processRunId,
          taskId,
          payload: {
            process_name: t.processName,
            stage_name: t.stageName,
            assigned_by: u.userId,
            note: b.note,
          },
        };
      return {
        claim: {
          state: b.to_user_id === u.userId ? "mine" : "other",
          by: person(b.to_user_id, hit.byName),
          at: hit.claimedAt.toISOString(),
        },
      };
    });
    if (notice)
      await withHubScope(this.d.db, { kind: "system" }, (tx) =>
        writeNotices(tx, "review_requested", [notice as NoticeRow]),
      );
    await this.#emit(c, taskId, "reassign", b.to_user_id);
    return out;
  }
}

/** Thứ tự lỗi: không thấy 404 · không phải trưởng phòng/quản trị 403 · đã xong · không cần nhận · người nhận ngoài phòng 422. */
function assertMayReassign(
  u: AuthUser,
  t: cr.ReassignTarget | null,
): asserts t is cr.ReassignTarget {
  if (!t) throw notFound();
  const role = u.role === "platform_admin" || u.role === "tenant_admin" ? u.role : "member";
  const block = reassignBlock({ userId: u.userId, role }, t); // cùng luật với cờ `can_reassign`
  if (block) throw claimError(block);
  if (!t.targetInGroup) throw claimError("TARGET_NOT_IN_GROUP");
}

function mine(userId: string, name: string | null, at: Date): ClaimTaskResponse {
  return { claim: { state: "mine", by: person(userId, name), at: at.toISOString() } };
}
