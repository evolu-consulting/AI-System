// HUB-FR-143 · PD-R08 · P-d1 T7b-1: cách vào lại team_run mới nhất của (stage, attempt) khi launcher chạy stage team.
// Thuần, lớp 1 (chỉ built-in, không import contract).
import type { TeamRunStatus } from "../types";

/** `cursor < 0` viết nguyên văn: input thiếu `cursor` (test cũ) ⇒ `undefined < 0` = false ⇒ không phải trạng thái hỏng. */
export function teamResumePlan(
  cur: { status: TeamRunStatus; segmentStartedAt: Date | null; cursor: number } | null,
): "resume_answer" | "resume_retry" | "new" {
  if (cur === null) return "new";
  if (cur.status === "waiting_answer") return "resume_answer";
  if (cur.status === "running" && cur.segmentStartedAt === null && !(cur.cursor < 0)) {
    return "resume_retry";
  }
  return "new";
}
