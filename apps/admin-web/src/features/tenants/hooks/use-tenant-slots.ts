// CR-105 · L3: khối "Quy trình duyệt hợp đồng" ở trang tenant — danh sách khe (đang dùng gì) + gán / về mặc định.
// Chỉ platform_admin (Hub 403/404 ⇒ khối ẩn). Chuỗi dùng `tenants.slots.*` (trang tenant không nạp chuỗi `process.*`).
import { useState } from "react";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { errorLines } from "@/features/processes/lib/library-view";
import {
  assignTenant,
  unassignTenant,
  useLibraryDefs,
  useLibraryRefresh,
  useTenantSlots,
} from "@/features/processes/library-api";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { slotCandidates } from "../lib/slot-candidates";

export function useTenantSlotBlock(tenant: { id: string; name: string }) {
  const t = useTr();
  const slots = useTenantSlots(tenant.id, true);
  const lib = useLibraryDefs("library", true);
  const refresh = useLibraryRefresh();
  const [pending, setPending] = useState<string | null>(null);
  const rows = lib.data?.pages.flatMap((p) => p.items);
  const fail = (err: unknown) => {
    if (err instanceof ApiError && String(err.code) === "SLOT_GROUPS_MISSING")
      return notifyError(
        t("tenants.slots.err.groupsMissing", { keys: errorLines(err.details).join("; ") }),
      );
    if (err instanceof ApiError && String(err.code) === "PROCESS_NOT_PUBLISHED")
      return notifyError(t("tenants.slots.err.notPublished"));
    const spec = describeError(err);
    notifyError(t(spec.key, spec.params));
  };
  const run = async (slot: string, job: () => Promise<unknown>, done: string, process: string) => {
    setPending(slot);
    try {
      await job();
      notifySuccess(t(done, { process, tenant: tenant.name }));
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setPending(null);
    }
  };
  return {
    slots,
    pending,
    hidden:
      slots.error instanceof ApiError && (slots.error.status === 403 || slots.error.status === 404),
    candidates: (slot: string) => slotCandidates(rows, slot),
    assign: (slot: string, defId: string, name: string) =>
      run(slot, () => assignTenant(tenant.id, slot, defId), "tenants.slots.toast.assigned", name),
    unassign: (slot: string) =>
      run(slot, () => unassignTenant(tenant.id, slot), "tenants.slots.toast.unassigned", ""),
  };
}
