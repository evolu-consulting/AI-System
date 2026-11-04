// CR-118 · cr118-app-config · nạp thân quy trình thư viện (`slot_body`) để vẽ sơ đồ + bảng bước chỉ đọc trong thẻ khe.
import { useMemo } from "react";
import { useProcessDef } from "@/features/processes/api";
import { rowsFromSlotBody } from "../lib/flow-view";

export function useSlotFlow(defId: string | undefined) {
  const q = useProcessDef(defId, undefined);
  const rows = useMemo(() => (q.data ? rowsFromSlotBody(q.data.slot_body) : null), [q.data]);
  return { rows, pending: q.isPending && !!defId, error: q.error };
}
