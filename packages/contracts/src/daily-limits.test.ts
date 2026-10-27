// tenant-quotas · luật thuần: chọn giá trị riêng/env, tên khoá đếm theo ngày múi tenant, mốc đếm token AI sau đặt lại.
import { describe, expect, it } from "bun:test";
import {
  aiTokensSince,
  DailyLimitsPutSchema,
  dailyCounterKey,
  effectiveDailyLimit,
  envDailyLimit,
  tenantLocalDay,
} from "./daily-limits";

const T = "01900000-0000-7000-8000-000000000001";

describe("tenant-quotas · daily-limits rules", () => {
  it("giá trị riêng thắng env; null ⇒ env (env null = không trần)", () => {
    expect(effectiveDailyLimit(50, 30)).toBe(50);
    expect(effectiveDailyLimit(null, 30)).toBe(30);
    expect(effectiveDailyLimit(undefined, null)).toBeNull();
  });

  it("env như hub-api: sai/vắng ⇒ mặc định; token AI 0 ⇒ không trần", () => {
    expect(envDailyLimit("uploads", {})).toBe(30);
    expect(envDailyLimit("actions", { CONTRACTS_ACTIONS_TENANT_DAY: "0" })).toBe(100);
    expect(envDailyLimit("uploads", { CONTRACTS_UPLOADS_TENANT_DAY: "7" })).toBe(7);
    expect(envDailyLimit("ai_tokens", { AI_TENANT_DAILY_TOKENS: "0" })).toBeNull();
    expect(envDailyLimit("ai_tokens", { AI_TENANT_DAILY_TOKENS: "x" })).toBe(5_000_000);
  });

  it("khoá đếm theo ngày múi tenant, khớp tiền tố hub-api", () => {
    // 2026-10-27 18:30 UTC = 2026-10-28 01:30 giờ VN
    const day = tenantLocalDay(new Date("2026-10-27T18:30:00Z"), "Asia/Ho_Chi_Minh");
    expect(day).toBe("2026-10-28");
    expect(dailyCounterKey("uploads", T, day)).toBe(`q:contracts:t:${T}:2026-10-28`);
    expect(dailyCounterKey("actions", T, day)).toBe(`q:contracts:a:${T}:2026-10-28`);
  });

  it("mốc đếm token AI: đặt lại hôm nay thắng 00:00 UTC; đặt lại hôm qua bỏ qua", () => {
    const now = new Date("2026-10-27T10:00:00Z");
    expect(aiTokensSince(now, null).toISOString()).toBe("2026-10-27T00:00:00.000Z");
    const r = new Date("2026-10-27T08:00:00Z");
    expect(aiTokensSince(now, r)).toEqual(r);
    expect(aiTokensSince(now, new Date("2026-10-26T23:00:00Z")).toISOString()).toBe(
      "2026-10-27T00:00:00.000Z",
    );
  });

  it("PUT: số nguyên dương hoặc null, không khoá lạ", () => {
    expect(
      DailyLimitsPutSchema.safeParse({ uploads: 5, actions: null, ai_tokens: null }).success,
    ).toBe(true);
    expect(
      DailyLimitsPutSchema.safeParse({ uploads: 0, actions: null, ai_tokens: null }).success,
    ).toBe(false);
    expect(
      DailyLimitsPutSchema.safeParse({ uploads: 1, actions: 1, ai_tokens: 1, x: 1 }).success,
    ).toBe(false);
  });
});
