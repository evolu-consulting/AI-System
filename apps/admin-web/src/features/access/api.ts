// ADM-FR-35 · ADM-FR-36 · gọi API ma trận grant / batch (nơi duy nhất của feature access) dưới dạng hook TanStack Query.
import type {
  GrantBatchRequest,
  GrantBatchResponse,
  GrantMatrix,
  MatrixFeature,
} from "@ai/contracts";
import { MATRIX_GROUPS_MAX } from "@ai/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/http";

export const ACCESS_KEYS = {
  all: ["access"] as const,
  matrix: (tenantId: string) => ["access", "matrix", tenantId] as const,
};

/** Tối đa 10 trang × 200 group; hơn nữa thì báo `groupsTrimmed` (hiếm: spec giả định ≤ 200 group/tenant). */
const MAX_PAGES = 10;

function mergeFeatures(base: MatrixFeature[], extra: MatrixFeature[]): MatrixFeature[] {
  const more = new Map(extra.map((m) => [m.feature.id, m.granted_group_ids]));
  return base.map((m) => ({
    ...m,
    granted_group_ids: [...m.granted_group_ids, ...(more.get(m.feature.id) ?? [])],
  }));
}

/** Nạp ma trận đủ group (server trả ≤ 200 group mỗi trang): gộp `groups` và `granted_group_ids` của các trang. */
export async function fetchMatrix(tenantId: string | undefined): Promise<GrantMatrix> {
  const page = (offset: number) =>
    api<GrantMatrix>("/admin/grants/matrix", {
      query: { tenant_id: tenantId, limit: MATRIX_GROUPS_MAX, offset: offset || undefined },
    });
  const first = await page(0);
  let features = first.features;
  const groups = [...first.groups];
  for (let n = 1; n < MAX_PAGES && groups.length < first.group_total; n++) {
    const next = await page(groups.length);
    if (next.groups.length === 0) break;
    groups.push(...next.groups);
    features = mergeFeatures(features, next.features);
  }
  return { ...first, groups, features };
}

/** `tenantId` undefined với tenant_admin (server suy ra từ phiên); platform_admin truyền tenant đang xem. */
export function useMatrix(tenantId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ACCESS_KEYS.matrix(tenantId ?? ""),
    enabled,
    staleTime: 0,
    queryFn: () => fetchMatrix(tenantId),
  });
}

/** Lưu ma trận qua MỘT `PUT /admin/grants/batch` (một transaction, ≤ 200 thao tác). */
export function useSaveMatrix(tenantId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Pick<GrantBatchRequest, "add" | "remove">) =>
      api<GrantBatchResponse>("/admin/grants/batch", {
        method: "PUT",
        body,
        query: { tenant_id: tenantId },
      }),
    onSuccess: () => {
      // `feature_count` của group (danh sách, chi tiết, tab Feature) cũng đổi sau khi lưu ma trận.
      void qc.invalidateQueries({ queryKey: ["groups"] });
      return qc.invalidateQueries({ queryKey: ACCESS_KEYS.all });
    },
  });
}
