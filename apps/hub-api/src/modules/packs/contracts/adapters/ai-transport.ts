// HD-FR-21 · D2-01 · M3-decouple: `AgentTransport` của lượt trích = lời gọi model TRỰC TIẾP qua AI client chung (không engine,
// không tool, không MCP). Lời nhắc có rào + parse strict + kiểm trích dẫn giữ nguyên ở `extraction-agent.ts`/use case. Ghi usage
// + trần token theo tenant do AI client làm (`hub.usage_logs`, feature `contracts.extract`). PDF/ảnh không văn bản ⇒ chưa hỗ
// trợ (D3-04, `AGENT_UNAVAILABLE`).
import type { AiClient } from "../../../../lib/ai-client/ai-client";
import type { AgentTransport } from "./extraction-agent";

export const EXTRACT_FEATURE = "contracts.extract";
/** Model mặc định (env `CONTRACTS_EXTRACT_MODEL` ghi đè). */
export const EXTRACT_MODEL = "claude-opus-5-5";

export function aiTransport(client: AiClient, o: { model: string }): AgentTransport {
  return async (req) => {
    if (req.file) return { ok: false, code: "AGENT_UNAVAILABLE" };
    const out = await client.complete({
      tenantId: req.who.tenantId,
      userId: req.who.userId,
      feature: EXTRACT_FEATURE,
      model: o.model,
      system: req.system,
      prompt: req.prompt,
      signal: req.signal,
    });
    if (out.ok) return { ok: true, text: out.text };
    if (out.code === "CAP_EXCEEDED") return { ok: false, code: "AI_CAP_EXCEEDED" };
    if (out.code === "UNAVAILABLE") return { ok: false, code: "AGENT_UNAVAILABLE" };
    return { ok: false, code: "AGENT_FAILED" };
  };
}
