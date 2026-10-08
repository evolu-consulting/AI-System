// HUB-FR-77 · CR-054 · luật thuần của `/agent-settings`: kiểm agent mặc định / dự phòng, chặn tắt agent đang dùng.
import type { AgentDefaults } from "@ai/contracts/hub-admin";

/** Trạng thái một agent đối với tenant đích (đọc từ DB). */
export type AgentState = {
  id: string;
  enabled: boolean;
  entitled: boolean;
  isOrchestrator: boolean;
};

export type DefaultsProblem =
  | { code: "INVALID_REFERENCE"; field: "default_agent_id" | "fallback_agent_id" }
  | { code: "NOT_ENTITLED"; field: "default_agent_id" | "fallback_agent_id" };

/**
 * Agent mặc định: tồn tại ∧ bật ∧ bật cho công ty. Dự phòng chỉ có nghĩa khi mặc định là Orchestrator: phải tồn tại ∧ bật ∧
 * bật cho công ty ∧ không phải Orchestrator ∧ ≠ mặc định. Mặc định không phải Orchestrator ⇒ bỏ dự phòng (`normalize`).
 */
export function defaultsProblem(
  d: AgentDefaults,
  find: (id: string) => AgentState | undefined,
): DefaultsProblem | null {
  const def = find(d.default_agent_id);
  if (!def?.enabled) return { code: "INVALID_REFERENCE", field: "default_agent_id" };
  if (!def.entitled) return { code: "NOT_ENTITLED", field: "default_agent_id" };
  if (!def.isOrchestrator || d.on_no_match !== "fallback" || d.fallback_agent_id === null)
    return null;
  const fb = find(d.fallback_agent_id);
  if (!fb?.enabled || fb.isOrchestrator || fb.id === def.id)
    return { code: "INVALID_REFERENCE", field: "fallback_agent_id" };
  if (!fb.entitled) return { code: "NOT_ENTITLED", field: "fallback_agent_id" };
  return null;
}

/**
 * Mặc định không phải Orchestrator ⇒ không có dự phòng (`answer` cho đủ CHECK). Orchestrator mà `on_no_match` ≠
 * `fallback` ⇒ bỏ `fallback_agent_id` (không giữ id không dùng — nó sẽ chặn tắt agent đó, `blocksDisable`).
 */
export function normalizeDefaults(d: AgentDefaults, isOrchestrator: boolean): AgentDefaults {
  if (!isOrchestrator)
    return { default_agent_id: d.default_agent_id, fallback_agent_id: null, on_no_match: "answer" };
  return d.on_no_match === "fallback" ? d : { ...d, fallback_agent_id: null };
}

/** Tắt agent cho công ty khi nó đang là mặc định hoặc dự phòng ⇒ chặn (`AGENT_IS_DEFAULT`). */
export function blocksDisable(
  agentId: string,
  current: Pick<AgentDefaults, "default_agent_id" | "fallback_agent_id"> | null,
): boolean {
  return (
    !!current && (current.default_agent_id === agentId || current.fallback_agent_id === agentId)
  );
}
