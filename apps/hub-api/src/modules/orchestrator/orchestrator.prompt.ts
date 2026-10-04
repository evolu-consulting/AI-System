// HUB-FR-20 · H1-R05, R06 · `prompt` + khối định dạng của job Orchestrator (plan H1 §6.2–6.3). Thuần.
import { type HistoryItem, OrchestratorDecisionSchema } from "@ai/contracts/hub";
import { z } from "zod";
import type { HubAgentRef } from "../agents/agent-access.rules";

/** Mỗi tin trong `<history>` ≤ 4000 ký tự (§6.2). */
export const HISTORY_ITEM_MAX = 4000;

/** Câu nhắc khi thử lại vì JSON hỏng (§6.3, nguyên văn). */
export const RETRY_REMINDER = "Lần trước không phải JSON hợp lệ theo schema. Chỉ trả JSON.";

const DECISION_SCHEMA = JSON.stringify(z.toJSONSchema(OrchestratorDecisionSchema));

/** §6.3 · nối cuối `system_prompt` của Orchestrator. */
export const FORMAT_BLOCK =
  `Chỉ trả về MỘT object JSON theo JSON Schema sau, không chữ khác, không code fence: ${DECISION_SCHEMA}. ` +
  "`delegate` chỉ key trong <agents>; không agent phù hợp → `answer`; mơ hồ → `ask`; " +
  "`waiting_for` khác null và tin là câu trả lời → `delegate` agent đó.";

export type FlowHint = { last_agent: string | null; waiting_for: string | null };

/** Kết quả một step trong run, đưa lại cho Orchestrator qua `<steps>`. */
export type StepNote =
  | { agent: string; status: "done"; text: string }
  | { agent: string; status: "partial"; text: string; missing: string }
  | { agent: string; status: "skipped"; reason: "not_allowed" };

export type PromptInput = {
  agents: readonly HubAgentRef[];
  hint: FlowHint;
  history: readonly HistoryItem[];
  steps: readonly StepNote[];
  stepsLeft: number;
  message: string;
};

const cut = (s: string, max: number): string => {
  const pts = [...s];
  return pts.length <= max ? s : pts.slice(0, max).join("");
};

const tag = (name: string, body: string): string => `<${name}>\n${body}\n</${name}>`;
/** JSON không chứa `<` thô: nội dung người dùng không đóng được khối (vd `</message>`). */
const json = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");

export function orchestratorSystemPrompt(base: string): string {
  return base ? `${base}\n\n${FORMAT_BLOCK}` : FORMAT_BLOCK;
}

/** §6.2 · các khối theo thứ tự, nội dung JSON. */
export function orchestratorPrompt(p: PromptInput, retry = false): string {
  const blocks = [
    tag("agents", json(p.agents.map((a) => ({ key: a.key, description: a.description })))),
    tag("flow_hint", json(p.hint)),
    tag(
      "history",
      json(p.history.map((h) => ({ role: h.role, content: cut(h.content, HISTORY_ITEM_MAX) }))),
    ),
    tag("steps", json(p.steps)),
    tag("steps_left", String(Math.max(0, p.stepsLeft))),
    tag("message", json(p.message)),
  ];
  if (retry) blocks.push(RETRY_REMINDER);
  return blocks.join("\n");
}
