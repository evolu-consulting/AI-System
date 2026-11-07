// CR-124 · q3 · FLOW4-FR-01/02/15 · khai báo node «Gửi đối tác xác nhận» (module:new, khuôn CR-125). MỘT node, đầu ra theo kết quả nghiệp vụ:
// Đã xác nhận · Trả lại sửa · Từ chối · Hết hạn. Hai stage: tool gửi (real_action) + chờ tín hiệu `partner.*` (máy chủ bắn khi bên nhận trả lời
// / người phụ trách ghi nhận thủ công). Không executor mới. Binding máy chủ: packs/contracts/nodes/partner-send/binding.ts.
// CR-124 FLOW4-FR-01: node đứng SAU Duyệt (gửi ra ngoài công ty chỉ khi HĐ đã được duyệt) ⇒ `requires: { before: "approval" }` (CR-125 m5, cùng Ký số).
import type { FeatureNodeDecl } from "../../types";
import { PARTNER_REPLY_DAYS_DEFAULT, PartnerSendConfigSchema } from "./config";

export const PARTNER_SEND_TOOL = "contracts-partner-send";

export const PARTNER_SEND_NODE: FeatureNodeDecl = {
  key: "contracts.partner-send",
  label: { vi: "Gửi đối tác xác nhận", en: "Send to partner for confirmation" },
  group: "partner",
  kind: "app",
  feature: "contracts-partner-confirm",
  requires: { before: "approval" },
  configPort: {
    schema: PartnerSendConfigSchema,
    widgets: { importance: "enum", reply_days: "days", message: "longtext" },
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
  stages: [
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
  ],
  // CR-125 · m8 · cổng ra đủ, nhãn nghiệp vụ. `event` (xác nhận / trả lại / từ chối / hết hạn) do stage chờ ghi = «partner_outcome».
  // `partner_reason` (lý do đối tác nêu) và `round` (lần gửi) chưa vào dữ liệu lượt chạy ⇒ `pending` tới khi lát Opus làm.
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
      pending: true,
      label: { vi: "Lý do đối tác nêu", en: "Partner reason" },
    },
    {
      key: "round",
      type: "number",
      required: false,
      pending: true,
      label: { vi: "Lần gửi thứ", en: "Send round" },
    },
  ],
};
