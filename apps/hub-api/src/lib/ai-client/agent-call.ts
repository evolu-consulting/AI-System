// price-scout Â· cá»•ng "gá»i má»™t agent Hub má»™t lÆ°á»£t" cho gÃ³i (lá»›p ná»n, cÃ¹ng cá»­a AI client): model + lá»‡nh há»‡ thá»‘ng láº¥y tá»« agent Ä‘Ã£
// seed/sá»­a trong Studio (`hub.agents` + bÆ°á»›c 0 cá»§a profile; Studio ghi Ä‘Ã¨ â‡’ `studio_overrides`, seed khÃ´ng Ä‘Ã¨) â€” gÃ³i KHÃ”NG giá»¯
// model/prompt. Lá»i gá»i Ä‘i qua `AiClient` (tráº§n token/tenant + má»™t dÃ²ng usage cÃ³ `agent_id`, `app`, `trigger`, `subject`).
// Runtime: `agentic-cli` / `llm` cháº¡y qua nhÃ  cung cáº¥p cá»§a AI client (máº·c Ä‘á»‹nh gÃ³i Claude CLI, tÃ¬m web báº±ng cÃ´ng cá»¥ WebSearch;
// `AI_PROVIDER_<FEATURE>=api` â‡’ Anthropic API + tool web_search). Runtime `dify-*` khÃ´ng cháº¡y Ä‘Æ°á»£c á»Ÿ cá»•ng nÃ y â‡’ `UNAVAILABLE`.
// Agent táº¯t / chÆ°a seed â‡’ `UNAVAILABLE` (0 lá»i gá»i). KhÃ´ng bao giá» nÃ©m.
import type { AiCallTags, AiClient, AiFailCode, AiUsage } from "./ai-client";

/** Cáº¥u hÃ¬nh agent Ä‘á»c tá»« Hub (Studio sá»­a Ä‘Æ°á»£c). `model` null â‡’ `DEFAULT_AGENT_MODEL`. */
export type AgentSpec = {
  id: string;
  enabled: boolean;
  runtime: string;
  systemPrompt: string;
  model: string | null;
  /** agents-background Â· false â‡’ quáº£n trá»‹ ná»n táº£ng Ä‘Ã£ táº¯t agent ná»n nÃ y cho cÃ´ng ty (váº¯ng â‡’ báº­t). */
  entitled?: boolean;
};
/** `tenantId` váº¯ng â‡’ khÃ´ng xÃ©t táº¯t-theo-cÃ´ng ty. */
export type AgentSpecOf = (key: string, tenantId?: string) => Promise<AgentSpec | null>;

/** Alias CLI (báº­c std) khi profile khÃ´ng ghi model (vd profile dev `fake-1`). */
export const DEFAULT_AGENT_MODEL = "sonnet";
const DIRECT_RUNTIMES = new Set(["agentic-cli", "llm"]);

export type AgentCallRequest = {
  tenantId: string;
  userId: string | null;
  agentKey: string;
  /** KhoÃ¡ tÃ­nh nÄƒng usage `goi.viec`. */
  feature: string;
  /** Lá»i nháº¯c ngÆ°á»i dÃ¹ng (dá»¯ liá»‡u do gÃ³i dá»±ng). */
  prompt: string;
  webSearch?: boolean;
  maxTokens?: number;
  signal: AbortSignal;
} & Omit<AiCallTags, "agentId">;

export type AgentCallResult =
  | { ok: true; text: string; model: string; usage: AiUsage }
  | { ok: false; code: AiFailCode | "DISABLED" };

export type AgentCaller = {
  /** Agent dÃ¹ng Ä‘Æ°á»£c ngay (báº­t + runtime cháº¡y trá»±c tiáº¿p Ä‘Æ°á»£c); khÃ´ng gá»i model. */
  ready(agentKey: string): Promise<boolean>;
  /** agents-background Â· agent ná»n chÆ°a bá»‹ quáº£n trá»‹ ná»n táº£ng táº¯t cho cÃ´ng ty nÃ y (0 lá»i gá»i model; lá»—i Ä‘á»c â‡’ true). */
  enabledFor(agentKey: string, tenantId: string): Promise<boolean>;
  call(req: AgentCallRequest): Promise<AgentCallResult>;
};

const usable = (s: AgentSpec | null): s is AgentSpec =>
  !!s?.enabled && DIRECT_RUNTIMES.has(s.runtime) && s.systemPrompt.trim() !== "";

export function createAgentCaller(ai: AiClient, specOf: AgentSpecOf): AgentCaller {
  const spec = async (key: string, tenantId?: string): Promise<AgentSpec | null> => {
    try {
      return await specOf(key, tenantId);
    } catch {
      return null;
    }
  };
  return {
    ready: async (key) => ai.ready && usable(await spec(key)),
    enabledFor: async (key, tenantId) => (await spec(key, tenantId))?.entitled !== false,
    async call(req) {
      const s = await spec(req.agentKey, req.tenantId);
      if (s?.entitled === false) return { ok: false, code: "DISABLED" };
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
