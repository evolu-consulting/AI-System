// HUB-FR-77 · HUB-FR-78 · API Quyền agent (`/studio/api/agent-entitlements*`, spec H4b2 §3 C): ma trận, chi tiết ô, cấp/thu hồi.
import type {
  EntitlementCellDetail,
  EntitlementMatrix,
  EntitlementWriteResult,
} from "@ai/contracts/studio";
import { queryOptions } from "@tanstack/react-query";
import { api } from "#/lib/http";

export const ACCESS_KEY = ["studio", "agent-entitlements"] as const;
export type CellRef = { agentId: string; tenantId: string };

const cellPath = (c: CellRef) =>
  `/studio/api/agent-entitlements/${encodeURIComponent(c.agentId)}/${encodeURIComponent(c.tenantId)}`;

export const matrixQuery = queryOptions({
  queryKey: ACCESS_KEY,
  queryFn: ({ signal }) => api<EntitlementMatrix>("/studio/api/agent-entitlements", { signal }),
  staleTime: 0,
  refetchOnWindowFocus: false,
});

export const cellDetailQuery = (c: CellRef) =>
  queryOptions({
    queryKey: [...ACCESS_KEY, "cell", c.agentId, c.tenantId] as const,
    queryFn: ({ signal }) => api<EntitlementCellDetail>(cellPath(c), { signal }),
    staleTime: 0,
  });

export const grantEntitlement = (c: CellRef) =>
  api<EntitlementWriteResult>(cellPath(c), { method: "PUT" });

export const revokeEntitlement = (c: CellRef) =>
  api<EntitlementWriteResult>(cellPath(c), { method: "DELETE" });
