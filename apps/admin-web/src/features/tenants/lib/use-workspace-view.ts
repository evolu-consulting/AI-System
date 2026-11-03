// CR-112 · tenant đang xem của tab nhúng trong workspace công ty (thay `?tenant=` + danh sách tenant của các màn cũ).
import type { Me } from "@ai/contracts";
import { resolveWorkspaceTenant } from "@/lib/viewed-tenant";
import { useWorkspaceTenant } from "./workspace-context";

/** Chỉ dùng bên trong `WorkspaceProvider` (TenantDetailPage vẽ tab sau khi đã tải chi tiết công ty). */
export function useWorkspaceView(me: Me | null) {
  const ws = useWorkspaceTenant();
  if (!ws) throw new Error("useWorkspaceView ngoài workspace công ty");
  return resolveWorkspaceTenant(me, ws);
}
