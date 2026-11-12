// CR-125 · m1 · khai báo node Ký số (chuyển từ `contracts.manifest.ts` — MỘT nguồn; manifest chỉ đọc lại từ `MODULES`).
// CR-122 · N1 · FLOW2-FR-25 · Ký số = tool gói gửi ký + chờ sự kiện ký (E3: `also_events` + rẽ theo kết quả).
// CR-125 · m4 · MOD-FR-04/11 · `configPort` = schema args của tool `contracts-esign-send` (CHỈ người ký + hạn + nhắc; KHÔNG nhà cung cấp —
// người ký chọn cách ký lúc ký).
import { EsignNodeConfigSchema } from "../../../pack-contracts/esign-node";
import type { FeatureNodeDecl, PortSchema } from "../../types";

export const ESIGN_CONFIG_PORT: PortSchema = {
  schema: EsignNodeConfigSchema,
  widgets: {
    company_signers: "people",
    due_days: "days",
    due_hours: "hours",
    remind_every_hours: "hours",
  },
};

export const ESIGN_NODE: FeatureNodeDecl = {
  key: "contracts.esign",
  label: { vi: "Ký số", en: "E-signature" },
  group: "sign",
  menu: { section: "business", order: 30 },
  kind: "app",
  feature: "contracts-write",
  // CR-125 · m5 · Ký số là hành động thật: cần người duyệt ngay trước (trước đây luật cứng ở `process-real-rule.ts`, nay đọc từ khai báo).
  requires: { before: "approval" },
  configPort: ESIGN_CONFIG_PORT,
  // E5 · người ký công ty, đối tác ký, thứ tự, hạn, nhắc ghi ở `args` stage 0 (`EsignNodeConfig`, esign-node.ts).
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
      fix: { vi: "thêm bước Tải hợp đồng trước.", en: "add an Upload contract step first." },
    },
  ],
  // CR-125 · m8 · cổng ra đủ, nhãn nghiệp vụ. `event` (đã ký / từ chối / huỷ / hết hạn) do stage chờ ghi (`WAIT_EVENT_FIELD`) = «outcome».
  // CR-125 · m9 · ba cổng còn lại = dữ liệu phong bì kèm sự kiện `esign.*`, ghi cùng output stage chờ (hub esign-outputs.rules.ts).
  outputs: [
    {
      key: "event",
      type: "string",
      required: true,
      label: { vi: "Kết quả ký", en: "Signing outcome" },
    },
    {
      key: "signed_at",
      type: "date",
      required: false,
      label: { vi: "Thời điểm ký xong", en: "Signed at" },
    },
    {
      key: "signer",
      type: "string",
      required: false,
      label: { vi: "Người ký", en: "Signer" },
    },
    {
      key: "envelope_id",
      type: "string",
      required: false,
      label: { vi: "Mã phong bì ký", en: "Envelope id" },
    },
  ],
};
