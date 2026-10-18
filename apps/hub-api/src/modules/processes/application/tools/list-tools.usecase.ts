// HUB-FR-146 · AC-H47 · TT-R04 · plan-d2 §4 "Catalog editor", §10 S6: tool của tenant cho editor (một câu, ≤ 200, theo
// key). Phạm vi mẫu (`tenantId` null) ⇒ `[]` — def mẫu không dùng được tool (REF_INVALID khi lưu).
import type { ToolCatalogItem, ToolSwitchReader } from "./tool.ports";

export async function listTools(reader: ToolSwitchReader | null): Promise<ToolCatalogItem[]> {
  return reader ? reader.available() : [];
}
