// CR-130 pha 2 · L2 · ADR-0043 · `PartnerLinker` (cổng ghi community → SHT): liên kết tài khoản công ty đối tác (`ext_org_id`) với một
// đối tác SHT khi Admin chủ quản duyệt yêu cầu tham gia. MỘT câu: hàm cổng `contracts.community_link_partner` (contracts 0104,
// SECURITY DEFINER — role community không có quyền bảng `contracts.*`) chạy TRONG tx của người gọi ⇒ rollback chung với lượt duyệt.
// Tenant lấy từ GUC `app.tenant_id` của tx (không từ tham số); người xem là đối tác ⇒ hàm ném 42501 (chốt thứ hai sau kiểm `kind` ở đây).
// Khoá đối tác: Admin chọn tường minh (`partyKey`) hoặc luôn tạo mới — KHÔNG tự khớp theo tên (0105). Vai chỉ THÊM (`partner_roles` không xoá/sửa — thiết kế CR-130 §5.1).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PartnerLinker, PartnerLinkFailKind } from "../../community/public";

export class PartnerLinkForbidden extends Error {
  constructor() {
    super("PartnerLinker: user ngoài không được liên kết đối tác");
  }
}

/** Lỗi nghiệp vụ của hàm cổng (`kind` cùng tập `PARTNER_LINK_FAIL_KINDS` của community). */
export class PartnerLinkError extends Error {
  constructor(readonly kind: PartnerLinkFailKind) {
    super(`PartnerLinker: ${kind}`);
  }
}

const KIND_BY_MESSAGE: [string, PartnerLinkFailKind][] = [
  ["PARTNER_ALREADY_LINKED", "already_linked"],
  ["PARTNER_NOT_FOUND", "not_found"],
  ["ORG_NOT_IN_TENANT", "org_forbidden"],
];
const failOf = (e: unknown): PartnerLinkError | null => {
  const m = String((e as { cause?: { message?: string } }).cause?.message ?? "");
  const hit = KIND_BY_MESSAGE.find(([t]) => m.includes(t));
  return hit ? new PartnerLinkError(hit[1]) : null;
};

export function partnerLinker(): PartnerLinker {
  return {
    async linkInTx(tx, by, i) {
      if (by.kind === "external") throw new PartnerLinkForbidden();
      try {
        const [r] = await (tx as Tx).execute<{ o_party: string; o_linked: boolean }>(
          sql`select o_party, o_linked from contracts.community_link_partner(${i.extOrgId}::uuid, ${i.name},
            array(select jsonb_array_elements_text(${JSON.stringify(i.roles)}::jsonb)), ${i.partyKey ?? null}::text)`,
        );
        if (!r) throw new Error("PartnerLinker: hàm cổng không trả hàng");
        return { partyKey: r.o_party, linked: r.o_linked };
      } catch (e) {
        throw failOf(e) ?? e;
      }
    },
  };
}
