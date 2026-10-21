// price-scout · làm sạch cấu hình dò giá đọc từ DB (jsonb): mỗi khoá kiểm riêng theo schema contract — khoá sai/lạ (dữ liệu cũ
// hoặc hỏng) bị bỏ ⇒ theo mặc định nhóm. Lớp 3.
import { PRICE_SCOUT_DEFAULT, type PriceScoutConfig, PriceScoutConfigSchema } from "@ai/contracts";
import type { PriceScoutOverride } from "../domain/price-scout.types";

const FIELDS = Object.keys(PRICE_SCOUT_DEFAULT) as (keyof PriceScoutConfig)[];

export function cleanOverride(raw: unknown): PriceScoutOverride {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const shape = PriceScoutConfigSchema.shape;
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    const p = shape[k].safeParse(v);
    if (p.success) out[k] = p.data;
  }
  return out as PriceScoutOverride;
}
