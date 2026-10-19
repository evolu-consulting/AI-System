// M3-decouple · AI client CHUNG của Hub: mọi lời gọi model trực tiếp (trích HĐ của gói contracts nay, trợ lý chat sau) đi qua
// một cửa — (1) trần token theo tenant/ngày (UTC) đọc từ bảng usage TRƯỚC khi gọi (lỗi đọc ⇒ không gọi, đóng an toàn),
// (2) gọi nhà cung cấp, (3) ghi MỘT dòng usage (tenant, người, tính năng, model, token, chi phí) vào `hub.usage_logs`.
// Khoá API chỉ từ env/secret (provider dựng ở `ai-client.env.ts`). Không log nội dung lời nhắc/đầu ra. Không bao giờ ném.
import { costUsd } from "./pricing";

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
export type ModelRequest = {
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
};
export type ModelReply =
  | { ok: true; text: string; model: string; usage: AiUsage }
  | { ok: false; code: "REFUSED" | "FAILED" | "UNAVAILABLE"; model?: string; usage?: AiUsage };
/** Nhà cung cấp model (Anthropic thật / giả trong test). */
export type ModelProvider = { key: string; complete(r: ModelRequest): Promise<ModelReply> };

export type UsageRecord = {
  tenantId: string;
  userId: string | null;
  feature: string;
  providerKey: string;
  model: string;
  usage: AiUsage;
  costUsd: number | null;
  latencyMs: number;
};
/** Bảng usage chung (`hub.usage_logs`): ghi một dòng + tổng token của tenant từ mốc. */
export type UsageStore = {
  record(r: UsageRecord): Promise<void>;
  tokensSince(tenantId: string, since: Date): Promise<number>;
};
/** Trần token/ngày của tenant; null ⇒ không giới hạn. */
export type AiCaps = { dailyTokens(tenantId: string): Promise<number | null> };

export type AiCallRequest = {
  tenantId: string;
  userId: string | null;
  /** Khoá tính năng `goi.viec` (CHECK ở DB). */
  feature: string;
  system: string;
  prompt: string;
  model: string;
  maxTokens?: number;
  signal: AbortSignal;
};
export type AiFailCode = "CAP_EXCEEDED" | "UNAVAILABLE" | "FAILED" | "REFUSED";
export type AiCallResult =
  | { ok: true; text: string; model: string; usage: AiUsage }
  | { ok: false; code: AiFailCode };
export type AiClient = { complete(req: AiCallRequest): Promise<AiCallResult> };

export type AiClientDeps = {
  /** null ⇒ chưa cấu hình khoá ⇒ mọi lời gọi `UNAVAILABLE` (0 SQL). */
  provider: ModelProvider | null;
  usage: UsageStore;
  caps: AiCaps;
  now?: () => Date;
  log?: { warn(msg: string, f?: Record<string, unknown>): void };
};

const DEFAULT_MAX_TOKENS = 32_000;
const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** 00:00 UTC của ngày `d`. */
export const utcDayStart = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

async function underCap(d: AiClientDeps, tenantId: string, at: Date): Promise<boolean | null> {
  try {
    const cap = await d.caps.dailyTokens(tenantId);
    if (cap === null) return true;
    return (await d.usage.tokensSince(tenantId, utcDayStart(at))) < cap;
  } catch {
    return null;
  }
}

export function createAiClient(d: AiClientDeps): AiClient {
  const now = d.now ?? (() => new Date());
  return {
    async complete(req) {
      const provider = d.provider;
      if (!provider) return { ok: false, code: "UNAVAILABLE" };
      const cap = await underCap(d, req.tenantId, now());
      if (cap === null) return { ok: false, code: "UNAVAILABLE" };
      if (!cap) return { ok: false, code: "CAP_EXCEEDED" };
      const t0 = performance.now();
      let reply: ModelReply;
      try {
        reply = await provider.complete({
          model: req.model,
          system: req.system,
          prompt: req.prompt,
          maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
          signal: req.signal,
        });
      } catch {
        reply = { ok: false, code: "FAILED" };
      }
      const usage = reply.usage ?? ZERO;
      const model = reply.model ?? req.model;
      if (reply.usage) {
        const rec: UsageRecord = {
          tenantId: req.tenantId,
          userId: req.userId,
          feature: req.feature,
          providerKey: provider.key,
          model,
          usage,
          costUsd: costUsd(model, usage),
          latencyMs: Math.round(performance.now() - t0),
        };
        await d.usage.record(rec).catch(() =>
          d.log?.warn("ai-usage-record-failed", {
            tenant_id: req.tenantId,
            feature: req.feature,
          }),
        );
      }
      if (!reply.ok) return { ok: false, code: reply.code };
      return { ok: true, text: reply.text, model, usage };
    },
  };
}
