// CR-121 D-0 · danh mục của khe `contracts.approval` cho trình sửa quy trình: trường nghiệp vụ dùng trong điều kiện bước và loại
// node = đúng các tính năng gói đã chạy được (`compileSlotStages`). Thuần, lớp 1 (chỉ builtin) — hình khớp `SlotField`/`SlotNode`
// của kit (`approval.mount.ts` gán vào `SlotSpec`, tsc kiểm). Hạn thanh toán: KHÔNG có trường mức HĐ (chỉ `obligations.due_date`
// nhiều dòng mỗi HĐ) ⇒ chưa khai. Node `notify` / `wait_until`: gói chưa có loại bước ⇒ chưa khai (xem docs/specs/cr121-d/spec.md).

export const APPROVAL_SLOT_FIELDS = [
  {
    key: "total_value",
    label: "Giá trị hợp đồng",
    type: "number",
    ops: ["ge", "gt", "le", "lt"],
  },
  {
    key: "deal",
    label: "Loại hợp đồng",
    type: "enum",
    ops: ["in"],
    options: [
      { value: "buy", label: "Mua hàng" },
      { value: "sell", label: "Bán hàng" },
      { value: "referral", label: "Giới thiệu" },
    ],
  },
  {
    key: "creator_department",
    label: "Phòng ban người tạo",
    type: "department",
    ops: ["in"],
  },
  { key: "new_partner", label: "Đối tác mới", type: "boolean", ops: ["is"] },
] as const;

export const APPROVAL_SLOT_NODES = [
  { kind: "review", label: "Duyệt", icon: "check-circle" },
  { kind: "dify", label: "Trợ lý AI", icon: "sparkles" },
  { kind: "esign", label: "Ký số", icon: "signature" },
] as const;
