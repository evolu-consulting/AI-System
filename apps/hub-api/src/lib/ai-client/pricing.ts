// M3-decouple · giá model (USD / 1 triệu token, bảng Anthropic first-party 2026-10). Model lạ ⇒ null ("Chưa định giá", như
// readiness #32 của `usage_logs.cost_usd`). Ghi đè giá ⇒ sửa bảng này (một nguồn).
/** Cấu trúc khớp `AiUsage` (khai lại để không vòng import với `ai-client.ts`). */
type AiUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costUsd(model: string, u: AiUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const micro =
    u.inputTokens * p.input +
    u.outputTokens * p.output +
    u.cacheReadTokens * p.cacheRead +
    u.cacheWriteTokens * p.cacheWrite;
  return Math.round(micro) / 1_000_000;
}
