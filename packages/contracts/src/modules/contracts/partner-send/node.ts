// CR-124 · q3 · FLOW4-FR-01/02/15 · khai báo node «Gửi đối tác xác nhận» (module:new, khuôn CR-125). MỘT node, đầu ra theo kết quả nghiệp vụ:
// Đã xác nhận · Trả lại sửa · Từ chối · Hết hạn. Hai stage: tool gửi (real_action) + chờ tín hiệu `partner.*` (máy chủ bắn khi bên nhận trả lời
// / người phụ trách ghi nhận thủ công). Không executor mới. Binding máy chủ: packs/contracts/nodes/partner-send/binding.ts.
// CR-124 FLOW4-FR-01: node đứng SAU Duyệt (gửi ra ngoài công ty chỉ khi HĐ đã được duyệt) ⇒ `requires: { before: "approval" }` (CR-125 m5, cùng Ký số).
import { CONTRACTS_PARTNER_CONFIRM_FEATURE } from "../../../tenants";
import type { FeatureNodeDecl } from "../../types";
import { PARTNER_REPLY_DAYS_DEFAULT, PartnerSendConfigSchema } from "./config";

export const PARTNER_SEND_TOOL = "contracts-partner-send";

export const PARTNER_SEND_NODE: FeatureNodeDecl = {
  key: "contracts.partner-send",
  label: { vi: "Gửi đối tác xác nhận", en: "Send to partner for confirmation" },
  group: "partner",
  kind: "app",
  feature: CONTRACTS_PARTNER_CONFIRM_FEATURE,
  // CR-125 · x9: bước nghiệp vụ ⇒ nhóm nghiệp vụ của menu "+" (sau Ký số); chỉ hiện khi công ty có tính năng trên (palette lọc theo `feature`).
  menu: { section: "business", order: 35 },
  requires: { before: "approval" },
  configPort: {
    schema: PartnerSendConfigSchema,
    widgets: {
      importance: "enum",
      reply_days: "days",
      message: "longtext",
      assignee_group: "group",
    },
  },
  exits: [
    { key: "confirmed", label: { vi: "Đã xác nhận", en: "Confirmed" } },
    {
      key: "returned",
      label: { vi: "Trả lại sửa", en: "Returned for changes" },
      on: ["partner.returned"],
    },
    { key: "declined", label: { vi: "Từ chối", en: "Declined" }, on: ["partner.declined"] },
    { key: "expired", label: { vi: "Hết hạn", en: "Expired" }, on: ["timeout"] },
  ],
  // CR-126 · stage người làm TRƯỚC khi gửi: nhóm `assignee_group` (cấu hình node) chọn đối tác + email nhận; máy chủ điền sẵn từ HĐ
  // (`FormPrefill`, nguồn `company_partners`). Giá trị chọn vào tool qua đầu vào `partner_tax_code` / `partner_email` (fieldArgSources).
  stages: [
    {
      executor: {
        kind: "form",
        fields: [
          {
            key: "partner_tax_code",
            label: "Đối tác",
            type: "select",
            required: true,
            options: [],
            options_from: "company_partners",
          },
          {
            key: "partner_email",
            label: "Email người nhận",
            type: "text",
            required: true,
            max_len: 254,
            format: "email",
          },
        ],
      },
    },
    {
      executor: { kind: "tool", tool_key: PARTNER_SEND_TOOL, args: {} },
      real_action: true,
    },
    {
      executor: {
        kind: "wait_event",
        event: "partner.confirmed",
        also_events: ["partner.returned", "partner.declined"],
        timeout_h: PARTNER_REPLY_DAYS_DEFAULT * 24,
      },
    },
  ],
  inputs: [
    {
      key: "contract_id",
      type: "string",
      required: true,
      label: { vi: "Hợp đồng", en: "Contract" },
      fix: { vi: "thêm bước Tải hợp đồng trước.", en: "add an Upload contract step first." },
    },
    // CR-126 · do stage «Chọn đối tác & người nhận» của chính node ghi (trường form cùng khoá).
    {
      key: "partner_tax_code",
      type: "string",
      required: false,
      label: { vi: "Đối tác (mã số thuế)", en: "Partner (tax code)" },
    },
    {
      key: "partner_email",
      type: "string",
      required: false,
      label: { vi: "Email người nhận", en: "Recipient email" },
    },
  ],
  // CR-125 · m8 · cổng ra đủ, nhãn nghiệp vụ. `event` (xác nhận / trả lại / từ chối / hết hạn) do stage chờ ghi = «partner_outcome».
  // CR-125 · m9 · `partner_reason` (lý do đối tác nêu) và `round` (lần gửi) kèm tín hiệu trả lời, ghi cùng output stage chờ.
  outputs: [
    {
      key: "event",
      type: "string",
      required: true,
      label: { vi: "Phản hồi của đối tác", en: "Partner reply" },
    },
    {
      key: "partner_reason",
      type: "string",
      required: false,
      label: { vi: "Lý do đối tác nêu", en: "Partner reason" },
    },
    {
      key: "round",
      type: "number",
      required: false,
      label: { vi: "Lần gửi thứ", en: "Send round" },
    },
  ],
};
