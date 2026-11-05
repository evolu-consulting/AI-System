// hub-routing-backfill · `/processes` tab "Của công ty" · mục chỉ đọc "Được platform gán": khe của tenant (từ capabilities) +
// quy trình đã gán mỗi khe (GET routing) kèm nhãn "Đang dùng". Logic thuần; sửa vẫn chỉ platform / luật ở Cài đặt.
import type { TenantCapabilitiesResponse } from "@ai/contracts";
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { routingCurrent } from "@ai/web-kit/routing-current";

/** Khe quy trình của mọi app tenant bật (trùng ⇒ một), theo tên. */
export const slotsOfCaps = (c: Pick<TenantCapabilitiesResponse, "apps">): string[] =>
  [...new Set(c.apps.flatMap((a) => a.slots.map((s) => s.slot)))].sort();

export type AssignedRow = { defId: string; name: string; version: number | null; inUse: boolean };
export type AssignedView = { rows: AssignedRow[]; outside: { defId: string; name: string } | null };

export function assignedView(r: ProcessRouting): AssignedView {
  const cur = routingCurrent(r);
  return {
    rows: r.processes.map((p) => ({
      defId: p.def_id,
      name: p.name,
      version: p.rel_version,
      inUse: cur.markId === p.def_id,
    })),
    outside: cur.outside,
  };
}
