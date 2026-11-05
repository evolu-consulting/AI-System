// CR-118 · cr118-routing-diagram · sơ đồ của MỘT quy trình đã gán, nạp khi mở (`enabled`), không nạp trước.
import { useQuery } from "@tanstack/react-query";
import { appsKeys, fetchRoutingDef } from "../api-apps";
import { type DefDiagram, defDiagramState } from "../lib/routing-def";

export function useRoutingDef(
  tenantId: string,
  slot: string,
  defId: string,
  enabled: boolean,
): DefDiagram {
  const q = useQuery({
    queryKey: appsKeys.routingDef(tenantId, slot, defId),
    queryFn: ({ signal }) => fetchRoutingDef(tenantId, slot, defId, signal),
    enabled,
    retry: false,
  });
  return defDiagramState({ enabled, isError: q.isError, data: q.data });
}
