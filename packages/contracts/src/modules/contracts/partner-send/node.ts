// CR-124 · q3 · FLOW4-FR-01/02/15 · khai báo node «Gửi đối tác xác nhận» (module:new, khuôn CR-125). MỘT node, đầu ra theo kết quả nghiệp vụ:
// Đã xác nhận · Trả lại sửa · Từ chối · Hết hạn. Hai stage: tool gửi (real_action) + chờ tín hiệu `partner.*` (máy chủ bắn khi bên nhận trả lời
// / người phụ trách ghi nhận thủ công). Không executor mới. Binding máy chủ: packs/contracts/nodes/partner-send/binding.ts.
// TODO(CR-125 m5): khai `requires: { before: "approval" }` khi trường tiền điều kiện của node có ở `AppNodeDecl` — KHÔNG cứng luật ở đây.
// TODO(CR-124 q4): nhóm «Đối tác» (NODE_GROUPS chưa có) · khoá tính năng `contracts-partner-confirm` · panel riêng · `config.options_path`.
import type { FeatureNodeDecl } from "../../types";
import { PARTNER_REPLY_DAYS_DEFAULT, PartnerSendConfigSchema } from "./config";

export const PARTNER_SEND_TOOL = "contracts-partner-send";

export const PARTNER_SEND_NODE: FeatureNodeDecl = {
  key: "contracts.partner-send",
  label: { vi: "Gửi đối tác xác nhận", en: "Send to partner for confirmation" },
  group: "message",
  kind: "app",
  feature: "contracts-write",
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
    },
  ],
  outputs: [{ key: "event", type: "string", required: true }],
};
