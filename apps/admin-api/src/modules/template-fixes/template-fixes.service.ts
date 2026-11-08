// CR-125 · c5b · sửa nhanh để mẫu Thư viện dùng được ở công ty (nút một chạm của platform): bật tính năng cho công ty / tạo nhóm theo gợi ý.
// MỘT nguồn: gọi đúng `grantEntitlement` (features) và `createGroup` (groups) — cùng khoá, cùng audit, cùng NOTIFY cấu hình.
// Hẹp: bật tính năng CHỈ khi chính mẫu (flow_id) đang thiếu đúng tính năng đó theo luật readiness của Hub (một nguồn) — không cấp được
// tính năng không liên quan / có phí. Vai kiểm lại ở đây (không chỉ ở route).
import { suggestGroup } from "@ai/contracts/modules";
import { withScope } from "@ai/db";
import { AppError, appError } from "../../lib/errors";
import type { HubConfig } from "../commands/commands.hub-client";
import { grantEntitlement } from "../features/features.entitlements";
import * as featuresRepo from "../features/features.repo";
import type { Call as FeaturesCall } from "../features/features.service";
import { createGroup, type Call as GroupsCall } from "../groups/groups.service";

export type FixCall = FeaturesCall & GroupsCall;

const platformOnly = (c: FixCall): void => {
  if (c.actor.role !== "platform_admin") throw appError("FORBIDDEN");
};

/** Phần của `TemplateReadiness` mà ta cần. */
type Missing = { missing?: { features?: { key?: unknown }[] } };

/** Hỏi Hub "mẫu này thiếu gì ở công ty này" bằng chính token của người gọi (cùng luật, cùng dữ liệu với màn Gán). */
export async function readinessFromHub(
  hub: HubConfig | undefined,
  bearer: string | undefined,
  tenantId: string,
  flowId: string,
): Promise<Missing> {
  if (!hub) throw new AppError("HUB_NOT_CONFIGURED", 503, "Hub connection is not configured");
  const u = `${hub.url.replace(/\/$/, "")}/tenants/${encodeURIComponent(tenantId)}/company-flows/readiness/${encodeURIComponent(flowId)}`;
  const r = await fetch(u, { headers: bearer ? { authorization: bearer } : {} }).catch(() => null);
  if (!r) throw new AppError("HUB_UNREACHABLE", 502, "Hub is unreachable");
  if (r.status === 404) throw appError("NOT_FOUND");
  if (!r.ok) throw new AppError("HUB_ERROR", 502, `Hub answered ${r.status}`);
  return (await r.json()) as Missing;
}

/**
 * Bật tính năng `featureKey` cho công ty NẾU mẫu `flowId` đang thiếu đúng tính năng đó (khác ⇒ 422 FEATURE_NOT_NEEDED; khoá lạ ⇒ 404;
 * `core` ⇒ 409 do `grantEntitlement`; đã bật ⇒ không đổi, vẫn 200).
 */
export async function enableFeatureForTemplate(
  c: FixCall,
  a: { tenantId: string; flowId: string; featureKey: string; readiness: Missing },
) {
  platformOnly(c);
  const needed = (a.readiness.missing?.features ?? []).some((f) => f.key === a.featureKey);
  if (!needed)
    throw new AppError(
      "FEATURE_NOT_NEEDED",
      422,
      "Mẫu này không cần tính năng đó ở công ty — chỉ bật được tính năng mẫu đang thiếu.",
    );
  const id = await withScope(c.ctx.db, c.scope, (tx) =>
    featuresRepo.featureIdByKey(tx, a.featureKey),
  );
  if (!id) throw appError("NOT_FOUND");
  return grantEntitlement(c, id, a.tenantId);
}

/** Tạo nhóm theo gợi ý từ mã mẫu (trùng mã ở công ty ⇒ 409 KEY_TAKEN do `createGroup`). */
export function createSuggestedGroup(c: FixCall, tenantId: string, groupKey: string) {
  platformOnly(c);
  const g = suggestGroup(groupKey);
  return createGroup(c, tenantId, { key: g.key, name: g.name, description: null });
}
