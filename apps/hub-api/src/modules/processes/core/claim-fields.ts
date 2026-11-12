// CR-127 · E2 · RA1 · `claim{state, by?, at?}` + `need` + `can_reassign` của TaskDetail (spec §4.2) — chỉ task nhóm `need='one'` loại
// duyệt/mốc mới có `claim`/`can_reassign`. `can_reassign` = `canReassign` (MỘT luật với `POST /review-tasks/:id/reassign`).
import type { TaskDetail } from "@ai/contracts/chat";
import {
  canReassign,
  claimable,
  claimState,
  type ReassignViewer,
} from "../domain/tasks/claim.rules";

export type ClaimRow = {
  kind: string;
  status: string;
  need?: "one" | "head" | "all" | null;
  group_id: string | null;
  claimed_by?: string | null;
  claimed_at?: Date | string | null;
  claimer_name?: string | null;
  assignee_head?: string | null;
};

export function claimFields(
  r: ClaimRow,
  v: ReassignViewer,
): Pick<TaskDetail, "claim" | "need" | "can_reassign"> {
  const need = r.need ?? "one";
  const facts = { kind: r.kind, status: r.status, need, groupId: r.group_id };
  if (!claimable(facts)) return { need };
  const can_reassign = canReassign(v, { ...facts, head: r.assignee_head ?? null });
  const state = claimState(r.claimed_by, v.userId);
  if (state === "unclaimed" || !r.claimed_by) return { need, can_reassign, claim: { state } };
  return {
    need,
    can_reassign,
    claim: {
      state,
      by: { id: r.claimed_by, display_name: r.claimer_name || r.claimed_by },
      ...(r.claimed_at && { at: new Date(r.claimed_at).toISOString() }),
    },
  };
}

/** CR-127 · E4 · `after.evidence` của stage ⇒ `evidence_mode` (vắng/lạ ⇒ undefined) — dùng chung `TaskDetail` và `stepsView`. */
export const evidenceModeOf = (v: unknown): "opinion" | "opinion_plus" | undefined =>
  v === "opinion" || v === "opinion_plus" ? v : undefined;
