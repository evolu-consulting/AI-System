// CR-125 · cr125-contract-from-step · khai báo node «Tạo hợp đồng từ hồ sơ» (khuôn module CR-125). Lượt bắt đầu từ phiếu (`core.start-form`)
// hoặc chạy làm Quy trình con KHÔNG có hợp đồng, nên bước Ký số không có `contract_id`. Node này đặt SAU bước điền (form có tệp): tạo một
// bản ghi hợp đồng trong Sổ Hợp Tác của công ty qua đúng use case tải lên hiện có (tệp = tài liệu của HĐ, trạng thái «Chờ xác nhận» đủ để
// khoá + gửi ký), gắn lượt với HĐ, trả `contract_id` cho bước sau (Ký số nhận qua nguồn «từ bước trước», như lượt theo sự kiện HĐ).
// Binding máy chủ: hub-api packs/contracts/nodes/create-from-step/binding.ts.
import type { FeatureNodeDecl } from "../../types";
import { CREATE_FROM_STEP_TOOL, CreateFromStepConfigSchema } from "./config";

export const CREATE_FROM_STEP_NODE: FeatureNodeDecl = {
  key: "contracts.create-from-step",
  label: { vi: "Tạo hợp đồng từ hồ sơ", en: "Create contract from file" },
  group: "content",
  kind: "app",
  feature: "contracts-write",
  // Bước nghiệp vụ (đứng trước duyệt/ký) ⇒ nhóm nghiệp vụ của menu "+", trước Ký số.
  menu: { section: "business", order: 25 },
  configPort: {
    schema: CreateFromStepConfigSchema,
    widgets: { title: "text", counterparty: "text", amount: "money" },
  },
  // Tạo bản ghi nội bộ (chưa gửi ra ngoài) ⇒ không `real_action`, không đòi bước duyệt ngay trước.
  stages: [{ executor: { kind: "tool", tool_key: CREATE_FROM_STEP_TOOL, args: {} } }],
  inputs: [
    {
      key: "file_id",
      type: "string",
      required: true,
      label: { vi: "Tệp hợp đồng", en: "Contract file" },
      fix: {
        vi: "thêm bước Điền thông tin có ô Đính kèm tệp trước.",
        en: "add a Fill-in step with an attachment field first.",
      },
    },
    {
      key: "title",
      type: "string",
      required: false,
      label: { vi: "Tên hợp đồng", en: "Contract title" },
    },
    {
      key: "counterparty",
      type: "string",
      required: false,
      label: { vi: "Đối tác", en: "Counterparty" },
    },
    {
      key: "amount",
      type: "number",
      required: false,
      label: { vi: "Giá trị hợp đồng", en: "Contract value" },
    },
  ],
  outputs: [
    {
      key: "contract_id",
      type: "string",
      required: true,
      label: { vi: "Hợp đồng", en: "Contract" },
    },
  ],
};
