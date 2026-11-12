// CR-127 · P2 · BR-61/62 · spec §3 #12–#14c · node «Đồng ý ký cùng lúc» của quy trình NHẬN hợp đồng (đứng sau điều kiện Nếu «đối tác đề nghị ký cùng lúc»).
// Người phụ trách HĐ nhận trả lời bằng 3 lựa chọn (API `POST /contracts/:id/sign-session/respond`): Đồng ý (chọn người ký trong nhóm «Người ký HĐ»)
// · Xử lý bình thường · Từ chối HĐ; hết hạn trả lời ⇒ xử lý bình thường. Không tool: stage chờ tín hiệu `sign.session.*` do bộ chuyển hộp thư bắn
// (partner-mailbox.mount.ts). Binding máy chủ: packs/contracts/nodes/sign-together-accept/binding.ts.
import type { FeatureNodeDecl } from "../../types";

export const SIGN_TOGETHER_ACCEPT_KEY = "contracts.sign-together-accept";
/** Hạn trả lời mặc định (giờ) — khớp `SIGN_TOGETHER_ACCEPT_H_DEFAULT` của bên gửi; hạn thật do phiên ký (hub) quyết, hết hạn ⇒ tín hiệu `expired`. */
const ACCEPT_TIMEOUT_H = 2;

export const SIGN_TOGETHER_ACCEPT_NODE: FeatureNodeDecl = {
  key: SIGN_TOGETHER_ACCEPT_KEY,
  label: { vi: "Đồng ý ký cùng lúc", en: "Agree to sign together" },
  group: "sign",
  kind: "app",
  feature: "contracts-write",
  menu: { section: "business", order: 37 },
  exits: [
    { key: "agreed", label: { vi: "Đồng ý ký cùng lúc", en: "Agreed" } },
    {
      key: "normal",
      label: { vi: "Xử lý bình thường", en: "Handle normally" },
      on: ["sign.session.expired", "timeout"],
    },
    {
      key: "declined",
      label: { vi: "Từ chối hợp đồng", en: "Declined" },
      on: ["sign.session.declined"],
    },
  ],
  stages: [
    {
      executor: {
        kind: "wait_event",
        event: "sign.session.accepted",
        also_events: ["sign.session.declined", "sign.session.expired"],
        timeout_h: ACCEPT_TIMEOUT_H,
      },
    },
  ],
  inputs: [
    {
      key: "contract_id",
      type: "string",
      required: true,
      label: { vi: "Hợp đồng", en: "Contract" },
      fix: {
        vi: "dùng sau sự kiện «Nhận hợp đồng từ đối tác».",
        en: "use after the partner-received event.",
      },
    },
  ],
  outputs: [
    {
      key: "event",
      type: "string",
      required: true,
      label: { vi: "Trả lời của bên nhận", en: "Receiver's answer" },
    },
  ],
};
