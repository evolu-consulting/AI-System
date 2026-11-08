// CR-113 · cr125-fix-owner-override · "Toàn quyền duyệt thay": luật DUY NHẤT gắn Group Toàn quyền của app vào bước duyệt
// (`after.also_group_ids`), dùng chung cho đường khe (compileDef của gói HĐ) và flow theo sự kiện (mở lượt từ company_flows).
// Thành viên Group Toàn quyền quyết được mọi bước duyệt; engine đánh dấu `override` ⇒ thẻ ghi "duyệt thay" + audit.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Group "cũng quyết" của một bước duyệt = Group Toàn quyền (bỏ trùng), trừ chính Group gắn task. Bước có người duyệt cụ thể
 * (`hasApprover`) ⇒ giữ cả Group gắn task (cửa người cụ thể chặn phía Group chính, Toàn quyền vẫn quyết qua đường này).
 */
export function ownerAlsoGroups(
  owners: readonly string[],
  taskGroup: string | null,
  hasApprover = false,
): string[] {
  const u = [...new Set(owners)];
  return hasApprover ? u : u.filter((g) => g !== taskGroup);
}

/** Gắn Group Toàn quyền vào MỌI stage duyệt (`after.kind = review`), gộp với `also_group_ids` sẵn có; stage khác giữ nguyên. */
export function withOwnerOverride(
  stages: readonly unknown[],
  owners: readonly string[],
): unknown[] {
  if (owners.length === 0) return [...stages];
  return stages.map((s) => {
    if (!isObj(s) || !isObj(s.after) || s.after.kind !== "review") return s;
    const a = s.after;
    const had = Array.isArray(a.also_group_ids)
      ? a.also_group_ids.filter((g): g is string => typeof g === "string")
      : [];
    const group = typeof a.group_id === "string" ? a.group_id : null;
    const add = ownerAlsoGroups(owners, group, typeof a.approver_user_id === "string");
    const also = [...new Set([...had, ...add])];
    return also.length ? { ...s, after: { ...a, also_group_ids: also } } : s;
  });
}
