// Tra cấu hình tenant cho module gói từ `ConfigCache` (0 SQL khi nóng) + đọc env số nguyên — tách khỏi `packs.mount.ts`.
import { DEFAULT_TENANT_TZ } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";

type WithConfig = { config: ConfigCache };

/** BR-6 (HD9) · múi giờ tenant; vắng ⇒ mặc định. */
export const tenantTz = (d: WithConfig) => async (tid: string) =>
  (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ;

/** tenant-quotas · hạn mức ngày riêng của tenant (nạp lại theo `config_version`); vắng ⇒ env. */
export const tenantLimits = (d: WithConfig) => async (tid: string) =>
  (await d.config.tenant(tid))?.dailyLimits;

/** Env số nguyên dương, sai/vắng ⇒ mặc định. */
export const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};
