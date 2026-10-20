// M3-decouple · AI client CHUNG của Hub: mọi lời gọi model trực tiếp (trích HĐ của gói contracts nay, trợ lý chat sau) đi qua
// một cửa — (1) trần token theo tenant/ngày (UTC): GIỮ CHỖ nguyên tử trước khi gọi (M3c, review B #13 — N lời gọi đồng thời không
// vượt trần; `maxTokens` = phần được cấp; lỗi giữ chỗ ⇒ không gọi, đóng an toàn), (2) gọi nhà cung cấp, (3) ghi MỘT dòng usage
// (tenant, người, tính năng, model, token, chi phí) vào `hub.usage_logs` cho MỌI lời gọi đã tới nhà cung cấp — kể cả lỗi/huỷ
// giữa chừng (usage một phần, review B #14) — rồi trả chỗ giữ (quyết toán). Khoá API chỉ từ env/secret (provider dựng ở
// `ai-client.env.ts`). Không log nội dung lời nhắc/đầu ra. Không bao giờ ném.
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
export type TokenHoldRequest = {
  tenantId: string;
  since: Date;
  cap: number;
  /** Token input ước tính (giữ chỗ cùng phần output). */
  inputTokens: number;
  maxOutput: number;
  /** Phần output nhỏ nhất đáng gọi; còn ít hơn ⇒ không cấp. */
  minOutput: number;
  /** Hạn chỗ giữ (tiến trình chết giữa chừng ⇒ tự hết). */
  ttlS: number;
};
export type TokenHold = { holdId: string; maxOutput: number };
/** Bảng usage chung (`hub.usage_logs`): ghi một dòng + tổng token của tenant từ mốc; giữ chỗ nguyên tử (tuỳ chọn). */
export type UsageStore = {
  record(r: UsageRecord): Promise<void>;
  tokensSince(tenantId: string, since: Date): Promise<number>;
  /** Giữ chỗ nguyên tử (khoá theo tenant): null ⇒ hết trần. Vắng ⇒ kiểm-rồi-gọi (chỉ cho test/fake). */
  reserve?(r: TokenHoldRequest): Promise<TokenHold | null>;
  release?(holdId: string): Promise<void>;
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
export type AiClient = {
  /** false ⇒ chưa cấu hình nhà cung cấp (khoá) — mọi lời gọi `UNAVAILABLE`. */
  readonly ready: boolean;
  complete(req: AiCallRequest): Promise<AiCallResult>;
};

type Log = { warn(msg: string, f?: Record<string, unknown>): void };
export type AiClientDeps = {
  /** null ⇒ chưa cấu hình khoá ⇒ mọi lời gọi `UNAVAILABLE` (0 SQL). */
  provider: ModelProvider | null;
  usage: UsageStore;
  caps: AiCaps;
  now?: () => Date;
  log?: Log;
};

const DEFAULT_MAX_TOKENS = 32_000;
/** Phần output nhỏ nhất đáng gọi (còn ít hơn ⇒ CAP_EXCEEDED thay vì lời gọi bị cắt cụt). */
const MIN_OUTPUT_TOKENS = 1_024;
/** Hạn chỗ giữ: dài hơn mọi lượt AI (trần `CONTRACTS_EXTRACT_TIMEOUT_S` 3600 s). */
const HOLD_TTL_S = 2 * 3600;
const ZERO: AiUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** 00:00 UTC của ngày `d`. */
export const utcDayStart = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Token input ước tính, nghiêng về dư (≈ 2 ký tự/token — tiếng Việt tốn token hơn tiếng Anh). */
export const estimateInputTokens = (req: Pick<AiCallRequest, "system" | "prompt">): number =>
  Math.ceil((req.system.length + req.prompt.length) / 2);

type Admission =
  | { kind: "ok"; maxTokens: number; holdId: string | null }
  | { kind: "cap" }
  | { kind: "unavailable" };

/** Cửa trần: giữ chỗ nguyên tử khi store hỗ trợ; ngược lại kiểm-rồi-gọi. Lỗi bất kỳ ⇒ `unavailable` (không gọi). */
async function admit(d: AiClientDeps, req: AiCallRequest, at: Date): Promise<Admission> {
  const want = req.maxTokens ?? DEFAULT_MAX_TOKENS;
  try {
    const cap = await d.caps.dailyTokens(req.tenantId);
    if (cap === null) return { kind: "ok", maxTokens: want, holdId: null };
    const since = utcDayStart(at);
    if (!d.usage.reserve)
      return (await d.usage.tokensSince(req.tenantId, since)) < cap
        ? { kind: "ok", maxTokens: want, holdId: null }
        : { kind: "cap" };
    const hold = await d.usage.reserve({
      tenantId: req.tenantId,
      since,
      cap,
      inputTokens: estimateInputTokens(req),
      maxOutput: want,
      minOutput: Math.min(want, MIN_OUTPUT_TOKENS),
      ttlS: HOLD_TTL_S,
    });
    return hold ? { kind: "ok", maxTokens: hold.maxOutput, holdId: hold.holdId } : { kind: "cap" };
  } catch {
    return { kind: "unavailable" };
  }
}

async function callProvider(p: ModelProvider, req: AiCallRequest, maxTokens: number) {
  try {
    return await p.complete({
      model: req.model,
      system: req.system,
      prompt: req.prompt,
      maxTokens,
      signal: req.signal,
    });
  } catch {
    return { ok: false, code: "FAILED" } as ModelReply;
  }
}

/** Quyết toán: ghi usage thật (kể cả lỗi — usage một phần hoặc 0) rồi trả chỗ giữ. Lỗi ⇒ log (chỗ giữ tự hết hạn). */
async function settle(d: AiClientDeps, r: UsageRecord, holdId: string | null): Promise<void> {
  const f = { tenant_id: r.tenantId, feature: r.feature };
  await d.usage.record(r).catch(() => d.log?.warn("ai-usage-record-failed", f));
  if (holdId && d.usage.release)
    await d.usage.release(holdId).catch(() => d.log?.warn("ai-token-release-failed", f));
}

export function createAiClient(d: AiClientDeps): AiClient {
  const now = d.now ?? (() => new Date());
  return {
    ready: d.provider !== null,
    async complete(req) {
      const provider = d.provider;
      if (!provider) return { ok: false, code: "UNAVAILABLE" };
      const gate = await admit(d, req, now());
      if (gate.kind === "unavailable") return { ok: false, code: "UNAVAILABLE" };
      if (gate.kind === "cap") return { ok: false, code: "CAP_EXCEEDED" };
      const t0 = performance.now();
      const reply = await callProvider(provider, req, gate.maxTokens);
      const usage = reply.usage ?? ZERO;
      const model = reply.model ?? req.model;
      await settle(
        d,
        {
          tenantId: req.tenantId,
          userId: req.userId,
          feature: req.feature,
          providerKey: provider.key,
          model,
          usage,
          costUsd: costUsd(model, usage),
          latencyMs: Math.round(performance.now() - t0),
        },
        gate.holdId,
      );
      if (!reply.ok) return { ok: false, code: reply.code };
      return { ok: true, text: reply.text, model, usage };
    },
  };
}
