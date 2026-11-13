// CR-140 · binding máy chủ của node «contracts.record-payment»: tool ghi thanh toán + cổng cấu hình (= schema args tool, MỘT nguồn) trong sổ
// module. `mountRecordPayment` (record-payment.mount.ts) đăng ký tool rồi gọi file này; `moduleRegistry.verify` kiểm lúc khởi động.
import { MODULES, RECORD_PAYMENT_TOOL } from "@ai/contracts/modules";
import type { NodeBinding } from "../../../kit/public";

export const RECORD_PAYMENT_KEY = "contracts.record-payment";

export const recordPaymentBinding = (): NodeBinding => {
  const decl = MODULES.flatMap((m) => m.nodes).find((n) => n.key === RECORD_PAYMENT_KEY);
  const schema = decl?.configPort?.schema;
  return {
    key: RECORD_PAYMENT_KEY,
    tools: [RECORD_PAYMENT_TOOL],
    // Tool trả `status` (recorded / exists / skipped / has_schedule) — cùng khoá với đầu ra khai báo.
    outputs: ["status"],
    ...(schema ? { argsSchema: schema } : {}),
  };
};
