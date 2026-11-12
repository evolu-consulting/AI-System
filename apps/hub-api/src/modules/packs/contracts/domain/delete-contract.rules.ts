// CR-127 · Z8: ai được xoá một HĐ. Thuần, không đọc DB. Một nguồn: dùng cho `can.delete` của chi tiết VÀ guard của DELETE / xem trước.
// HĐ `draft`: quản trị gói, hoặc (có quyền ghi gói) người tạo / người phụ trách. HĐ khác draft: chỉ quản trị gói (luật V2-M).
export type DeleteFacts = { status: string; created_by: string; owner_user_id: string | null };
/** Vai của người gọi trong gói (theo nhóm được cấp quyền `admin` / `write`). */
export type DeleteRole = { admin: boolean; write: boolean };

export function canDeleteContract(
  f: DeleteFacts,
  actor: string | null | undefined,
  role: DeleteRole,
): boolean {
  if (role.admin) return true;
  if (f.status !== "draft" || !role.write || !actor) return false;
  return actor === f.created_by || actor === f.owner_user_id;
}

/** CR-128 L1: ngữ cảnh tính `can_delete` cho từng hàng danh sách (người gọi + vai, tính một lần mỗi lệnh). */
export type ListDeleteCtx = { actor: string; role: DeleteRole };
