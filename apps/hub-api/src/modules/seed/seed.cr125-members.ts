// CR-126 · cr126-demo-purchase-seed · thành viên mẫu của nhóm duyệt (tách khỏi seed.cr125-config.ts cho đủ ≤ 400 dòng).
/**
 * «Quy trình mua hàng»: vai → nhóm duyệt (NGUỒN DUY NHẤT; e2e cr125-purchase-full import để dùng lại). Mỗi dòng «cùng duyệt» của mẫu
 * (3: truong-bo-phan + tai-chinh · 6: phap-che + ke-toan + truong-bo-phan · 10: ke-toan-truong + giam-doc) có ≥ 2 người khác nhau
 * vì giám đốc và kế toán là hai người.
 */
export const PURCHASE_ROLE_GROUPS: Record<
  "director" | "accounting" | "employee",
  readonly string[]
> = {
  director: [
    "nhan-vien-phong-ban",
    "truong-bo-phan",
    "mua-hang",
    "truong-mua-hang",
    "phap-che",
    "giam-doc",
    "kho",
  ],
  accounting: ["tai-chinh", "ke-toan", "ke-toan-truong", "thu-quy"],
  employee: ["nhan-vien-phong-ban"],
};

/** Thành viên mẫu của các nhóm «mua hàng» theo vai (username của công ty fixture); một người giữ nhiều nhóm của vai mình. */
function purchaseMembers(
  users: Record<keyof typeof PURCHASE_ROLE_GROUPS, string>,
): Record<string, readonly string[]> {
  const out: Record<string, string[]> = {};
  for (const [role, groups] of Object.entries(PURCHASE_ROLE_GROUPS))
    for (const g of groups)
      out[g] = [...(out[g] ?? []), users[role as keyof typeof PURCHASE_ROLE_GROUPS]];
  return out;
}

/** Thành viên mẫu theo username (không email). Người vắng ⇒ bỏ qua. */
export const TEMPLATE_GROUP_MEMBERS: Record<string, Record<string, readonly string[]>> = {
  evolu: {
    "truong-phong": ["thomas.tran"],
    "giam-doc": ["julian.bui"],
    "phong-kinh-doanh": ["vio.ngo"],
    ...purchaseMembers({ director: "julian.bui", accounting: "vio.ngo", employee: "thomas.tran" }),
  },
  demo: {
    "truong-phong": ["demo-editor"],
    "giam-doc": ["demo-owner"],
    "phong-kinh-doanh": ["demo-editor"],
    ...purchaseMembers({
      director: "demo-owner",
      accounting: "demo-viewer",
      employee: "demo-editor",
    }),
  },
};
