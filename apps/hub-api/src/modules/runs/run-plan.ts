// HUB-FR-77 · CR-054 · kế hoạch run cho tin không tag ở Hỏi AI: agent mặc định của tenant (`default-agent.rules`).
import type { AccessSubject } from "../agents/agent-access.rules";
import { type DefaultRoute, defaultRoute } from "../agents/default-agent.rules";
import type { ConfigSnapshot } from "../config/config.rules";
import { responderOf } from "../mention/mention.rules";
import type { DirectRunStart } from "../mention/mention.service";
import { type FastRoute, fastRoute } from "./fast-route.rules";

/**
 * Tin không tag (đã loại flow chờ trả lời): route mặc định CR-054 + chat-fast (`fastOn` ∧ AU đúng một agent ⇒ `fast`, bỏ job
 * Orchestrator). `forbidden` (agent mặc định người gửi không được dùng): cờ tắt ⇒ người gọi ném 403 như CR-054; chat-fast2 cờ
 * bật ⇒ về Orchestrator như tenant chưa cấu hình (`legacy`, delegate vẫn qua `canDelegate`). Không phải tin không tag ⇒ vắng.
 */
export function untaggedRoute(
  untagged: boolean,
  s: ConfigSnapshot,
  who: AccessSubject,
  fastOn = false,
): { route?: DefaultRoute; fast: FastRoute | null } {
  if (!untagged) return { fast: null };
  const base = defaultRoute(s, who);
  const route: DefaultRoute = fastOn && base.kind === "forbidden" ? { kind: "legacy" } : base;
  return { route, fast: fastOn ? fastRoute(s, who, route) : null };
}

/** chat-fast2 · `@orchestrator …` ở Hỏi AI (cờ bật): ép qua Orchestrator đủ AU, bỏ agent mặc định / định tuyến nhanh. */
export const FORCE_ORCHESTRATOR = { kind: "orchestrator" } as const;
export type ForceOrchestrator = typeof FORCE_ORCHESTRATOR;
/** Tag ép Orchestrator (so lower, như tag `@`). */
export const ORCHESTRATOR_TAG = "orchestrator";

/**
 * Tin không tag ở Hỏi AI (chỉ route C1 `text`) ⇒ agent mặc định của tenant. Phòng (`@orchestrator`, trả lời câu hỏi
 * của run) và tin tag không dùng mặc định.
 */
export const UNTAGGED = { kind: "untagged" } as const;
export type Untagged = typeof UNTAGGED;

/** Agent mặc định là agent thường ⇒ chạy thẳng như tin tag agent đó; còn lại giữ plan người gọi (bỏ `UNTAGGED`). */
export function planOf<P extends { kind: string }>(
  route: DefaultRoute | undefined,
  requested: P | Untagged | ForceOrchestrator | undefined,
  locale: Parameters<typeof responderOf>[1],
  content: string,
): P | DirectRunStart | undefined {
  if (requested?.kind === "orchestrator") return undefined;
  if (route?.kind === "direct")
    return {
      kind: "direct",
      agent: route.agent,
      responder: responderOf(route.agent, locale),
      content,
    };
  return requested?.kind === "untagged" ? undefined : (requested as P | undefined);
}
