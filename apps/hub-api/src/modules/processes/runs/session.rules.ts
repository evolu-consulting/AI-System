// HUB-FR-136 (SHOULD) · R12 · AC-PB2-10 · G-2 · G-7 · plan D11/§4.2: quyết định dùng/resume/xoá session Claude của job stage.
// Resume chỉ do Hub điều khiển (`use_session` + xoá `hub.cli_sessions`), Runtime không đổi. Thuần.

/** G-7 · session cũ hơn ngưỡng này ⇒ coi như không có (chạy mới + xoá hàng). */
export const SESSION_RESUME_MAX_AGE_S = 86_400;

export type SessionCtx = {
  executor: "agent" | "team";
  /** attempt > 1 ∨ round > 1. */
  rerun: boolean;
  /** Có ask `answer` của stage_run quyết SAU lần chạy mới nhất (tiếp sau trả lời). */
  continuing: boolean;
  /** ∃ stage khác cùng bước dùng cùng agent (snapshot) ⇒ không dùng session chung. */
  sameAgentInStep: boolean;
  /** Lần chạy `succeeded` mới nhất của agent này trong run (không tính team) là chính stage này. */
  lastWriterIsSelf: boolean;
  /** Có hàng `cli_sessions` (hội thoại nền, agent, provider) ∧ tuổi ≤ `SESSION_RESUME_MAX_AGE_S`. */
  sessionExists: boolean;
};
export type SessionPlan = { useSession: boolean; resume: boolean; clearSession: boolean };

const plan = (useSession: boolean, resume: boolean, clearSession: boolean): SessionPlan => ({
  useSession,
  resume,
  clearSession,
});

/** Thứ tự: team (giữ cũ) → cùng agent cùng bước (không session) → tiếp sau trả lời → làm lại cùng người viết → chạy mới. */
export function sessionPlan(c: SessionCtx): SessionPlan {
  if (c.executor === "team") return plan(true, false, false);
  if (c.sameAgentInStep) return plan(false, false, false);
  if (c.continuing) return c.sessionExists ? plan(true, true, false) : plan(true, false, true);
  if (c.rerun && c.lastWriterIsSelf && c.sessionExists) return plan(true, true, false);
  return plan(true, false, true);
}

/** Prompt resume làm lại: CHỈ góp ý (+ mục cần sửa) — agent đã có ngữ cảnh trong session. */
export function deltaPrompt(feedback: string, sections: readonly string[] | null): string {
  const head = `Góp ý cần sửa:\n${feedback.trim()}`;
  return sections && sections.length > 0 ? `${head}\n\nMục cần sửa: ${sections.join(", ")}` : head;
}
