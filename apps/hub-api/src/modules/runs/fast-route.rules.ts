// HUB-FR-77 · HUB-BR-03 · chat-fast · định tuyến nhanh tin không tag (không LLM). Thuần.
// Tin không tag mà sẽ đi vào Orchestrator (`legacy` / `orchestrator`) nhưng AU của người gửi chỉ có ĐÚNG MỘT agent ⇒ Orchestrator
// chỉ có thể delegate agent đó (hoặc tự trả lời) ⇒ chạy thẳng run `direct` như `@agent`, bỏ một job CLI (Orchestrator).
// Quyền: AU = `visibleAgents(accessInput(snapshot, who))` — đúng hàm mà `canDelegate` của vòng Orchestrator và `directOnSnapshot`
// dùng (bật ∧ entitlement tenant ∧ grant user/group/tenant ∧ ≠ Orchestrator ∧ runtime chạy được) ⇒ không nới quyền.
// Không áp khi: chính sách "không khớp" = `ask` (Orchestrator phải hỏi lại), `forbidden`, `direct` (CR-054 đã thẳng), AU ≠ 1.
import { type AccessSubject, accessInput, visibleAgents } from "../agents/agent-access.rules";
import type { DefaultRoute } from "../agents/default-agent.rules";
import type { AgentConfig, ConfigSnapshot } from "../config/config.rules";

export type FastRoute = { kind: "direct"; agent: AgentConfig; rule: "single_agent" };

/** Route mặc định cho phép bỏ Orchestrator: `legacy` (chưa cấu hình) hoặc Orchestrator với "không khớp" ≠ `ask`. */
function skippable(route: DefaultRoute | undefined): boolean {
  if (route?.kind === "legacy") return true;
  return route?.kind === "orchestrator" && route.noMatch.kind !== "ask";
}

/** null = giữ đường Orchestrator. */
export function fastRoute(
  s: ConfigSnapshot,
  who: AccessSubject,
  route: DefaultRoute | undefined,
): FastRoute | null {
  if (!skippable(route)) return null;
  const au = visibleAgents(accessInput(s, who));
  if (au.length !== 1) return null;
  const agent = s.agents.find((a) => a.id === au[0]?.id);
  return agent ? { kind: "direct", agent, rule: "single_agent" } : null;
}
