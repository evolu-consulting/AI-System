// commands-unfreeze · workflow gắn agent chỉ là tool khi người gọi dùng được feature của workflow: tenant có entitlement + user có grant
// (cùng luật `usableCatalogCommands` của lệnh `/`). Workflow KHÔNG có command nào (không gắn feature) giữ hành vi cũ (không chặn).
// Dùng ở hai nơi: dựng `payload.mcp.tools` của job (lúc offer) và `McpService.tools` (lúc `tools/list` VÀ `tools/call` — kiểm lại ở server).
import { type CatalogSnapshot, usableCatalogCommands } from "../config/catalog.rules";
import type { ConfigCache } from "../config/config.service";

export type WorkflowGate = (workflowId: string) => boolean;

/** Thuần: workflow nào được phép với (tenant, user) trong `cat`. */
export function workflowGateOf(
  cat: CatalogSnapshot,
  tenant: Parameters<typeof usableCatalogCommands>[1],
  user: Parameters<typeof usableCatalogCommands>[2] | undefined,
): WorkflowGate {
  const gated = new Set(cat.commands.map((c) => c.workflowId));
  const usable = new Set(
    user ? usableCatalogCommands(cat, tenant, user).map((u) => u.workflow.id) : [],
  );
  return (id) => !gated.has(id) || usable.has(id);
}

export async function workflowGate(
  config: Pick<ConfigCache, "catalog" | "tenant" | "user">,
  tenantId: string,
  userId: string,
): Promise<WorkflowGate> {
  const [cat, tenant, user] = await Promise.all([
    config.catalog(),
    config.tenant(tenantId),
    config.user(userId),
  ]);
  return workflowGateOf(cat, tenant, user);
}
