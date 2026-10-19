// PK-FR-05 · PK-NFR-01 · D-04 · D-05 · D-11 · N1 plan §5: kiểm quyền gói ở hub-api từ cache cấu hình (0 SQL khi nóng, ≤ 1
// khi user nguội — `user()` đọc DB một lần). Không import `modules/config` (luật `pack-no-hub-modules`): nhận cổng cấu trúc
// `PackAccessView` (ConfigCache thoả sẵn), lớp 4 nối vào. Chỉ mục `featureKey → feature` dựng một lần mỗi ảnh catalog.
// Grant user lẻ (`grantUsers`) bị bỏ qua với mã gói (D-11 / Q9).
import { PACK_ACTIONS, type PackAction, packFeatureKey } from "@ai/contracts";
import type { MiddlewareHandler } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError } from "../../../../lib/errors";
import {
  checkPackAccess,
  type PackActionsInput,
  type PackAction as RulesAction,
} from "../domain/pack-access.rules";

/** Phần catalog cần (khớp cấu trúc `CatalogSnapshot`; ảnh bất biến, đổi ảnh = nạp lại). */
export type PackCatalogView = {
  readonly features: readonly { id: string; key: string; status: string }[];
  /** `${tenantId}:${featureId}` có entitlement chưa thu hồi. */
  readonly entitled: ReadonlySet<string>;
  /** `${tenantId}:${featureId}` → group được cấp. */
  readonly grantGroups: ReadonlyMap<string, readonly string[]>;
};
/** Cổng đọc quyền (ConfigCache thoả cấu trúc). */
export type PackAccessView = {
  /** Chờ lần nạp lại đang chạy (nếu có) — 0 SQL; vắng = không chờ. */
  adminSettled?(): Promise<void>;
  catalog(): Promise<PackCatalogView>;
  user(id: string): Promise<{ tenantId: string; groupIds: ReadonlySet<string> } | undefined>;
};
export type PackGuardVars = { Variables: { user: AuthUser } };

// Hai định nghĩa (contract ↔ lớp 1) phải trùng; lệch ⇒ lỗi biên dịch ở đây.
const SAME: readonly RulesAction[] = PACK_ACTIONS satisfies readonly PackAction[];

type FeatureRef = { id: string; off: boolean };
const indexes = new WeakMap<PackCatalogView, ReadonlyMap<string, FeatureRef>>();

function featureIndex(cat: PackCatalogView): ReadonlyMap<string, FeatureRef> {
  let m = indexes.get(cat);
  if (!m) {
    m = new Map(cat.features.map((f) => [f.key, { id: f.id, off: f.status === "off" }]));
    indexes.set(cat, m);
  }
  return m;
}

const NONE: readonly string[] = [];

/** Đầu vào luật cho (gói, user). Gói chưa cài (thiếu feature) ⇒ như chưa bật. Việc chỉ tính khi feature của việc đó còn
 *  entitlement và không `off` (fail-closed). */
export async function packAccessInput(
  view: PackAccessView,
  packKey: string,
  who: Pick<AuthUser, "userId" | "tenantId">,
): Promise<PackActionsInput> {
  await view.adminSettled?.();
  const [cat, u] = await Promise.all([view.catalog(), view.user(who.userId)]);
  const idx = featureIndex(cat);
  const usable = (f: FeatureRef | undefined): f is FeatureRef =>
    f !== undefined && !f.off && cat.entitled.has(`${who.tenantId}:${f.id}`);
  const read = idx.get(packFeatureKey(packKey, "read"));
  const granted = {} as Record<RulesAction, readonly string[]>;
  for (const a of SAME) {
    const f = idx.get(packFeatureKey(packKey, a));
    granted[a] = usable(f) ? (cat.grantGroups.get(`${who.tenantId}:${f.id}`) ?? NONE) : NONE;
  }
  const sameTenant = u !== undefined && u.tenantId === who.tenantId;
  return {
    entitled: read !== undefined && cat.entitled.has(`${who.tenantId}:${read.id}`),
    featureOff: read?.off ?? false,
    userGroupIds: sameTenant ? u.groupIds : new Set(),
    grantedByAction: granted,
  };
}

const MESSAGES = { PACK_DISABLED: "Pack is not enabled", PACK_FORBIDDEN: "Forbidden" } as const;

/** Chặn route gói cần `action`: 403 `PACK_DISABLED` / `PACK_FORBIDDEN` (plan §2). Đặt SAU `requireAuth`. */
export function packGuard(
  view: PackAccessView,
  packKey: string,
  action: PackAction,
): MiddlewareHandler<PackGuardVars> {
  return async (c, next) => {
    const i = await packAccessInput(view, packKey, c.get("user"));
    const r = checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction[action] });
    if (r !== "ok") throw new AppError(r, 403, MESSAGES[r]);
    await next();
  };
}
