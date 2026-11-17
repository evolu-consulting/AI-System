// CR-181 · lát s2 · «quản trị công ty» của chữ ký nội bộ (Q15, BR-G1) = tenant_admin ∨ người có quyền `admin` gói Sổ Hợp Tác (`contracts`).
// Lõi chỉ chạm gói qua cổng `packs/kit/public` (như `my-history`): quyền gói người gọi lấy từ `PackAccessView` (cache, 0 SQL khi nóng).
// Người nhận chuông «xin đổi chữ ký» = cùng tập quản trị đó, MỘT câu SQL (khuôn `kit/adapters/pack-hosts.ts`, nhóm theo việc `admin`).
import { packFeatureKey } from "@ai/contracts/packs";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { PackAccessView } from "../../packs/kit/public";
import { checkPackAccess, packAccessInput } from "../../packs/kit/public";
import type { CompanyAdminPort } from "../application/ports";
import { isCompanyAdmin } from "../domain/signature.rules";

/** Gói chủ của quyền quản trị chữ ký (Q15). */
export const SIGNATURE_ADMIN_PACK = "contracts";
export const BELL_RECIPIENTS_MAX = 200;

export function companyAdminPort(db: Db, view: PackAccessView): CompanyAdminPort {
  return {
    async isAdmin(user) {
      if (user.role === "tenant_admin") return true; // không cần tra gói
      if (user.role === "platform_admin") return false;
      const i = await packAccessInput(view, SIGNATURE_ADMIN_PACK, user);
      return isCompanyAdmin(
        user.role,
        checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok",
      );
    },
    async recipients(tenantId, exceptUserId) {
      await view.adminSettled?.();
      const cat = await view.catalog();
      const f = cat.features.find((x) => x.key === packFeatureKey(SIGNATURE_ADMIN_PACK, "admin"));
      const groups = f ? (cat.grantGroups.get(`${tenantId}:${f.id}`) ?? []) : [];
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ id: string }>(sql`select u.id::text as id from admin.users u
          where u.tenant_id = ${tenantId}::uuid and u.kind = 'internal' and u.active and not u.locked_by_tenant
            and u.id <> ${exceptUserId}::uuid
            and (u.role = 'tenant_admin' or exists (select 1 from admin.group_members gm
              where gm.tenant_id = u.tenant_id and gm.user_id = u.id
                and gm.group_id = any(array(select jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb))::uuid[])))
          order by u.id limit ${BELL_RECIPIENTS_MAX}`),
      );
      return rows.map((r) => r.id);
    },
  };
}
