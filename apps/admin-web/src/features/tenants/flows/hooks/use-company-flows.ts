// CR-121 c11 · dữ liệu tab Quy trình của công ty: MỘT lần đọc năng lực (app → việc) + luật theo việc + thân quy trình đang dùng (chip bước).
// Số lần gọi theo SỐ VIỆC đã đăng ký (hằng nhỏ), không theo hàng dữ liệu; lượt đang chạy chỉ gọi khi mở ngăn.
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { slotsOfCaps } from "@/features/processes/lib/flows-view";
import { useTenantCaps, useTenantRoutings } from "../../api-routing";
import { defStepsQuery } from "../api";
import { groupJobs, summaryOf } from "../lib/flow-rows";

export function useCompanyFlows(tenantId: string) {
  const caps = useTenantCaps(tenantId, true);
  const slots = useMemo(
    () => (caps.data ? slotsOfCaps(caps.data).map((s) => s.slot) : []),
    [caps.data],
  );
  const routings = useTenantRoutings(tenantId, slots, caps.isSuccess);
  const map = new Map(slots.map((s, i) => [s, routings[i]?.data] as const));
  const groups = caps.data ? groupJobs(caps.data.apps, map) : [];
  const withDef = groups.flatMap((g) => g.jobs).filter((j) => j.defId && j.routingLoaded);
  const steps = useQueries({
    queries: withDef.map((j) => defStepsQuery(tenantId, j.slot, j.defId ?? "")),
  });
  const stepsOf = new Map(withDef.map((j, i) => [j.slot, steps[i]?.data?.steps ?? null] as const));
  return {
    groups,
    summary: summaryOf(groups),
    routingOf: (slot: string) => map.get(slot),
    stepsOf: (slot: string) => stepsOf.get(slot) ?? null,
    pending: caps.isPending,
    error: caps.error,
    routingFailed: routings.some((q) => q.isError),
    refetch: () => void caps.refetch(),
  };
}
