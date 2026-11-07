// CR-124 · q3 · khuôn CR-125 · binding máy chủ của node «contracts.partner-send»: tool gửi + cổng cấu hình (= schema args tool, MỘT nguồn) trong sổ
// module. `mountPartnerSend` (partner-mailbox.mount.ts) đăng ký tool vào registry tool gói rồi gọi file này; `moduleRegistry.verify` kiểm lúc khởi động.
import { MODULES } from "@ai/contracts/modules";
import type { NodeBinding } from "../../../kit/public";
import { PARTNER_TOOL_KEY } from "../../adapters/partner-send.tool";

export const PARTNER_SEND_KEY = "contracts.partner-send";

/** Schema args của tool = đúng `configPort.schema` của khai báo (cùng tham chiếu ⇒ không `MOD_PORT_MISMATCH`). */
export const partnerSendBinding = (): NodeBinding => {
  const decl = MODULES.flatMap((m) => m.nodes).find((n) => n.key === PARTNER_SEND_KEY);
  const schema = decl?.configPort?.schema;
  return {
    key: PARTNER_SEND_KEY,
    tools: [PARTNER_TOOL_KEY],
    ...(schema ? { argsSchema: schema } : {}),
  };
};
