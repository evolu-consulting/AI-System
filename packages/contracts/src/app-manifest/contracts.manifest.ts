// CR-118 · manifest dữ liệu của app Sổ Hợp Tác (key catalog `contracts`). Đối tác KHÔNG bao giờ thấy app này.
import { MODULES } from "../modules/index.generated";
import { nodesOfApp } from "../modules/modules.rules";
import { CONTRACTS_PARTNER_CONFIRM_FEATURE } from "../tenants";
import type { AppFactDecl, AppManifest, AppSignalDecl } from "./manifest";

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

/** CR-127 · E1 · dữ kiện thêm của `contract.submitted` (spec §4.1): mức quan trọng, phòng người gửi, điểm đối tác, sản phẩm. `partner_new` của spec = `new_partner` đã có (một khái niệm một tên). */
const CONTRACT_SUBMITTED_FACTS: readonly AppFactDecl[] = [
  ...CONTRACT_FACTS,
  {
    key: "importance",
    label: "Mức quan trọng",
    type: "enum",
    options: [
      { value: "normal", label: "Thường" },
      { value: "important", label: "Quan trọng" },
      { value: "critical", label: "Rất quan trọng" },
    ],
  },
  { key: "submitter_group_ids", label: "Phòng của người gửi", type: "department" },
  { key: "partner_score", label: "Điểm đối tác", type: "number" },
  { key: "product_ids", label: "Sản phẩm trong hợp đồng", type: "string" },
];

/** CR-127 · E1 · mốc thực hiện: bản ghi của sự kiện `milestone.*` (= `ref`). */
const MILESTONE_RECORD = { key: "obligation_id", label: { vi: "Mốc", en: "Milestone" } } as const;
/** Dữ kiện của sự kiện theo lịch mốc: `days` = N đặt trong quy trình (bắt buộc với `schedule`). */
const MILESTONE_FACTS: readonly AppFactDecl[] = [
  { key: "days", label: "Số ngày", type: "number" },
  { key: "owner", label: "Người phụ trách hợp đồng", type: "string" },
  {
    key: "kind",
    label: "Loại mốc",
    type: "enum",
    options: [
      { value: "delivery", label: "Giao hàng" },
      { value: "receive", label: "Nhận hàng" },
      { value: "payment", label: "Thu / chi tiền" },
      { value: "other", label: "Khác" },
    ],
  },
];

/**
 * CR-127 · E1 · tín hiệu phiên ký chung (spec §2.4) — khoá có HAI dấu chấm nên là `signals` (chỉ node chờ dùng), không phải `events`.
 * P2: nối vào `signals` của manifest những tín hiệu có node chờ (`SIGN_SESSION_WAITED` — node «Đồng ý ký cùng lúc»); `signed`/`done`/`cancelled`
 * chưa có node chờ ⇒ vẫn bắn (bộ chuyển) nhưng chưa khai (`MOD_SIGNAL_ORPHAN`) — khai khi có node dùng.
 */
export const SIGN_SESSION_SIGNALS: readonly AppSignalDecl[] = [
  { key: "sign.session.accepted", label: "Khi đối tác đồng ý ký cùng lúc" },
  { key: "sign.session.declined", label: "Khi đối tác từ chối ký cùng lúc" },
  { key: "sign.session.signed", label: "Khi một bên ký xong" },
  { key: "sign.session.done", label: "Khi hai bên ký xong" },
  { key: "sign.session.cancelled", label: "Khi phiên ký bị huỷ" },
  { key: "sign.session.expired", label: "Khi phiên ký quá hạn" },
];

/** CR-127 · P2 · tín hiệu phiên ký chung đã có node chờ (node «Đồng ý ký cùng lúc»: accepted / declined / expired). */
export const SIGN_SESSION_WAITED = new Set([
  "sign.session.accepted",
  "sign.session.declined",
  "sign.session.expired",
]);

export const CONTRACTS_MANIFEST: AppManifest = {
  key: "contracts",
  name: "Sổ Hợp Tác",
  levelFeatures: {
    read: "contracts-read",
    write: "contracts-write",
    admin: "contracts-admin",
  },
  // CR-121 D-4 · `contracts-approval-engine` không còn là add-on: gán quy trình cho khe duyệt là đủ (Luật GỐC 3 — không thao tác ẩn).
  addons: [
    { key: "han-muc-duyet", label: "Kiểm tra hạn mức duyệt" },
    { key: CONTRACTS_PARTNER_CONFIRM_FEATURE, label: "Gửi hợp đồng cho đối tác xác nhận" },
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
  // CR-120 §2 · ADR-0036: `contracts.intake` LUÔN BẬT (người dùng 2026-11-05). CR-127 Z3c: khe `contracts.approval` đã gỡ — duyệt HĐ = flow
  // công ty `contract.submitted` (company_flows), không còn khe/quy trình thư viện soạn riêng.
  slots: [
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
      facts: CONTRACT_SUBMITTED_FACTS,
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
    // CR-124 · q3 · FLOW4-FR-08/11 · bên NHẬN: HĐ đối tác gửi tới (bản ghi riêng `source='partner_inbox'`) ⇒ flow nhận của công ty chạy.
    // Kết thúc của flow nhận tự thành câu trả lời gửi về bên gửi (OutcomeHandler ⇒ `hub.partner_reply`), không node «Trả lời» riêng.
    // FLOW4-FR-10: bật tính năng ⇒ luôn có ≥ 1 flow nhận bật không điều kiện; mẫu mặc định «Nhận HĐ thường» seed ở hub 0121.
    {
      key: "contract.received",
      record: CONTRACT_RECORD,
      label: "Khi nhận HĐ từ đối tác",
      facts: [
        { key: "total_value", label: "Giá trị hợp đồng", type: "number" },
        {
          key: "importance",
          label: "Mức quan trọng",
          type: "enum",
          options: [
            { value: "normal", label: "Thường" },
            { value: "important", label: "Quan trọng" },
            { value: "critical", label: "Rất quan trọng" },
          ],
        },
        { key: "contract_type", label: "Loại hợp đồng", type: "string" },
        { key: "new_partner", label: "Đối tác mới", type: "boolean" },
        { key: "sender_verified", label: "Bên gửi đã xác minh", type: "boolean" },
        { key: "sign_together", label: "Bên gửi đề nghị ký cùng lúc", type: "boolean" },
      ],
      outcomes: [
        { key: "confirmed", label: "Đồng ý", effect: "Bên gửi được báo đã xác nhận." },
        {
          key: "returned",
          label: "Trả lại",
          effect: "Bên gửi được báo trả lại kèm lý do để sửa rồi gửi lại.",
        },
        { key: "declined", label: "Từ chối", effect: "Bên gửi được báo từ chối kèm lý do." },
      ],
      decides: true,
      required: true,
      defaultFlowKey: "hd-nhan-thuong",
    },
    // CR-127 · E1 · sự kiện theo lịch (vòng `schedule-sweep`, E6; nguồn dữ liệu K6/X4/X5) + sự kiện giao dịch / thay đổi thực hiện (X2/X3).
    {
      key: "contract.expiring",
      record: CONTRACT_RECORD,
      label: "Khi hợp đồng sắp hết hạn",
      schedule: { param: { key: "days", min: 1, max: 365, default: 30 } },
      facts: [
        { key: "days", label: "Số ngày tới hết hạn", type: "number" },
        { key: "total_value", label: "Giá trị hợp đồng", type: "number" },
        { key: "deal", label: "Loại hợp đồng", type: "string" },
      ],
      outcomes: [
        {
          key: "renew",
          label: "Gia hạn",
          effect: 'Tạo hợp đồng gia hạn (nháp); hợp đồng cũ ghi "Đã gia hạn".',
        },
        { key: "terminate", label: "Chấm dứt", effect: 'Hợp đồng ghi "Đã chấm dứt".' },
        {
          key: "let_expire",
          label: "Để hết hạn",
          effect: "Hợp đồng tự hết hạn, không làm gì thêm.",
        },
      ],
      decides: true,
      required: false,
    },
    {
      key: "milestone.overdue",
      record: MILESTONE_RECORD,
      label: "Khi mốc quá hạn",
      schedule: { param: { key: "days", min: 1, max: 365, default: 1 } },
      facts: [...MILESTONE_FACTS, { key: "days_late", label: "Số ngày đã trễ", type: "number" }],
      outcomes: [{ key: "done", label: "Xong", effect: "Không đổi mốc." }],
      decides: false,
      required: false,
    },
    {
      key: "milestone.due",
      record: MILESTONE_RECORD,
      label: "Khi mốc sắp tới hạn",
      schedule: { param: { key: "days", min: 1, max: 365, default: 3 } },
      facts: [
        ...MILESTONE_FACTS,
        {
          key: "contract_owner_group_id",
          label: "Phòng của người phụ trách hợp đồng",
          type: "department",
        },
      ],
      outcomes: [{ key: "done", label: "Xong", effect: "Không đổi mốc." }],
      decides: false,
      required: false,
    },
    {
      key: "transaction.saved",
      record: { key: "transaction_id", label: { vi: "Giao dịch", en: "Transaction" } },
      label: "Khi lưu giao dịch gắn hợp đồng",
      facts: [
        { key: "deal_value", label: "Giá trị giao dịch", type: "number" },
        { key: "linked", label: "Có gắn hợp đồng", type: "boolean" },
      ],
      outcomes: [
        { key: "approved", label: "Đã duyệt", effect: "Giao dịch được ghi vào mốc của hợp đồng." },
        {
          key: "rejected",
          label: "Từ chối",
          effect: "Giao dịch không được ghi; người tạo được báo lý do.",
        },
      ],
      decides: true,
      required: false,
    },
    {
      key: "fulfilment.change_requested",
      record: { key: "request_id", label: { vi: "Yêu cầu thay đổi", en: "Change request" } },
      label: "Khi có yêu cầu thay đổi thực hiện",
      facts: [
        {
          key: "kind",
          label: "Loại yêu cầu",
          type: "enum",
          options: [
            { value: "hold", label: "Tạm khoá" },
            { value: "postpone", label: "Dời hạn" },
            { value: "split", label: "Tách mốc" },
            { value: "waive", label: "Miễn phạt" },
          ],
        },
        { key: "postpone_days", label: "Số ngày dời", type: "number" },
        { key: "waive_amount", label: "Số tiền miễn", type: "number" },
      ],
      outcomes: [
        { key: "approved", label: "Đã duyệt", effect: "Thay đổi được áp vào mốc." },
        {
          key: "rejected",
          label: "Từ chối",
          effect: "Mốc giữ nguyên; người yêu cầu được báo lý do.",
        },
      ],
      decides: true,
      required: false,
    },
  ],
  // CR-122 · N1 · tín hiệu ký số (E3: phong bì sang trạng thái cuối) — CHỈ node Ký số / bước chờ dùng (`wait_event`); CR-125 m2: không còn là
  // sự kiện bắt đầu flow (không bộ đọc dữ kiện / xử lý kết quả ở máy chủ; không có def nào bắt đầu bằng chúng).
  signals: [
    { key: "esign.completed", label: "Khi hợp đồng ký xong", pick: true },
    { key: "esign.declined", label: "Khi đối tác từ chối ký", pick: true },
    { key: "esign.voided", label: "Khi phong bì ký bị huỷ", pick: true },
    // CR-124 · q3 · trả lời của đối tác (nền tảng / email / ghi nhận thủ công) — CHỈ node «Gửi đối tác xác nhận» chờ.
    { key: "partner.confirmed", label: "Khi đối tác xác nhận" },
    { key: "partner.returned", label: "Khi đối tác trả lại" },
    { key: "partner.declined", label: "Khi đối tác từ chối" },
    ...SIGN_SESSION_SIGNALS.filter((x) => SIGN_SESSION_WAITED.has(x.key)),
  ],
  // CR-125 · m1 · node của app khai ở `modules/contracts` (sổ `MODULES`, MỘT nguồn); đây là bản đọc lại.
  nodes: nodesOfApp(MODULES, "contracts"),
};
