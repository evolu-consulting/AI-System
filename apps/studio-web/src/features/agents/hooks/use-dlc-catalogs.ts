// dlc-agent-flows · danh mục cho section "Quy trình DLC": tool gói agent gắn được + def thư viện đã xuất bản theo khe DLC.
import type { DlcFlowList, PackToolList } from "@ai/contracts/studio";
import { useQuery } from "@tanstack/react-query";
import { dlcFlowsQuery, packToolsQuery } from "../api";
import type { Catalog } from "./use-editor-catalogs";

export type PackToolItem = PackToolList["items"][number];
export type DlcFlowSlot = DlcFlowList["items"][number];

export function useDlcCatalogs(): { tools: Catalog<PackToolItem>; flows: Catalog<DlcFlowSlot> } {
  const tools = useQuery(packToolsQuery);
  const flows = useQuery(dlcFlowsQuery);
  const of = <T>(q: typeof tools | typeof flows, items: T[]): Catalog<T> => ({
    items,
    pending: q.isPending,
    failed: q.isError,
    retry: () => void q.refetch(),
  });
  return {
    tools: of(tools, tools.data?.items ?? []),
    flows: of(flows, flows.data?.items ?? []),
  };
}
