// CR-140 · khai báo node «Ghi thanh toán vào HĐ». Đặt SAU bước thủ quỹ xác nhận «Đã chi» của đơn mua không có đợt thanh toán: ghi một dòng
// «đã trả» vào sổ thanh toán của HĐ (idempotent theo lượt). HĐ có đợt thanh toán đang mở ⇒ để node «Xác nhận mốc» lo (không ghi đôi).
// Binding máy chủ: hub-api packs/contracts/nodes/record-payment/binding.ts.
import type { FeatureNodeDecl } from "../../types";
import { RECORD_PAYMENT_TOOL, RecordPaymentConfigSchema } from "./config";

export const RECORD_PAYMENT_NODE: FeatureNodeDecl = {
  key: "contracts.record-payment",
  label: { vi: "Ghi thanh toán vào HĐ", en: "Record payment on contract" },
  group: "content",
  kind: "app",
  feature: "contracts-write",
  menu: { section: "business", order: 45 },
  configPort: {
    schema: RecordPaymentConfigSchema,
    widgets: { amount: "money", paid_at: "date" },
  },
  // Ghi sổ nội bộ của công ty (không gửi ra ngoài) ⇒ không `real_action`.
  stages: [{ executor: { kind: "tool", tool_key: RECORD_PAYMENT_TOOL, args: {} } }],
  inputs: [
    {
      key: "contract_id",
      type: "string",
      required: false,
      label: { vi: "Hợp đồng", en: "Contract" },
    },
    {
      key: "amount",
      type: "number",
      required: false,
      label: { vi: "Số tiền đã chi", en: "Amount paid" },
    },
    {
      key: "paid_at",
      type: "string",
      required: false,
      label: { vi: "Ngày chi", en: "Payment date" },
    },
  ],
  outputs: [
    {
      key: "status",
      type: "string",
      required: false,
      label: { vi: "Kết quả ghi sổ", en: "Ledger result" },
    },
  ],
};
