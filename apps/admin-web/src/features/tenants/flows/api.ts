// CR-121 c11 · client Hub cho Công ty › Quy trình: đọc chỉ-xem quy trình thư viện, Sao chép cho công ty (tự gán thay bản cũ, Q9),
// lượt đang chạy lọc theo việc, thân quy trình (chip bước / sơ đồ) trong tập đã gán. Vai: platform_admin + tenant_admin công ty mình.
import type {
  ProcessLibraryView,
  ProcessRoutingDefView,
  ProcessRunListResponse,
} from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { rowsFromSlotBody } from "@/features/apps/lib/flow-view";
import { isRunEnded } from "@/features/processes/lib/run-detail-view";
import { api } from "@/lib/http";
import { hubConfigured, hubUrl } from "@/lib/hub";

const enc = encodeURIComponent;
const url = (path: string): string => {
  const u = hubUrl(path);
  if (u === null) throw new Error("PUBLIC_HUB_URL chưa cấu hình: không gọi Hub");
  return u;
};

export const FKEYS = {
  def: (tid: string, slot: string, defId: string) =>
    ["process", "routing", tid, slot, "def", defId] as const,
  lib: (tid: string, defId: string) => ["process", "company-lib", tid, defId] as const,
  runs: (tid: string, slot: string) => ["process", "company-runs", tid, slot] as const,
};

/** Thân quy trình trong tập đã gán của việc (cùng khóa cache với sơ đồ ở trang Quy trình cũ). */
export const defStepsQuery = (tid: string, slot: string, defId: string) => ({
  queryKey: FKEYS.def(tid, slot, defId),
  retry: false,
  staleTime: 30_000,
  queryFn: async () => {
    const v = await api<ProcessRoutingDefView>(
      url(`/tenants/${enc(tid)}/process-routing/${enc(slot)}/processes/${enc(defId)}`),
    );
    return { version: v.rel_version, steps: rowsFromSlotBody(v.slot_body) };
  },
});

/** `GET /tenants/:tid/process-library/:id` — chỉ quy trình thư viện; không phải quy trình thư viện ⇒ 404. */
export const useLibraryView = (tid: string, defId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: FKEYS.lib(tid, defId ?? ""),
    enabled: enabled && !!defId && hubConfigured(),
    retry: false,
    queryFn: () =>
      api<ProcessLibraryView>(url(`/tenants/${enc(tid)}/process-library/${enc(defId ?? "")}`)),
  });

/** Lượt chưa kết thúc của MỘT việc (một lần gọi theo việc, chỉ khi mở ngăn — không gọi từng hàng). */
export const useSlotRuns = (tid: string, slot: string, isPlatform: boolean, enabled: boolean) =>
  useQuery({
    queryKey: FKEYS.runs(tid, slot),
    enabled: enabled && hubConfigured(),
    retry: false,
    queryFn: async () => {
      const r = await api<ProcessRunListResponse>(url("/process-runs"), {
        query: { scope: "tenant", slot, tenant_id: isPlatform ? tid : undefined, limit: 20 },
      });
      return r.items.filter((x) => !isRunEnded(x.status));
    },
  });
