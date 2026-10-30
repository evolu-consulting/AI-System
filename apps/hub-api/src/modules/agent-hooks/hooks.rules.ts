// dlc-dify · luật thuần của hook agent (giống hook Claude CLI, mỗi sự kiện = một workflow Dify loại `workflow`):
// input chuẩn gửi cho workflow (chỉ giữ biến workflow khai báo), ghép ngữ cảnh hook vào lời nhắc hệ thống, đọc quyết định
// PreToolUse. Không I/O.
import type { AgentHookEvent } from "@ai/contracts/studio";

export const HOOK_APP_TYPE = "workflow";
/** Hook chạy trước job: phải nhanh (người dùng đang chờ). Stop/PostToolUse chạy nền nên được lâu hơn. */
export const HOOK_TIMEOUT_MS: Record<"pre" | "post", number> = { pre: 45_000, post: 120_000 };
/** Phần ngữ cảnh hook tối đa ghép vào lời nhắc hệ thống (cả khối). */
export const HOOK_CONTEXT_MAX = 12_000;
/** Mỗi biến chữ gửi Dify (tránh vượt giới hạn ô `paragraph` của Dify). */
const INPUT_MAX = 30_000;

/** Biến đầu vào chuẩn của mọi workflow hook (workflow khai báo biến nào thì nhận biến đó). */
export type HookInputs = {
  event: AgentHookEvent;
  agent_key: string;
  /** Project persona trong KH (`runtime_options.persona_project`, vắng ⇒ `agent-<key>`). */
  persona_project: string;
  /** Access token AI-System của người dùng (KH fork xác thực TU/RU từ token này). */
  user_token: string;
  /** Định danh phiên cho `X-KH-Actor` = flow của hội thoại. */
  actor: string;
  tenant_id: string;
  user_id: string;
  run_id: string;
  conversation_id: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: string;
  last_answer?: string;
};

export function personaProjectOf(agentKey: string, opts: Record<string, unknown>): string {
  const p = opts.persona_project;
  return typeof p === "string" && /^[a-z0-9][a-z0-9_-]{1,79}$/.test(p) ? p : `agent-${agentKey}`;
}

/** Chỉ giữ biến workflow khai báo (Dify từ chối/bỏ biến lạ tuỳ bản); chữ cắt ≤ INPUT_MAX. */
export function pickInputs(
  all: HookInputs,
  declared: readonly { name: string }[],
): Record<string, string> {
  const names = new Set(declared.map((d) => d.name));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all))
    if (names.has(k) && typeof v === "string") out[k] = v.slice(0, INPUT_MAX);
  return out;
}

/** Ghép ngữ cảnh các hook trước job vào lời nhắc hệ thống của agent; rỗng ⇒ giữ nguyên. */
export function withHookContext(
  systemPrompt: string,
  parts: readonly { event: string; text: string }[],
  max: number,
): string {
  const body = parts
    .filter((p) => p.text.trim() !== "")
    .map((p) => `<hook-context event="${p.event}">\n${p.text.trim()}\n</hook-context>`)
    .join("\n\n");
  if (body === "") return systemPrompt;
  const room = Math.max(0, max - systemPrompt.length - 2);
  const block =
    body.length > Math.min(room, HOOK_CONTEXT_MAX)
      ? `${body.slice(0, Math.min(room, HOOK_CONTEXT_MAX) - 20)}\n…(cắt bớt)`
      : body;
  return room <= 20 ? systemPrompt : `${systemPrompt}\n\n${block}`;
}

export type ToolDecision = { decision: "allow" | "ask" | "deny"; reason: string; context: string };

/**
 * PreToolUse: workflow trả `text` là JSON `{decision, reason, context}` (như `hookSpecificOutput` của Claude) hoặc chữ
 * thường (= chỉ ngữ cảnh). Hỏng / thiếu ⇒ `allow` (hook không bao giờ chặn vì lỗi của chính nó).
 */
export function toolDecisionOf(text: string): ToolDecision {
  const t = text.trim();
  if (t.startsWith("{")) {
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      const d = o.decision ?? o.permissionDecision;
      const decision = d === "deny" || d === "ask" ? d : "allow";
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      return {
        decision,
        reason: str(o.reason ?? o.permissionDecisionReason),
        context: str(o.context ?? o.additionalContext),
      };
    } catch {
      return { decision: "allow", reason: "", context: t };
    }
  }
  return { decision: "allow", reason: "", context: t };
}
