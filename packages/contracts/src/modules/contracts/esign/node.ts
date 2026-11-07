// CR-125 · m1 · khai báo node Ký số (chuyển từ `contracts.manifest.ts` — MỘT nguồn; manifest chỉ đọc lại từ `MODULES`).
// CR-122 · N1 · FLOW2-FR-25 · Ký số = tool gói gửi ký + chờ sự kiện ký (E3: `also_events` + rẽ theo kết quả).
// m4 sẽ thêm `configPort` (= schema args tool) cùng binding máy chủ.
import type { FeatureNodeDecl } from "../../types";

export const ESIGN_NODE: FeatureNodeDecl = {
  key: "contracts.esign",
  label: { vi: "Ký số", en: "E-signature" },
  group: "sign",
  kind: "app",
  feature: "contracts-write",
  // CR-125 · m5 · Ký số là hành động thật: cần người duyệt ngay trước (trước đây luật cứng ở `process-real-rule.ts`, nay đọc từ khai báo).
  requires: { before: "approval" },
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
    {
      key: "contract_id",
      type: "string",
      required: true,
      label: { vi: "Hợp đồng", en: "Contract" },
    },
  ],
  outputs: [{ key: "event", type: "string", required: true }],
};
