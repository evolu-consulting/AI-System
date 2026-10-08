// HUB-FR-77 · CR-054 · kế hoạch run cho tin không tag ở Hỏi AI: agent mặc định của tenant (`default-agent.rules`).
import type { DefaultRoute } from "../agents/default-agent.rules";
import { responderOf } from "../mention/mention.rules";
import type { DirectRunStart } from "../mention/mention.service";

/**
 * Tin không tag ở Hỏi AI (chỉ route C1 `text`) ⇒ agent mặc định của tenant. Phòng (`@orchestrator`, trả lời câu hỏi
 * của run) và tin tag không dùng mặc định.
 */
export const UNTAGGED = { kind: "untagged" } as const;
export type Untagged = typeof UNTAGGED;

/** Agent mặc định là agent thường ⇒ chạy thẳng như tin tag agent đó; còn lại giữ plan người gọi (bỏ `UNTAGGED`). */
export function planOf<P extends { kind: string }>(
  route: DefaultRoute | undefined,
  requested: P | Untagged | undefined,
  locale: Parameters<typeof responderOf>[1],
  content: string,
): P | DirectRunStart | undefined {
  if (route?.kind === "direct")
    return {
      kind: "direct",
      agent: route.agent,
      responder: responderOf(route.agent, locale),
      content,
    };
  return requested?.kind === "untagged" ? undefined : (requested as P | undefined);
}
