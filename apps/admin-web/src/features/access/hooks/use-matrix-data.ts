// ADM-FR-35 · M3-R09 · dữ liệu ma trận: nạp đủ group (gộp trang) và dựng tập ô đã cấp `featureId:groupId`.
import { useMemo } from "react";
import { ApiError } from "@/lib/http";
import { useMatrix } from "../api";
import { cellKey, type MatrixModel } from "../lib/matrix";

export function useMatrixData(tenantId: string | undefined, enabled: boolean) {
  const query = useMatrix(tenantId, enabled);
  const model = useMemo<MatrixModel | null>(() => {
    const data = query.data;
    if (!data) return null;
    const granted = new Set<string>();
    for (const m of data.features) {
      for (const gid of m.granted_group_ids) granted.add(cellKey(m.feature.id, gid));
    }
    return { groups: data.groups, features: data.features, granted };
  }, [query.data]);
  const err = query.error instanceof ApiError ? query.error : null;
  return {
    query,
    model,
    resolvedTenantId: query.data?.tenant_id,
    trimmed: !!query.data && query.data.groups.length < query.data.group_total,
    total: query.data?.group_total ?? 0,
    loadError: err ? { message: err.message, code: err.code } : null,
  };
}
