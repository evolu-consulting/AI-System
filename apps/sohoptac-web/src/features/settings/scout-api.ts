// price-scout · API Cài đặt › Dò giá thị trường: mặc định theo nhóm SP (`/price-scout/defaults`) + trần lượt dò/tháng (`/price-scout/quota`).
import type {
  PriceScoutConfig,
  PriceScoutDefaultsOut,
  PriceScoutGroup,
  PriceScoutQuotaIn,
  PriceScoutQuotaOut,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const P = "/pack/contracts/price-scout";
export const scoutSettingsKeys = {
  defaults: ["settings", "scout", "defaults"] as const,
  quota: ["settings", "scout", "quota"] as const,
};

export const fetchScoutDefaults = (signal?: AbortSignal) =>
  api<PriceScoutDefaultsOut>(`${P}/defaults`, { signal });
export const saveScoutDefaults = (group: PriceScoutGroup, config: PriceScoutConfig) =>
  api<PriceScoutDefaultsOut>(`${P}/defaults`, { method: "PUT", body: { group, config } });
export const fetchScoutQuota = (signal?: AbortSignal) =>
  api<PriceScoutQuotaOut>(`${P}/quota`, { signal });
export const saveScoutQuota = (body: PriceScoutQuotaIn) =>
  api<PriceScoutQuotaOut>(`${P}/quota`, { method: "PUT", body });
