// HUB-FR-66 · spec H4b2 §3 A · Q6 · plan §3.1 · hàng DB → `ProviderDetail` + ảnh audit (hàm thuần, test cạnh file).
// Dựng từ danh sách trường cho phép (không spread hàng DB) ⇒ không lọt cột lạ; `secret` chỉ `{id, name}`, không giá trị.
import type { ProviderDetail, Ref } from "@ai/contracts/studio";
import { isReadonlyProvider, type ProviderEditable } from "./models.rules";
import { redactKey } from "./provider-check.rules";
import type { ProviderDbRow, ProviderDetailRow } from "./providers.repo";

const LAST_ERROR_MAX = 500;
const iso = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);

/** `last_error` của Runtime: che chuỗi giống key (`redactKey(…, "")`), cắt 500 (Q6). */
const safeLastError = (s: string | null): string | null =>
  s === null ? null : redactKey(s, "").slice(0, LAST_ERROR_MAX);

function stateOf(r: ProviderDetailRow): ProviderDetail["state"] {
  const s = r.state;
  if (!s) return null;
  return {
    status: s.status as NonNullable<ProviderDetail["state"]>["status"],
    cooldown_until: iso(s.cooldownUntil),
    last_probe_at: iso(s.lastProbeAt),
    last_ok_at: iso(s.lastOkAt),
    utilization: s.utilization,
    last_error: safeLastError(s.lastError),
  };
}

export function toProviderDetail(r: ProviderDetailRow, usedBy: readonly Ref[]): ProviderDetail {
  const st = stateOf(r);
  return {
    id: r.id,
    key: r.key,
    kind: r.kind,
    vendor: r.vendor,
    base_url: r.baseUrl,
    has_secret: r.secretId !== null,
    max_concurrency: r.maxConcurrency,
    enabled: r.enabled,
    dev_only: r.devOnly,
    state: st,
    version: r.version,
    slots_in_use: r.slotsInUse,
    secret: r.secretId === null ? null : { id: r.secretId, name: r.secretName ?? "" },
    readonly: isReadonlyProvider(r.vendor),
    updated_at: new Date(r.updatedAt).toISOString(),
    used_by_profiles: [...usedBy],
  };
}

/** Trường sửa được (audit before/after, `providerChanged`) — `secret_id` là id, không giá trị. */
export function editableOf(
  r: Pick<ProviderDbRow, "baseUrl" | "secretId" | "maxConcurrency" | "enabled">,
): ProviderEditable {
  return {
    base_url: r.baseUrl,
    secret_id: r.secretId,
    max_concurrency: r.maxConcurrency,
    enabled: r.enabled,
  };
}
