// M3-decouple · `ModelProvider` Anthropic (SDK chính thức `@anthropic-ai/sdk`): MỘT lượt Messages API, không tool, có dự phòng
// từ chối phía server (`fallbacks: "default"`), stream rồi `finalMessage()` để `max_tokens` lớn không chạm hạn HTTP. Khoá API do
// người gọi truyền (env/secret) — không đọc env ở đây. `stop_reason = refusal` ⇒ `REFUSED`; lỗi xác thực/quyền ⇒ `UNAVAILABLE`.
// Lỗi/huỷ giữa stream ⇒ trả usage một phần đã nhận (M3c, review B #14).
import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage, ModelProvider, ModelReply } from "./ai-client";

type RawUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};
const usageOf = (u: RawUsage): AiUsage => ({
  inputTokens: u.input_tokens,
  outputTokens: u.output_tokens,
  cacheReadTokens: u.cache_read_input_tokens ?? 0,
  cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
});

export function anthropicProvider(o: { apiKey: string; baseURL?: string }): ModelProvider {
  const client = new Anthropic({
    apiKey: o.apiKey,
    maxRetries: 2,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
  });
  return {
    key: "anthropic",
    async complete(r): Promise<ModelReply> {
      if (r.webSearch) return { ok: false, code: "UNAVAILABLE" }; // V2-I: tìm web chỉ chạy trên gói (Q8: ai-sub)
      let stream: ReturnType<typeof client.beta.messages.stream> | undefined;
      try {
        stream = client.beta.messages.stream(
          {
            model: r.model,
            max_tokens: r.maxTokens,
            system: r.system,
            messages: [{ role: "user", content: r.prompt }],
            output_config: { effort: "medium" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            // V2-J2 · tìm web phía server (giá thị trường) — chỉ khi người gọi bật.
            ...(r.webSearch
              ? {
                  tools: [
                    {
                      type: "web_search_20250305" as const,
                      name: "web_search" as const,
                      max_uses: 5,
                    },
                  ],
                }
              : {}),
          },
          { signal: r.signal },
        );
        const msg = await stream.finalMessage();
        const usage = usageOf(msg.usage as RawUsage);
        if (msg.stop_reason === "refusal")
          return { ok: false, code: "REFUSED", model: msg.model, usage };
        const text = msg.content
          .flatMap((b: { type: string; text?: string }) =>
            b.type === "text" ? [b.text ?? ""] : [],
          )
          .join("");
        return { ok: true, text, model: msg.model, usage };
      } catch (e) {
        return failed(e, stream?.currentMessage ?? stream?.receivedMessages.at(-1));
      }
    },
  };
}

/** Lỗi/huỷ giữa stream: trả usage MỘT PHẦN đã nhận (`message_start` + `message_delta` cuối) để vẫn ghi và tính trần
 *  (review B #14). Lỗi xác thực/quyền ⇒ `UNAVAILABLE`. */
export function failed(
  e: unknown,
  partial: { model: string; usage: unknown } | undefined,
): ModelReply {
  const code =
    e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError
      ? "UNAVAILABLE"
      : "FAILED";
  if (!partial) return { ok: false, code };
  return { ok: false, code, model: partial.model, usage: usageOf(partial.usage as RawUsage) };
}
