// CR-118 · manifest dữ liệu của app Sổ Hợp Tác (key catalog `contracts`). Đối tác KHÔNG bao giờ thấy app này.
import type { AppManifest } from "./manifest";

export const CONTRACTS_MANIFEST: AppManifest = {
  key: "contracts",
  name: "Sổ Hợp Tác",
  levelFeatures: {
    read: "contracts-read",
    write: "contracts-write",
    admin: "contracts-admin",
  },
  addons: [
    { key: "contracts-approval-engine", label: "Duyệt hợp đồng bằng quy trình" },
    { key: "han-muc-duyet", label: "Kiểm tra hạn mức duyệt" },
  ],
  nav: [
    { key: "overview", labelKey: "contracts.nav.overview", label: "Tổng quan", level: "read" },
    {
      key: "contracts",
      labelKey: "contracts.nav.contracts",
      label: "Hợp đồng",
      level: "read",
      actions: [
        { key: "view", label: "Xem hợp đồng", level: "read" },
        { key: "create", label: "Tạo và sửa hợp đồng", level: "write" },
        { key: "submit", label: "Gửi duyệt hợp đồng", level: "write" },
        {
          key: "approve-flow",
          label: "Duyệt theo quy trình nhiều bước",
          level: "write",
          addon: "contracts-approval-engine",
        },
      ],
    },
    { key: "partners", labelKey: "contracts.nav.partners", label: "Đối tác", level: "read" },
    {
      key: "products",
      labelKey: "contracts.nav.products",
      label: "Sản phẩm & Giá",
      level: "read",
    },
    {
      key: "settings",
      labelKey: "contracts.nav.settings",
      label: "Cài đặt",
      level: "write",
      audience: "company_admin",
      actions: [
        {
          key: "templates",
          label: "Quản lý mẫu hợp đồng",
          level: "admin",
          audience: "company_admin",
        },
        {
          key: "members",
          label: "Thành viên và phòng ban",
          level: "admin",
          audience: "company_admin",
        },
      ],
    },
  ],
  // CR-120 §2 · ADR-0036: `contracts.intake` LUÔN BẬT (người dùng 2026-11-05); `contracts.approval` theo add-on engine duyệt.
  slots: [
    {
      key: "contracts.approval",
      label: "Duyệt hợp đồng",
      level: "write",
      addon: "contracts-approval-engine",
      purpose: "Duyệt hợp đồng qua các phòng ban theo luồng công ty cài đặt trước khi ký.",
      defaultDefKey: "hd-mac-dinh",
      allowedKinds: ["review", "dify", "esign", "form", "wait", "system"],
      trigger: "contract.submitted",
    },
    {
      key: "contracts.intake",
      label: "Tiếp nhận hợp đồng",
      level: "write",
      purpose:
        "Nhận hợp đồng tải lên rồi chuyển trưởng phòng của người tải xem lại (hoặc cho qua).",
      defaultDefKey: "hd-tiep-nhan",
      allowedKinds: ["form", "review", "dify", "esign", "wait", "system"],
      trigger: "contract.uploaded",
    },
  ],
};
