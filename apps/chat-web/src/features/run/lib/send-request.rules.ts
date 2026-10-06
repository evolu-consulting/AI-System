// X1-AC03 · HUB-FR-11 · body E12 từ đầu vào của composer (plan-frontend §0 D4): bỏ trường rỗng, giữ thứ tự `attachment_ids`.
import type { MessageContext, SendMessageRequest } from "@ai/contracts/chat";

export type BuildSendInput = {
  content: string;
  flowId?: string;
  context?: Partial<Record<keyof MessageContext, string>>;
  attachmentIds?: string[];
};

const CONTEXT_KEYS = ["selection", "page_url", "page_text"] as const;

function cleanContext(
  context: BuildSendInput["context"],
): SendMessageRequest["context"] | undefined {
  if (!context) return undefined;
  const out: NonNullable<SendMessageRequest["context"]> = {};
  for (const k of CONTEXT_KEYS) {
    const v = context[k];
    if (v) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildSendRequest(input: BuildSendInput): SendMessageRequest {
  const body: SendMessageRequest = { content: input.content };
  if (input.flowId) body.flow_id = input.flowId;
  const context = cleanContext(input.context);
  if (context) body.context = context;
  if (input.attachmentIds && input.attachmentIds.length > 0) {
    body.attachment_ids = [...input.attachmentIds];
  }
  return body;
}
