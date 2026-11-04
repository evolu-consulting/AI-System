// CR-118 · cr118-app-config · dữ liệu tab "Quy trình" của một app: khe của app, quy trình thư viện cùng khe, công ty đang được gán riêng.
// Dùng lại API thư viện CR-105 (useSlots / useLibraryDefs / useAssignmentsOf); sửa luôn mở ProcessEditorPage, không có editor thứ hai.
import { useEffect, useMemo } from "react";
import {
  type LibraryListItem,
  type SlotInfo,
  useAssignmentsOf,
  useLibraryDefs,
  useSlots,
} from "@/features/processes/library-api";
import { hubConfigured } from "@/lib/hub";
import { slotsOfApp } from "../lib/app-config";

export type SlotView = { slot: SlotInfo; defs: LibraryListItem[] };
/** tenantId → quy trình riêng được gán (theo khe). */
export type AssignedMap = Record<string, { slot: string; name: string }[]>;

export function useAppProcesses(appKey: string) {
  const configured = hubConfigured();
  const slotsQ = useSlots(true);
  const defsQ = useLibraryDefs("library", true);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = defsQ;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const all = useMemo(() => defsQ.data?.pages.flatMap((p) => p.items) ?? [], [defsQ.data]);
  const views = useMemo<SlotView[]>(() => {
    const defs = slotsOfApp(all, appKey);
    return slotsOfApp(slotsQ.data ?? [], appKey).map((slot) => ({
      slot,
      defs: defs.filter((d) => d.slot === slot.slot),
    }));
  }, [all, slotsQ.data, appKey]);

  const assignedDefs = useMemo(
    () => views.flatMap((v) => v.defs).filter((d) => !d.is_default && (d.tenant_count ?? 0) > 0),
    [views],
  );
  const assignQs = useAssignmentsOf(
    assignedDefs.map((d) => d.id),
    true,
  );
  const assigned = useMemo<AssignedMap>(() => {
    const out: AssignedMap = {};
    assignedDefs.forEach((d, i) => {
      for (const a of assignQs[i]?.data ?? []) {
        const mine = out[a.tenant_id] ?? [];
        mine.push({ slot: d.slot ?? "", name: d.name });
        out[a.tenant_id] = mine;
      }
    });
    return out;
  }, [assignedDefs, assignQs]);

  return {
    configured,
    views,
    assigned,
    pending: configured && (slotsQ.isPending || defsQ.isPending),
    error: slotsQ.error ?? defsQ.error ?? null,
    refetch: () => {
      void slotsQ.refetch();
      void defsQ.refetch();
    },
  };
}
