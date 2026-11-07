// CR-118 · manifest dữ liệu của app Sổ Hợp Tác (key catalog `contracts`). Đối tác KHÔNG bao giờ thấy app này.
import type { AppFactDecl, AppManifest } from "./manifest";

/** CR-122 · dữ kiện HĐ (cùng khoá với `APPROVAL_SLOT_FIELDS` cũ của gói ⇒ M1 backfill điều kiện không phải đổi tên). */
/** CR-122 · A · bản ghi của mọi sự kiện HĐ (= `ref`): mọi bước sau tự biết HĐ nào. */
const CONTRACT_RECORD = { key: "contract_id", label: { vi: "Hợp đồng", en: "Contract" } } as const;

const CONTRACT_FACTS: readonly AppFactDecl[] = [
  { key: "total_value", label: "Giá trị hợp đồng", type: "number" },
  {
    key: "deal",
    label: "Loại hợp đồng",
    type: "enum",
    options: [
      { value: "buy", label: "Mua hàng" },
      { value: "sell", label: "Bán hàng" },
      { value: "referral", label: "Giới thiệu" },
    ],
  },
  { key: "creator_department", label: "Phòng ban người tạo", type: "department" },
  { key: "new_partner", label: "Đối tác mới", type: "boolean" },
];

export const CONTRACTS_MANIFEST: AppManifest = {
  key: "contracts",
  name: "Sổ Hợp Tác",
  levelFeatures: {
    read: "contracts-read",
    write: "contracts-write",
    admin: "contracts-admin",
  },
  // CR-121 D-4 · `contracts-approval-engine` không còn là add-on: gán quy trình cho khe duyệt là đủ (Luật GỐC 3 — không thao tác ẩn).
  addons: [{ key: "han-muc-duyet", label: "Kiểm tra hạn mức duyệt" }],
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
        { key: "approve-flow", label: "Duyệt theo quy trình nhiều bước", level: "write" },
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
  // CR-120 §2 · ADR-0036: `contracts.intake` LUÔN BẬT (người dùng 2026-11-05). CR-121 D-4: `contracts.approval` cũng không cần add-on —
  // công ty được GÁN quy trình cho khe này thì duyệt theo quy trình (chưa gán ⇒ cách duyệt cũ, phần A dọn sau).
  slots: [
    {
      key: "contracts.approval",
      label: "Duyệt hợp đồng",
      level: "write",
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
  // CR-122 · flow-model.md mục C · FLOW2-FR-18.
  events: [
    {
      key: "contract.submitted",
      record: CONTRACT_RECORD,
      label: "Khi gửi duyệt hợp đồng",
      facts: CONTRACT_FACTS,
      outcomes: [
        { key: "approved", label: "Đã duyệt", effect: "Hợp đồng có hiệu lực và được khoá." },
        {
          key: "rejected",
          label: "Từ chối",
          effect: "Hợp đồng bị từ chối, người gửi được báo lý do.",
        },
        { key: "returned", label: "Trả lại", effect: "Hợp đồng về Nháp để người gửi sửa." },
      ],
      decides: true,
      required: true,
      defaultFlowKey: "hd-mac-dinh",
    },
    {
      key: "contract.uploaded",
      record: CONTRACT_RECORD,
      label: "Khi tải hợp đồng lên",
      facts: [
        { key: "file_type", label: "Loại tệp", type: "string" },
        { key: "uploader_department", label: "Phòng ban người tải", type: "department" },
      ],
      outcomes: [
        { key: "accepted", label: "Đã nhận", effect: "Hợp đồng được nhận vào sổ." },
        { key: "cancelled", label: "Huỷ", effect: "Bản tải lên bị huỷ." },
      ],
      // M1 · khe cũ chỉ chọn MỘT quy trình ⇒ flow có điều kiện (position = priority) đứng trước, mặc định (900+) đứng sau, chỉ một chạy.
      decides: true,
      required: false,
    },
    {
      key: "contract.approved",
      record: CONTRACT_RECORD,
      label: "Khi hợp đồng được duyệt",
      facts: CONTRACT_FACTS,
      outcomes: [{ key: "done", label: "Xong", effect: "Không đổi hợp đồng." }],
      decides: false,
      required: false,
    },
    // CR-122 · N1 · sự kiện ký số (E3: phong bì sang trạng thái cuối) — node Ký số chờ các sự kiện này; flow cũng có thể bắt đầu khi.
    ...(
      [
        ["esign.completed", "Khi hợp đồng ký xong"],
        ["esign.declined", "Khi đối tác từ chối ký"],
        ["esign.voided", "Khi phong bì ký bị huỷ"],
      ] as const
    ).map(([key, label]) => ({
      key,
      label,
      facts: CONTRACT_FACTS,
      outcomes: [{ key: "done", label: "Xong", effect: "Không đổi hợp đồng." }],
      decides: false,
      required: false,
    })),
  ],
  // CR-122 · N1 · FLOW2-FR-25 · Ký số = tool gói gửi ký + chờ sự kiện ký (E3: `also_events` + rẽ theo kết quả).
  nodes: [
    {
      key: "contracts.esign",
      label: { vi: "Ký số", en: "E-signature" },
      group: "sign",
      feature: "contracts-write",
      // E5 · nhà cung cấp, người ký công ty, đối tác ký, thứ tự, hạn, nhắc ghi ở `args` stage 0 (`EsignNodeConfig`, esign-node.ts).
      config: { stage: 0, options_path: "/pack/contracts/esign/options" },
      // CR-123 · FLOW3-FR-14 · Ký số là MỘT ô với 3 đầu ra: ký xong (đi tiếp) · từ chối / huỷ phong bì · hết hạn chờ.
      exits: [
        { key: "done", label: { vi: "Ký xong", en: "Signed" } },
        {
          key: "declined",
          label: { vi: "Từ chối", en: "Declined" },
          on: ["esign.declined", "esign.voided"],
        },
        { key: "expired", label: { vi: "Hết hạn", en: "Expired" }, on: ["timeout"] },
      ],
      stages: [
        {
          executor: { kind: "tool", tool_key: "contracts-esign-send", args: {} },
          real_action: true,
        },
        {
          executor: {
            kind: "wait_event",
            event: "esign.completed",
            also_events: ["esign.declined", "esign.voided"],
            timeout_h: 168,
          },
        },
      ],
      inputs: [
        { key: "contract_id", type: "string", required: true, label: CONTRACT_RECORD.label },
      ],
      outputs: [{ key: "event", type: "string", required: true }],
    },
  ],
};
