// M3-decouple + ai-sub · dựng AI client chung từ env (một chỗ đọc cấu hình). Mỗi tính năng (`knowledge.rerank`,
// `knowledge.graph`, `contracts.extract`, …) chọn nhà cung cấp:
//   `AI_PROVIDER` = `subscription` (MẶC ĐỊNH — gói Claude qua Claude Code CLI đã đăng nhập) | `api` (`ANTHROPIC_API_KEY`) | `off`;
//   ghi đè từng tính năng: `AI_PROVIDER_<FEATURE>` (FEATURE viết hoa, `.`/`-` → `_`, vd `AI_PROVIDER_CONTRACTS_EXTRACT=api`).
// Gói: `AI_SUB_CLI_PATH` (mặc định `claude` trên PATH), `AI_SUB_CLAUDE_CONFIG_DIR` (tuỳ chọn), `AI_SUB_MAX_CONCURRENCY` (mặc
// định 2). CLI không tìm thấy ⇒ tính năng đó `UNAVAILABLE`. `APP_ENV=test`/`NODE_ENV=test` không đặt `AI_PROVIDER` ⇒ `off` trừ khi
// đặt rõ `AI_SUB_CLI_PATH` (test không bao giờ gọi AI thật). API: `ANTHROPIC_API_KEY` (vắng ⇒ `UNAVAILABLE`),
// `ANTHROPIC_BASE_URL` (tuỳ chọn). Trần: `AI_TENANT_DAILY_TOKENS` (token/tenant/ngày UTC, mặc định 5.000.000; `0` ⇒ không
// trần) — áp cho CẢ gói lẫn API. Test tiêm `provider` giả qua seam.
import { aiTokensSince, effectiveDailyLimit } from "@ai/contracts";
import type { Db } from "../db";
import { logger } from "../logger";
import { type AiCaps, type AiClient, createAiClient, type ModelProvider } from "./ai-client";
import { anthropicProvider } from "./anthropic.provider";
import { type CliRun, claudeCliProvider } from "./claude-cli.provider";
import { pgUsageStore } from "./usage.pg";

export const AI_TENANT_DAILY_TOKENS = 5_000_000;
/** Các tính năng gọi AI client (khoá `feature` của usage). Trợ lý chat chạy qua runtime agent (profile Studio), không ở đây. */
export const AI_FEATURES = [
  "knowledge.rerank",
  "knowledge.graph",
  "contracts.extract",
  "contracts.summary",
  "contracts.partner-search",
  "contracts.price_search",
  "contracts.price_scout",
] as const;

type Env = Record<string, string | undefined>;
export type AiMode = "subscription" | "api" | "off";

export function envDailyTokens(env: Env = process.env): number | null {
  const raw = env.AI_TENANT_DAILY_TOKENS;
  if (raw === undefined || raw === "") return AI_TENANT_DAILY_TOKENS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return AI_TENANT_DAILY_TOKENS;
  return n === 0 ? null : n;
}

const modeOf = (raw: string | undefined): AiMode | null => {
  const v = raw?.trim().toLowerCase();
  return v === "subscription" || v === "api" || v === "off" ? v : null;
};
export const featureEnvKey = (feature: string): string =>
  `AI_PROVIDER_${feature.toUpperCase().replace(/[.-]/g, "_")}`;

/** Chế độ của một tính năng: ghi đè riêng → `AI_PROVIDER` → mặc định `subscription` (`off` khi `APP_ENV=test`). */
export function featureMode(feature: string, env: Env = process.env): AiMode {
  const own = modeOf(env[featureEnvKey(feature)]);
  if (own) return own;
  const all = modeOf(env.AI_PROVIDER);
  if (all) return all;
  const testing = env.APP_ENV === "test" || env.NODE_ENV === "test"; // `bun test` đặt NODE_ENV=test
  return testing && !env.AI_SUB_CLI_PATH ? "off" : "subscription";
}

/** Nhà cung cấp API Anthropic (khoá env); vắng khoá ⇒ null. */
export function envProvider(env: Env = process.env): ModelProvider | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const baseURL = env.ANTHROPIC_BASE_URL;
  return anthropicProvider({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

export type SubOptions = {
  run?: CliRun;
  /** Tìm CLI trên PATH (mặc định `Bun.which`); test tiêm. */
  which?: (cmd: string) => string | null;
};

/** Nhà cung cấp gói (Claude Code CLI); không tìm thấy CLI ⇒ null. */
export function envSubscriptionProvider(
  env: Env = process.env,
  o: SubOptions = {},
): ModelProvider | null {
  const which = o.which ?? ((c: string) => Bun.which(c));
  const raw = env.AI_SUB_CLI_PATH?.trim() || "claude";
  const cliPath = which(raw);
  if (!cliPath) return null;
  const conc = Number(env.AI_SUB_MAX_CONCURRENCY);
  const configDir = env.AI_SUB_CLAUDE_CONFIG_DIR?.trim();
  return claudeCliProvider({
    cliPath,
    env,
    ...(configDir ? { configDir } : {}),
    ...(Number.isInteger(conc) && conc > 0 ? { maxConcurrency: conc } : {}),
    ...(o.run ? { run: o.run } : {}),
  });
}

/** Bộ chọn theo tính năng: dựng mỗi loại nhà cung cấp MỘT lần (dùng chung hàng đợi gói), chế độ đọc lúc dựng. */
export function envProviderRouter(
  env: Env = process.env,
  o: SubOptions = {},
): { pick: (feature: string) => ModelProvider | null; anyReady: boolean } {
  let sub: ModelProvider | null | undefined;
  let api: ModelProvider | null | undefined;
  const byMode = (m: AiMode): ModelProvider | null => {
    if (m === "subscription") {
      if (sub === undefined) sub = envSubscriptionProvider(env, o);
      return sub;
    }
    if (m === "api") {
      if (api === undefined) api = envProvider(env);
      return api;
    }
    return null;
  };
  const table = new Map<string, ModelProvider | null>();
  const pick = (feature: string): ModelProvider | null => {
    if (!table.has(feature)) table.set(feature, byMode(featureMode(feature, env)));
    return table.get(feature) ?? null;
  };
  const anyReady = AI_FEATURES.some((f) => pick(f) !== null);
  return { pick, anyReady };
}

/** tenant-quotas · hạn mức ngày riêng của tenant từ cache cấu hình (vắng ⇒ env). */
export type TenantLimitsOf = (
  tenantId: string,
) => Promise<{ aiTokens: number | null; aiTokensResetAt: Date | null } | undefined>;

/** Trần token/ngày: riêng của tenant (Admin) thắng env; mốc đếm = max(00:00 UTC, lúc "Đặt lại hôm nay"). */
export function hubAiCaps(cap: number | null, limitsOf?: TenantLimitsOf): AiCaps {
  if (!limitsOf) return { dailyTokens: async () => cap };
  return {
    dailyTokens: async (tid) => effectiveDailyLimit((await limitsOf(tid))?.aiTokens, cap),
    since: async (tid, at) => aiTokensSince(at, (await limitsOf(tid))?.aiTokensResetAt ?? null),
  };
}

export function createHubAiClient(
  db: Db,
  o: {
    provider?: ModelProvider | null;
    env?: Env;
    sub?: SubOptions;
    limitsOf?: TenantLimitsOf;
  } = {},
): AiClient {
  const env = o.env ?? process.env;
  const cap = envDailyTokens(env);
  const routed = o.provider === undefined ? envProviderRouter(env, o.sub) : null;
  return createAiClient({
    provider: routed ? routed.pick : (o.provider ?? null),
    ...(routed ? { anyReady: routed.anyReady } : {}),
    usage: pgUsageStore(db),
    caps: hubAiCaps(cap, o.limitsOf),
    log: logger,
  });
}
