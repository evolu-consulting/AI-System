// CR-102 · com-c3 · quyền vào gói community + người xem của request. Gói phải bật cho tenant (entitlement, cache 0 SQL).
// User nội bộ: theo Group như mọi gói (read/write/admin). User ngoài (CR-102a): đọc + ghi, KHÔNG BAO GIỜ admin, công ty còn
// hiệu lực (C2 sẽ gộp nhánh này vào `packGuard` chung qua `EXTERNAL_PACKS`; ở đây cục bộ để không chạm file C2).
// Danh bạ (tên tenant/user/công ty) = MỘT câu qua cổng kit `ExternalOrgResolver.directory`.
import type { Context } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError } from "../../../../lib/errors";
import type { ExtDirectory, ExternalOrgResolver, PackWho } from "../../kit/public";
import {
  checkPackAccess,
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packEnabled,
} from "../../kit/public";

export const COMMUNITY_KEY = "community";

export type Access = {
  who: PackWho;
  /** null = chủ quản. */
  org: string | null;
  canWrite: boolean;
  /** Admin chủ quản: `tenant_admin` hoặc Group được cấp `community-admin` (HT-82). Đối tác: luôn false. */
  isAdmin: boolean;
  dir: ExtDirectory;
};

const forbidden = () => new AppError("PACK_FORBIDDEN", 403, "Forbidden");

async function internalAccess(view: PackAccessView, u: AuthUser) {
  const i = await packAccessInput(view, COMMUNITY_KEY, u);
  const ok = (a: "read" | "write" | "admin") =>
    checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction[a] }) === "ok";
  if (!ok("read")) throw forbidden();
  return { canWrite: ok("write"), isAdmin: u.role === "tenant_admin" || ok("admin") };
}

/** Người gọi + quyền; `need = "write"` ⇒ 403 khi chỉ đọc. Ném 403 PACK_DISABLED/PACK_FORBIDDEN. */
export const accessOf = (
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  c: Context<PackGuardVars>,
  need: "read" | "write" = "read",
): Promise<Access> => accessOfUser(view, resolver, c.get("user"), need);

/** Như `accessOf` nhưng từ người gọi (không cần Context) — dùng cho nguồn nav của kit (`GET /pack/nav`). */
export async function accessOfUser(
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  u: AuthUser,
  need: "read" | "write" = "read",
): Promise<Access> {
  if (!(await packEnabled(view, COMMUNITY_KEY, u.tenantId)))
    throw new AppError("PACK_DISABLED", 403, "Pack is not enabled");
  const external = u.userKind === "external";
  if (external && !u.extOrgId) throw forbidden();
  const rights = external ? { canWrite: true, isAdmin: false } : await internalAccess(view, u);
  if (need === "write" && !rights.canWrite) throw forbidden();
  const dir = await resolver.directory(u.tenantId, u.userId);
  // Review TB1: claim token phải khớp DB (kind bất biến; lệch ⇒ token cũ/giả ⇒ từ chối, không trả raw/hits).
  const db = dir.user;
  if (!db || db.deactivated || (db.kind === "external") !== external) throw forbidden();
  if (external && db.extOrgId !== u.extOrgId) throw forbidden();
  const org = external ? (u.extOrgId as string) : null;
  if (org !== null && !dir.orgs.some((o) => o.id === org && o.active)) throw forbidden();
  return {
    who: { tenantId: u.tenantId, userId: u.userId, userKind: u.userKind, extOrgId: org },
    org,
    ...rights,
    dir,
  };
}

/** Tên công ty đối tác KHÁC `org` (ngữ cảnh che tên công ty, D4). `org = null` (chủ quản viết) ⇒ null = không che. */
export function otherOrgNames(a: Access): string[] | null {
  if (a.org === null) return null;
  return a.dir.orgs.filter((o) => o.id !== a.org).map((o) => o.name);
}
