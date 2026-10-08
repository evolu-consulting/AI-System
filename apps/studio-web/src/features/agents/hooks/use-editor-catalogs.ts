// HUB-FR-60 · H4a-R04 · CR-054 · danh mục cho editor: model profile, workflow (catalog Admin, chỉ bản bật), agent type, model CLI.
// Lỗi tải ⇒ `failed` + `retry` để từng bước hiện Alert inline (form vẫn sửa được phần khác).
import type {
  AgentTypeItemSchema,
  ModelCatalogItem,
  ModelProfileItemSchema,
  WorkflowItemSchema,
} from "@ai/contracts/studio";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { agentTypesQuery, modelCatalogQuery, modelProfilesQuery, workflowsQuery } from "../api";

export type ModelProfileItem = z.infer<typeof ModelProfileItemSchema>;
export type WorkflowItem = z.infer<typeof WorkflowItemSchema>;
export type AgentTypeItem = z.infer<typeof AgentTypeItemSchema>;
export type Catalog<T> = { items: T[]; pending: boolean; failed: boolean; retry: () => void };

function useCatalog<T>(q: {
  data?: { items: T[] };
  isPending: boolean;
  isError: boolean;
  refetch: () => unknown;
}): Catalog<T> {
  return {
    items: q.data?.items ?? [],
    pending: q.isPending,
    failed: q.isError,
    retry: () => void q.refetch(),
  };
}

export function useEditorCatalogs() {
  return {
    profiles: useCatalog<ModelProfileItem>(useQuery(modelProfilesQuery)),
    workflows: useCatalog<WorkflowItem>(useQuery(workflowsQuery)),
    agentTypes: useCatalog<AgentTypeItem>(useQuery(agentTypesQuery)),
    models: useCatalog<ModelCatalogItem>(useQuery(modelCatalogQuery)),
  };
}
