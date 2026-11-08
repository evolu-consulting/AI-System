// CR-125 · c5b · sửa nhanh để mẫu Thư viện dùng được ở công ty (nút một chạm của platform): bật tính năng cho công ty / tạo nhóm theo gợi ý.
// MỘT nguồn: gọi đúng `grantEntitlement` (features) và `createGroup` (groups) — cùng khoá, cùng audit, cùng NOTIFY cấu hình. Không logic riêng.
import { suggestGroup } from "@ai/contracts/modules";
import { withScope } from "@ai/db";
import { appError } from "../../lib/errors";
import { grantEntitlement } from "../features/features.entitlements";
import * as featuresRepo from "../features/features.repo";
import type { Call as FeaturesCall } from "../features/features.service";
import { createGroup, type Call as GroupsCall } from "../groups/groups.service";

export type FixCall = FeaturesCall & GroupsCall;

/** Bật tính năng `featureKey` cho công ty (khoá lạ ⇒ 404; `core` ⇒ 409 do `grantEntitlement`; đã bật ⇒ không đổi, vẫn 200). */
export async function enableFeatureForTenant(c: FixCall, tenantId: string, featureKey: string) {
  const id = await withScope(c.ctx.db, c.scope, (tx) =>
    featuresRepo.featureIdByKey(tx, featureKey),
  );
  if (!id) throw appError("NOT_FOUND");
  return grantEntitlement(c, id, tenantId);
}

/** Tạo nhóm theo gợi ý từ mã mẫu (trùng mã ở công ty ⇒ 409 KEY_TAKEN do `createGroup`). */
export function createSuggestedGroup(c: FixCall, tenantId: string, groupKey: string) {
  const g = suggestGroup(groupKey);
  return createGroup(c, tenantId, { key: g.key, name: g.name, description: null });
}
