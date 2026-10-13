// HUB-FR-128 · P-c1 FC4 · loader tải nội dung diff/log tự sửa (Bearer, kèm `tenant_id` khi platform_admin) — để component không import api.ts.
import { useCallback } from "react";
import { fetchAttachmentContent } from "../api";

export function useAttachmentLoader(tenantId: string | undefined) {
  return useCallback((id: string) => fetchAttachmentContent(id, tenantId), [tenantId]);
}
