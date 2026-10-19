// M3-decouple · dựng AI client chung từ env (một chỗ đọc khoá): `ANTHROPIC_API_KEY` (vắng ⇒ client trả `UNAVAILABLE`, không gọi),
// `ANTHROPIC_BASE_URL` (tuỳ chọn), `AI_TENANT_DAILY_TOKENS` (trần token/tenant/ngày UTC, mặc định 5.000.000; `0` ⇒ không trần).
// Test tiêm `provider` giả qua seam (không AI thật).
import type { Db } from "../db";
import { logger } from "../logger";
import { type AiClient, createAiClient, type ModelProvider } from "./ai-client";
import { anthropicProvider } from "./anthropic.provider";
import { pgUsageStore } from "./usage.pg";

export const AI_TENANT_DAILY_TOKENS = 5_000_000;

export function envDailyTokens(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env.AI_TENANT_DAILY_TOKENS;
  if (raw === undefined || raw === "") return AI_TENANT_DAILY_TOKENS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return AI_TENANT_DAILY_TOKENS;
  return n === 0 ? null : n;
}

export function envProvider(
  env: Record<string, string | undefined> = process.env,
): ModelProvider | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const baseURL = env.ANTHROPIC_BASE_URL;
  return anthropicProvider({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

export function createHubAiClient(db: Db, o: { provider?: ModelProvider | null } = {}): AiClient {
  const cap = envDailyTokens();
  return createAiClient({
    provider: o.provider === undefined ? envProvider() : o.provider,
    usage: pgUsageStore(db),
    caps: { dailyTokens: async () => cap },
    log: logger,
  });
}
