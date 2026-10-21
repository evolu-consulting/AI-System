// gap-d1 #21 · cổng AI của "Tải báo giá lên": lời gọi QUA AI client chung (trần token/tenant/ngày + một dòng usage), tính năng
// `contracts.quote_read`, KHÔNG tìm web. Không bao giờ ném; mã lỗi riêng để route trả 503 / 429 / 502.
import type { AiClient } from "../../../../lib/ai-client/ai-client";
import type { QuoteAi } from "../application/quote-read.usecase";
import { QUOTE_FEATURE, QUOTE_SYSTEM } from "../domain/quote-read.rules";

const MAX_TOKENS = 4096;

export function quoteAi(client: AiClient, o: { model: string }): QuoteAi {
  return async (who, r) => {
    const out = await client.complete({
      tenantId: who.tenantId,
      userId: who.userId,
      feature: QUOTE_FEATURE,
      app: "contracts",
      subjectId: r.productId,
      model: o.model,
      system: QUOTE_SYSTEM,
      prompt: r.prompt,
      maxTokens: MAX_TOKENS,
      signal: r.signal,
    });
    if (out.ok) return { ok: true, text: out.text };
    return {
      ok: false,
      code:
        out.code === "CAP_EXCEEDED" ? "cap" : out.code === "UNAVAILABLE" ? "unavailable" : "failed",
    };
  };
}
