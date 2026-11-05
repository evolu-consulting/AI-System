// CR-120 · sơ đồ CHỈ ĐỌC của quy trình platform đã gán (nạp khi mở, qua GET routing …/processes/:defId — tenant_admin không đọc
// được def thư viện trực tiếp). Tách khỏi dòng để dòng không kéo thư viện sơ đồ vào chunk danh sách khi chưa mở.
import type { ProcessRoutingDefView } from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { FlowRowsView } from "@/features/apps/components/SlotFlowView";
import { rowsFromSlotBody } from "@/features/apps/lib/flow-view";
import { api } from "@/lib/http";
import { hubUrl } from "@/lib/hub";

const enc = encodeURIComponent;

export default function FlowDiagram({
  tid,
  slot,
  defId,
}: {
  tid: string;
  slot: string;
  defId: string;
}) {
  const q = useQuery({
    queryKey: ["process", "routing", tid, slot, "def", defId],
    retry: false,
    queryFn: () =>
      api<ProcessRoutingDefView>(
        hubUrl(`/tenants/${enc(tid)}/process-routing/${enc(slot)}/processes/${enc(defId)}`) ?? "",
      ),
  });
  const rows = useMemo(() => (q.data ? rowsFromSlotBody(q.data.slot_body) : null), [q.data]);
  return <FlowRowsView rows={rows} pending={q.isPending} error={q.error} />;
}
