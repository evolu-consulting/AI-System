// CR-125 · UX-S7 (H7) · "Đối tác xác nhận hợp đồng" của một công ty: đọc danh sách điều kiện (admin-api đọc hồ sơ + entitlement, Hub trả kênh/flow/nhóm,
// gộp bằng MỘT luật thuần `partnerChecklist`) và bật/tắt tính năng. Bật/tắt dùng ĐÚNG `grantEntitlement`/`revokeEntitlement` (cùng khoá, audit, NOTIFY) —
// không đường thứ hai; chỉ platform_admin (vai kiểm ở service, không chỉ ở route). Hub không trả lời ⇒ các mục của Hub "chưa đọc được", không lỗi cả màn.
import {
  PARTNER_ITEM_KEYS,
  type PartnerAdminPart,
  type PartnerChecklist,
  type PartnerHubPart,
  partnerChecklist,
} from "@ai/contracts/modules";
import { CONTRACTS_PARTNER_CONFIRM_FEATURE } from "@ai/contracts/tenants";
import { type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { appError } from "../../lib/errors";
import {
  featureIdByKey,
  grantEntitlement,
  revokeEntitlement,
} from "../features/features.entitlements";
import type { Call } from "../features/features.service";

export { PARTNER_ITEM_KEYS };

const CONTRACTS_READ = "contracts-read";

/** Phần admin-api: 1 câu SQL (hồ sơ + hai entitlement) — RLS theo scope của người gọi. */
async function adminPart(tx: Tx, tenantId: string): Promise<PartnerAdminPart | null> {
  const [r] = await tx.execute<{
    legal_name: boolean;
    tax_code: boolean;
    listed: boolean;
    app: boolean;
    feature: boolean;
  }>(sql`select (t.legal_name is not null and btrim(t.legal_name) <> '') as legal_name,
      (t.tax_code is not null and btrim(t.tax_code) <> '') as tax_code,
      t.directory_listed as listed,
      exists (select 1 from admin.feature_entitlements en join admin.features f on f.id = en.feature_id
        where en.tenant_id = t.id and en.revoked_at is null and f.status <> 'off' and f.key = ${CONTRACTS_READ}) as app,
      exists (select 1 from admin.feature_entitlements en join admin.features f on f.id = en.feature_id
        where en.tenant_id = t.id and en.revoked_at is null and f.status <> 'off'
          and f.key = ${CONTRACTS_PARTNER_CONFIRM_FEATURE}) as feature
    from admin.tenants t where t.id = ${tenantId}::uuid`);
  return r
    ? {
        contracts_app: r.app,
        feature: r.feature,
        legal_name: r.legal_name,
        tax_code: r.tax_code,
        listed: r.listed,
      }
    : null;
}

/** Hỏi Hub bằng chính token người gọi (cùng luật truy cập: platform hoặc quản trị chính công ty). Lỗi/không cấu hình ⇒ null. */
export async function hubPart(
  hubUrl: string | undefined,
  bearer: string | undefined,
  tenantId: string,
): Promise<PartnerHubPart | null> {
  if (!hubUrl) return null;
  const u = `${hubUrl.replace(/\/$/, "")}/tenants/${encodeURIComponent(tenantId)}/partner-confirm/readiness`;
  const r = await fetch(u, { headers: bearer ? { authorization: bearer } : {} }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => null)) as PartnerHubPart | null;
}

export async function readPartnerConfirm(
  c: Call,
  tenantId: string,
  hub: { url: string | undefined; bearer: string | undefined },
): Promise<PartnerChecklist> {
  const [admin, h] = await Promise.all([
    withScope(c.ctx.db, c.scope, (tx) => adminPart(tx, tenantId)),
    hubPart(hub.url, hub.bearer, tenantId),
  ]);
  if (!admin) throw appError("NOT_FOUND");
  return partnerChecklist(admin, h);
}

/** Bật/tắt tính năng cho công ty — chỉ platform_admin. Trả danh sách điều kiện mới. */
export async function setPartnerConfirm(
  c: Call,
  tenantId: string,
  on: boolean,
  hub: { url: string | undefined; bearer: string | undefined },
): Promise<PartnerChecklist> {
  if (c.actor.role !== "platform_admin") throw appError("FORBIDDEN");
  const id = await withScope(c.ctx.db, c.scope, (tx) =>
    featureIdByKey(tx, CONTRACTS_PARTNER_CONFIRM_FEATURE),
  );
  if (!id) throw appError("NOT_FOUND");
  if (on) await grantEntitlement(c, id, tenantId);
  else await revokeEntitlement(c, id, tenantId);
  return readPartnerConfirm(c, tenantId, hub);
}
