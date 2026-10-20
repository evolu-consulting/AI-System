// V2-I · DT-07 · intake Q8: cổng AI của "Tìm trên internet" — lời gọi QUA AI client chung (gói `ai-sub`, CLI có đúng công cụ
// WebSearch), tính năng `contracts.partner-search` (trần token + dòng usage như mọi lời gọi). Chỉ tên + MST đi ra ngoài; đầu ra
// chỉ là chữ thuần (luật `partner-search.rules`). Không có AI / hết trần / lỗi ⇒ mã riêng để route trả 503 / 429 / 502.
import type { AiClient } from "../../../../lib/ai-client/ai-client";
import type { WebSearch } from "../application/partner-roles.usecase";
import { parseSearchLines, SEARCH_SYSTEM, searchPrompt } from "../domain/partner-search.rules";

export const PARTNER_SEARCH_FEATURE = "contracts.partner-search";
/** Model mặc định (env `CONTRACTS_PARTNER_SEARCH_MODEL` ghi đè). */
export const PARTNER_SEARCH_MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 4096;

export function partnerWebSearch(client: AiClient, o: { model: string }): WebSearch {
  return async (who, q, signal) => {
    const out = await client.complete({
      tenantId: who.tenantId,
      userId: who.userId,
      feature: PARTNER_SEARCH_FEATURE,
      model: o.model,
      system: SEARCH_SYSTEM,
      prompt: searchPrompt(q.name, q.taxId),
      maxTokens: MAX_TOKENS,
      webSearch: true,
      signal,
    });
    if (out.ok) return { ok: true, lines: parseSearchLines(out.text) };
    return {
      ok: false,
      code:
        out.code === "CAP_EXCEEDED" ? "cap" : out.code === "UNAVAILABLE" ? "unavailable" : "failed",
    };
  };
}
