// PK-FR-05 · PK-NFR-01 · D-04 · D-05 · D-11 · N1 plan §5: kiểm quyền gói ở hub-api từ cache cấu hình (0 SQL khi nóng, ≤ 1
// khi user nguội — `user()` đọc DB một lần). Không import `modules/config` (luật `pack-no-hub-modules`): nhận cổng cấu trúc
// `PackAccessView` (ConfigCache thoả sẵn), lớp 4 nối vào. Chỉ mục `featureKey → feature` dựng một lần mỗi ảnh catalog.
// Grant user lẻ (`grantUsers`) bị bỏ qua với mã gói (D-11 / Q9).
import { PACK_ACTIONS, type PackAction, packFeatureKey } from "@ai/contracts/packs";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError } from "../../../../lib/errors";
import { externalSurfaceActions } from "../domain/external-access.rules";
import {
  checkPackAccess,
  type PackActionsInput,
  type PackAction as RulesAction,
} from "../domain/pack-access.rules";
import { INTERNAL_SURFACE_ACTIONS, surfaceOf } from "../domain/pack-surface.rules";

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
  user(
    id: string,
  ): Promise<{ tenantId: string; groupIds: ReadonlySet<string>; external?: boolean } | undefined>;
};
/** `platformTenant`: CHỈ do `packGuardOrPlatform` đặt (platform_admin + `?tenant_id` đã kiểm gói bật). */
export type PackGuardVars = { Variables: { user: AuthUser; platformTenant?: string } };

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
 *  entitlement và không `off` (fail-closed). `packKey` là MẶT API (ADR-0044, vd `community`) ⇒ quyền theo gói chủ ∧ add-on
 *  của mặt (add-on thiếu/tắt ⇒ như gói tắt); nội bộ có BẤT KỲ quyền gói chủ ⇒ read + write, không `admin`; đối tác chỉ
 *  `EXTERNAL_SURFACES` (không bao giờ quyền gói chủ). */
export async function packAccessInput(
  view: PackAccessView,
  packKey: string,
  who: Pick<AuthUser, "userId" | "tenantId" | "userKind">,
): Promise<PackActionsInput> {
  await view.adminSettled?.();
  const [cat, u] = await Promise.all([view.catalog(), view.user(who.userId)]);
  const idx = featureIndex(cat);
  const sf = surfaceOf(packKey);
  const owner = sf?.pack ?? packKey;
  const entitledOf = (f: FeatureRef | undefined) =>
    f !== undefined && cat.entitled.has(`${who.tenantId}:${f.id}`);
  const read = idx.get(packFeatureKey(owner, "read"));
  const addon = sf ? idx.get(sf.addon) : undefined;
  const external = who.userKind === "external" || u?.external === true;
  const sameTenant = u !== undefined && u.tenantId === who.tenantId;
  return {
    entitled: entitledOf(read) && (sf === undefined || entitledOf(addon)),
    featureOff: (read?.off ?? false) || (addon?.off ?? false),
    userGroupIds: external ? EXTERNAL_SUBJECT : sameTenant ? u.groupIds : new Set(),
    grantedByAction: grantsOf(cat, idx, packKey, who.tenantId, external),
  };
}

/** Group/chủ thể được cấp từng việc. Gói thường: Group của feature `<k>-<việc>`. Mặt API (ADR-0044): nội bộ = BẤT KỲ quyền gói chủ
 *  ⇒ read + write (không admin); đối tác = `EXTERNAL_SURFACES` khi gói chủ ∧ add-on dùng được. */
function grantsOf(
  cat: PackCatalogView,
  idx: ReadonlyMap<string, FeatureRef>,
  packKey: string,
  tenantId: string,
  external: boolean,
): Record<RulesAction, readonly string[]> {
  const sf = surfaceOf(packKey);
  const usable = (f: FeatureRef | undefined): f is FeatureRef =>
    f !== undefined && !f.off && cat.entitled.has(`${tenantId}:${f.id}`);
  const featureOf = (a: RulesAction) => idx.get(packFeatureKey(sf?.pack ?? packKey, a));
  const groupsOf = (a: RulesAction) => {
    const f = featureOf(a);
    return usable(f) ? (cat.grantGroups.get(`${tenantId}:${f.id}`) ?? NONE) : NONE;
  };
  const surfaceOn = sf !== undefined && usable(featureOf("read")) && usable(idx.get(sf.addon));
  const anyOwnerGroup = sf ? SAME.flatMap(groupsOf) : NONE;
  const out = {} as Record<RulesAction, readonly string[]>;
  for (const a of SAME) {
    if (external) out[a] = externalGrant(packKey, a, sf ? surfaceOn : usable(featureOf(a)));
    else if (sf) out[a] = INTERNAL_SURFACE_ACTIONS.includes(a) ? anyOwnerGroup : NONE;
    else out[a] = groupsOf(a);
  }
  return out;
}

/** CR-102a · com-c2: chủ thể giả cho đối tác — Group KHÔNG BAO GIỜ tính (kể cả hàng lọt vào DB); chỉ `EXTERNAL_SURFACES`. */
const EXTERNAL_SUBJECT_ID = "external:partner";
const EXTERNAL_SUBJECT: ReadonlySet<string> = new Set([EXTERNAL_SUBJECT_ID]);
const externalGrant = (surface: string, a: RulesAction, usableNow: boolean) =>
  usableNow && externalSurfaceActions(surface).includes(a) ? [EXTERNAL_SUBJECT_ID] : NONE;

/** N2-FR-03 · gói/mặt bật cho tenant (không xét user): entitlement `<k'>-read` của gói chủ còn hiệu lực ∧ feature không `off`
 *  (mặt API: thêm add-on của mặt bật). */
export async function packEnabled(
  view: PackAccessView,
  packKey: string,
  tenantId: string,
): Promise<boolean> {
  await view.adminSettled?.();
  const cat = await view.catalog();
  const idx = featureIndex(cat);
  const sf = surfaceOf(packKey);
  const on = (f: FeatureRef | undefined) =>
    f !== undefined && !f.off && cat.entitled.has(`${tenantId}:${f.id}`);
  return on(idx.get(packFeatureKey(sf?.pack ?? packKey, "read"))) && (!sf || on(idx.get(sf.addon)));
}

/** engine-flag-tenant · feature theo công ty (khoá tuỳ ý, vd `han-muc-duyet`): tenant có entitlement còn hiệu lực ∧
 *  feature tồn tại và không `off` (fail-closed: thiếu feature ⇒ false). Cache cấu hình, 0 SQL. */
export async function tenantFeatureOn(
  view: PackAccessView,
  featureKey: string,
  tenantId: string,
): Promise<boolean> {
  await view.adminSettled?.();
  const cat = await view.catalog();
  const f = featureIndex(cat).get(featureKey);
  return f !== undefined && !f.off && cat.entitled.has(`${tenantId}:${f.id}`);
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CR-121 Q-3 · như `packGuard` nhưng platform_admin (vai từ JWT, không từ query) đi đường riêng: bắt buộc `?tenant_id` (uuid, 400)
 * của công ty đích, gói phải đang bật cho công ty đó (cache cấu hình, 0 SQL; không bật ⇒ 403 `PACK_DISABLED`), rồi đặt
 * `platformTenant`. Vai khác: đúng `packGuard` (query `tenant_id` bị bỏ qua ⇒ tenant_admin công ty khác không chạm được tenant này).
 * Chỉ dùng cho thao tác "mở lại" (route tự bắt lý do + audit); KHÔNG cấp quyền nào khác cho platform_admin.
 */
export function packGuardOrPlatform(
  view: PackAccessView,
  packKey: string,
  action: PackAction,
): MiddlewareHandler<PackGuardVars> {
  const tenantGuard = packGuard(view, packKey, action);
  return async (c, next) => {
    if (c.get("user").role !== "platform_admin") return tenantGuard(c, next);
    const tid = c.req.query("tenant_id") ?? "";
    if (!UUID_RE.test(tid)) throw new AppError("TENANT_REQUIRED", 400, "tenant_id is required");
    if (!(await packEnabled(view, packKey, tid)))
      throw new AppError("PACK_DISABLED", 403, MESSAGES.PACK_DISABLED);
    c.set("platformTenant", tid);
    await next();
  };
}

/** `PackWho` của request: platform ⇒ tenant đích + `platform: true`; còn lại tenant/user của token. */
export function requestWho(c: Context<PackGuardVars>): {
  tenantId: string;
  userId: string;
  platform?: boolean;
} {
  const u = c.get("user");
  const pt = u.role === "platform_admin" ? c.get("platformTenant") : undefined;
  return pt
    ? { tenantId: pt, userId: u.userId, platform: true }
    : { tenantId: u.tenantId, userId: u.userId };
}
