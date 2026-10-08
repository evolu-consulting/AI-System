// HUB-FR-20 · H1-R05, R06 · `prompt` + khối định dạng của job Orchestrator (plan H1 §6.2–6.3). Thuần.
import { type HistoryItem, OrchestratorDecisionSchema } from "@ai/contracts/hub";
import { z } from "zod";
import type { HubAgentRef } from "../agents/agent-access.rules";
import type { NoMatchPolicy } from "../agents/default-agent.rules";
import { type FileBrief, orchestratorFilesBlock } from "../attachments/run-files.rules";

/** Mỗi tin trong `<history>` ≤ 4000 ký tự (§6.2). */
export const HISTORY_ITEM_MAX = 4000;

/** Câu nhắc khi thử lại vì JSON hỏng (§6.3, nguyên văn). */
export const RETRY_REMINDER = "Lần trước không phải JSON hợp lệ theo schema. Chỉ trả JSON.";

const DECISION_SCHEMA = JSON.stringify(z.toJSONSchema(OrchestratorDecisionSchema));

/** CR-054 · câu "không agent phù hợp → …" theo chính sách của tenant (vắng = `answer` như H1). */
function noMatchRule(p?: NoMatchPolicy): string {
  if (p?.kind === "fallback")
    return `không agent chuyên môn phù hợp → \`delegate\` agent \`${p.agent.key}\``;
  if (p?.kind === "ask") return "không agent phù hợp → `ask`";
  return "không agent phù hợp → `answer`";
}

/** §6.3 · nối cuối `system_prompt` của Orchestrator (CR-054: câu "không khớp" theo chính sách). */
export const formatBlock = (p?: NoMatchPolicy): string =>
  `Chỉ trả về MỘT object JSON theo JSON Schema sau, không chữ khác, không code fence: ${DECISION_SCHEMA}. ` +
  `\`delegate\` chỉ key trong <agents>; ${noMatchRule(p)}; mơ hồ → \`ask\`; ` +
  "`waiting_for` khác null và tin là câu trả lời → `delegate` agent đó.";

export const FORMAT_BLOCK = formatBlock();

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
  /** H2c P11 · tập file của run (R15); ≥ 1 → khối `<attachments>` ngay trước `<message>`; vắng/rỗng → như H1. */
  attachments?: readonly FileBrief[];
};

const cut = (s: string, max: number): string => {
  const pts = [...s];
  return pts.length <= max ? s : pts.slice(0, max).join("");
};

const tag = (name: string, body: string): string => `<${name}>\n${body}\n</${name}>`;
/** JSON không chứa `<` thô: nội dung người dùng không đóng được khối (vd `</message>`). */
const json = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c");

export function orchestratorSystemPrompt(base: string, noMatch?: NoMatchPolicy): string {
  const block = formatBlock(noMatch);
  return base ? `${base}\n\n${block}` : block;
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
  ];
  const files = orchestratorFilesBlock(p.attachments ?? []);
  if (files) blocks.push(files);
  blocks.push(tag("message", json(p.message)));
  if (retry) blocks.push(RETRY_REMINDER);
  return blocks.join("\n");
}
