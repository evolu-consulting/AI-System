// CR-102a · ADM-FR-74 · com-c1-ext-identity: cổng DUY NHẤT trả lời "user này thuộc công ty đối tác nào".
// Hiện tại: đối tác = user `kind='external'` trong tenant chủ quản (`admin.users.external_org_id`). Sau này chuyển mỗi đối
// tác thành tenant riêng ⇒ chỉ thay adapter (`adapters/ext-org.pg.ts`), không sửa gói. Lớp 2 — chỉ kiểu.
// Người gọi hiện tại (chính mình) đã có `userKind`/`extOrgId` trên `PackWho` (từ claim JWT, khớp DB — kind bất biến); cổng
// này dùng khi cần identity của user KHÁC (tác giả bài, thành viên luồng…) hoặc cần đối chiếu lại DB.

export type UserKind = "internal" | "external";
export type ExtIdentity = { kind: UserKind; extOrgId: string | null };
export const INTERNAL: ExtIdentity = Object.freeze({ kind: "internal", extOrgId: null });

/** `true` ⇔ đối tác. Vắng `userKind` (token/PackWho cũ) ⇒ nội bộ. */
export const isExternal = (w: { userKind?: UserKind }): boolean => w.userKind === "external";

export type ExternalOrgResolver = {
  /**
   * Identity của các user trong MỘT tenant (theo tập, một câu). User không thuộc tenant / không tồn tại ⇒ vắng trong Map
   * (không bao giờ lộ user tenant khác).
   */
  identities(
    tenantId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, ExtIdentity>>;
  /** Tên công ty đối tác (còn active hay không) trong tenant; id lạ / tenant khác ⇒ vắng. */
  orgNames(
    tenantId: string,
    orgIds: readonly string[],
  ): Promise<ReadonlyMap<string, { name: string; active: boolean }>>;
};
