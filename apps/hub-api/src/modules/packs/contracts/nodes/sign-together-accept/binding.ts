// CR-127 · P2 · binding máy chủ của node «contracts.sign-together-accept» (Đồng ý ký cùng lúc). Không tool: stage chờ `sign.session.*` do bộ chuyển
// hộp thư bắn (`onSignSessions`, partner-mailbox.mount.ts). `mountPartnerSend` gọi file này; `moduleRegistry.verify` kiểm lúc khởi động.
import type { NodeBinding } from "../../../kit/public";

export const SIGN_TOGETHER_ACCEPT_BINDING_KEY = "contracts.sign-together-accept";

export const signTogetherAcceptBinding = (): NodeBinding => ({
  key: SIGN_TOGETHER_ACCEPT_BINDING_KEY,
  tools: [],
  outputs: ["event"],
});
