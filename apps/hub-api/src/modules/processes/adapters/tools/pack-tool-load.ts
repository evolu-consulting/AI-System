// N2-FR-03 · N2-D02 · plan N2 §4: stage `tool` trỏ tool của gói — `loadCall` vẫn MỘT câu (usable/canRun/real_action/thử lại
// từ DB như P-d2); phần "catalog" lấy từ registry: `switchOn` = gói bật cho tenant CỦA RUN (cache), `sideEffect` của tool gói,
// `wfEnabled` = đã đăng ký. `preCallReason` không đổi ⇒ giữ D2-49 (`side_effect ∧ ¬real_action ⇒ tool_failed`).
// Security M2 · người bắt đầu phải có quyền gói đúng `action` của tool (cache, 0 SQL nóng) — mất ⇒ `canRun=false` ⇒
// `permission_lost` (như mất quyền chạy quy trình).
import type { PackToolCatalog } from "../../../packs/kit/application/pack-tools.ports";
import type { ToolCallLoad } from "../../application/tools/tool.ports";

export async function withPackTool(
  l: ToolCallLoad,
  packs: PackToolCatalog | undefined,
  tenantId: string,
): Promise<ToolCallLoad> {
  const info = packs?.info(l.toolKey);
  if (!packs || !info) return l;
  const { endpoint: _workflowEndpoint, ...rest } = l;
  const [switchOn, starterOk] = await Promise.all([
    packs.enabled(tenantId, l.toolKey),
    packs.canUse({ tenantId, userId: l.startedBy }, l.toolKey),
  ]);
  return {
    ...rest,
    packTool: true,
    workflowId: "",
    sideEffect: info.sideEffect,
    inputSchemaOk: true,
    wfEnabled: true,
    switchOn,
    // Gói tắt ⇒ `tool_failed` (switchOn) thắng: không phải mất quyền của người.
    canRun: l.canRun && (starterOk || !switchOn),
  };
}
