// Các khe (việc) của công ty rút từ năng lực app — dùng bởi Công ty › Quy trình (tenants/flows). Logic thuần.
import type { TenantCapabilitiesResponse } from "@ai/contracts/capabilities";

export type SlotRef = { slot: string; app: string };

/** Gom khe của mọi app kèm app chủ, bỏ trùng, sắp theo tên khe. */
export function slotsOfCaps(c: Pick<TenantCapabilitiesResponse, "apps">): SlotRef[] {
  const m = new Map<string, string>();
  for (const a of c.apps) for (const s of a.slots) if (!m.has(s.slot)) m.set(s.slot, a.key);
  return [...m].map(([slot, app]) => ({ slot, app })).sort((a, b) => a.slot.localeCompare(b.slot));
}
