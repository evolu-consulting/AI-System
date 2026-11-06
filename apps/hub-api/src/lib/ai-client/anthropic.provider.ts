// M3-decouple · `ModelProvider` Anthropic (SDK chính thức `@anthropic-ai/sdk`): MỘT lượt Messages API, không tool, có dự phòng
// từ chối phía server (`fallbacks: "default"`), stream rồi `finalMessage()` để `max_tokens` lớn không chạm hạn HTTP. Khoá API do
// người gọi truyền (env/secret) — không đọc env ở đây. `stop_reason = refusal` ⇒ `REFUSED`; lỗi xác thực/quyền ⇒ `UNAVAILABLE`.
// Lỗi/huỷ giữa stream ⇒ trả usage một phần đã nhận (M3c, review B #14).
import Anthropic from "@anthropic-ai/sdk";
import type { AiAttachment, AiUsage, ModelProvider, ModelReply } from "./ai-client";
import { type CachedPrompt, cachedPrompt } from "./prompt-cache";

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

type FinalMsg = {
  model: string;
  usage: unknown;
  stop_reason: string | null;
  content: ReadonlyArray<{ type: string; text?: string }>;
};
function replyOf(msg: FinalMsg): ModelReply {
  const usage = usageOf(msg.usage as RawUsage);
  if (msg.stop_reason === "refusal") return { ok: false, code: "REFUSED", model: msg.model, usage };
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text ?? ""] : [])).join("");
  return { ok: true, text, model: msg.model, usage };
}

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
type Block = Anthropic.Beta.BetaContentBlockParam;

/** CR-122 p9 · PDF ⇒ khối `document`, ảnh ⇒ khối `image` (base64, Messages API đọc bằng thị giác). Loại khác ⇒ null (không đọc được). */
export function attachmentBlocks(a: readonly AiAttachment[]): Block[] | null {
  const out: Block[] = [];
  for (const x of a) {
    const data = Buffer.from(x.bytes).toString("base64");
    if (x.mime === "application/pdf")
      out.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data },
      });
    else if (IMAGE_MIME.includes(x.mime))
      out.push({
        type: "image",
        source: { type: "base64", media_type: x.mime as "image/png", data },
      });
    else return null;
  }
  return out;
}

/** Tệp đứng TRƯỚC chữ trong tin cuối (khuyến nghị của Anthropic cho tài liệu dài). */
function withAttachments(
  messages: ReturnType<typeof cachedPrompt>["messages"],
  blocks: Block[],
): ReturnType<typeof cachedPrompt>["messages"] {
  const last = messages.at(-1);
  if (!last || typeof last.content === "string") return messages;
  return [...messages.slice(0, -1), { ...last, content: [...blocks, ...last.content] }];
}

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
      // CR-114 · system cố định có `cache_control` (prefix ổn định); prompt lượt này sau breakpoint.
      const p = cachedPrompt({ system: r.system, history: [], prompt: r.prompt });
      if (r.attachments?.length) {
        const blocks = attachmentBlocks(r.attachments);
        if (!blocks) return { ok: false, code: "UNAVAILABLE" };
        p.messages = withAttachments(p.messages, blocks);
      }
      try {
        stream = client.beta.messages.stream(
          {
            model: r.model,
            max_tokens: r.maxTokens,
            system: p.system,
            messages: p.messages,
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
        return replyOf(await stream.finalMessage());
      } catch (e) {
        return failed(e, stream?.currentMessage ?? stream?.receivedMessages.at(-1));
      }
    },
  };
}

export type TurnUsage = AiUsage;
export type TurnReply =
  | { ok: true; text: string; model: string; usage: TurnUsage }
  | { ok: false; code: "REFUSED" | "FAILED" | "UNAVAILABLE"; model?: string; usage?: TurnUsage };
export type TurnRequest = {
  model: string;
  prompt: CachedPrompt;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  signal: AbortSignal;
  /** Mẩu chữ tới (stream) — gọi ngay khi nhận `text_delta`. */
  onText?: (delta: string) => void;
};
/** CR-114 · một lượt chat SDK có cache (đường SDK trực tiếp của agent). Không ném. */
export type TurnStreamer = (r: TurnRequest) => Promise<TurnReply>;

export function anthropicTurnStreamer(o: { apiKey: string; baseURL?: string }): TurnStreamer {
  const client = new Anthropic({
    apiKey: o.apiKey,
    maxRetries: 2,
    ...(o.baseURL ? { baseURL: o.baseURL } : {}),
  });
  return async (r) => {
    let stream: ReturnType<typeof client.beta.messages.stream> | undefined;
    try {
      stream = client.beta.messages.stream(
        {
          model: r.model,
          max_tokens: r.maxTokens,
          system: r.prompt.system,
          ...(r.prompt.tools ? { tools: r.prompt.tools } : {}),
          messages: r.prompt.messages,
          output_config: { effort: r.effort },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: r.signal },
      );
      if (r.onText) stream.on("text", (d: string) => r.onText?.(d));
      return replyOf(await stream.finalMessage());
    } catch (e) {
      return failed(e, stream?.currentMessage ?? stream?.receivedMessages.at(-1));
    }
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
