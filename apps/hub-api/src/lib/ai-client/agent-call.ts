// price-scout · cổng "gọi một agent Hub một lượt" cho gói (lớp nền, cùng cửa AI client): model + lệnh hệ thống lấy từ agent đã
// seed/sửa trong Studio (`hub.agents` + bước 0 của profile; Studio ghi đè ⇒ `studio_overrides`, seed không đè) — gói KHÔNG giữ
// model/prompt. Lời gọi đi qua `AiClient` (trần token/tenant + một dòng usage có `agent_id`, `app`, `trigger`, `subject`).
// Runtime: `agentic-cli` / `llm` chạy qua nhà cung cấp của AI client (mặc định gói Claude CLI, tìm web bằng công cụ WebSearch;
// `AI_PROVIDER_<FEATURE>=api` ⇒ Anthropic API + tool web_search). Runtime `dify-*` không chạy được ở cổng này ⇒ `UNAVAILABLE`.
// Agent tắt / chưa seed ⇒ `UNAVAILABLE` (0 lời gọi). Không bao giờ ném.
import type { AiCallTags, AiClient, AiFailCode, AiUsage } from "./ai-client";

/** Cấu hình agent đọc từ Hub (Studio sửa được). `model` null ⇒ `DEFAULT_AGENT_MODEL`. */
export type AgentSpec = {
  id: string;
  enabled: boolean;
  runtime: string;
  systemPrompt: string;
  model: string | null;
};
export type AgentSpecOf = (key: string) => Promise<AgentSpec | null>;

/** Alias CLI (bậc std) khi profile không ghi model (vd profile dev `fake-1`). */
export const DEFAULT_AGENT_MODEL = "sonnet";
const DIRECT_RUNTIMES = new Set(["agentic-cli", "llm"]);

export type AgentCallRequest = {
  tenantId: string;
  userId: string | null;
  agentKey: string;
  /** Khoá tính năng usage `goi.viec`. */
  feature: string;
  /** Lời nhắc người dùng (dữ liệu do gói dựng). */
  prompt: string;
  webSearch?: boolean;
  maxTokens?: number;
  signal: AbortSignal;
} & Omit<AiCallTags, "agentId">;

export type AgentCallResult =
  | { ok: true; text: string; model: string; usage: AiUsage }
  | { ok: false; code: AiFailCode };

export type AgentCaller = {
  /** Agent dùng được ngay (bật + runtime chạy trực tiếp được); không gọi model. */
  ready(agentKey: string): Promise<boolean>;
  call(req: AgentCallRequest): Promise<AgentCallResult>;
};

const usable = (s: AgentSpec | null): s is AgentSpec =>
  s !== null && s.enabled && DIRECT_RUNTIMES.has(s.runtime) && s.systemPrompt.trim() !== "";

export function createAgentCaller(ai: AiClient, specOf: AgentSpecOf): AgentCaller {
  const spec = async (key: string): Promise<AgentSpec | null> => {
    try {
      return await specOf(key);
    } catch {
      return null;
    }
  };
  return {
    ready: async (key) => ai.ready && usable(await spec(key)),
    async call(req) {
      const s = await spec(req.agentKey);
      if (!usable(s)) return { ok: false, code: "UNAVAILABLE" };
      const { agentKey: _k, ...rest } = req;
      return ai.complete({
        ...rest,
        agentId: s.id,
        system: s.systemPrompt,
        model: s.model ?? DEFAULT_AGENT_MODEL,
      });
    },
  };
}
