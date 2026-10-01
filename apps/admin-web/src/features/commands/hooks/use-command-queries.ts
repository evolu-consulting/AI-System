// ADM-FR-20, ADM-FR-24 · cổng hook cho component của Commands: component chỉ gọi hook ở đây, không import `api.ts` (luật component-no-fetch).
import { useCallback } from "react";
import { findNameConflict } from "../api";

export { ACCESS_PAGE_SIZE, useCommandAccess, useFeatureOptions, useWorkflowOptions } from "../api";

/** Hàm kiểm tên/alias đã thuộc command khác (D7); lỗi mạng coi như chưa trùng (server vẫn là nguồn quyết định). */
export function useNameCheck(excludeId?: string): (name: string) => Promise<boolean> {
  return useCallback((name) => findNameConflict(name, excludeId).catch(() => false), [excludeId]);
}
