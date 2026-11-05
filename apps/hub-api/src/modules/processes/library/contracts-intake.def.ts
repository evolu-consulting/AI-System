// CR-120 · cr120-contracts-flow · def thư viện MẶC ĐỊNH của khe `contracts.intake` (luôn bật). Nguồn sự thật của JSON seed ở hub 0093
// (`contracts-intake.seed.test.ts` khớp migration ⇄ builder; đổi def mà quên migration mới ⇒ test đỏ).
//
//   s0 Trích xuất AI (tool `contracts-extract`)  →  s1 Xác nhận và lưu (form bổ sung, Group editor; nhắc 24 h, chuyển cấp 48 h)
//   →  s2 Duyệt theo luật (head review; set + after review)  →  s3 Ký số (tool `contracts-esign-send`, real_action)
//   →  s4 Chờ ký xong (wait_event `esign.completed`, hạn 14 ngày)  →  s5 Chờ tới ngày nghĩa vụ − 7 (wait_until từ trường form)
//   →  s6 Nhắc nghĩa vụ (tool `contracts-obligation-remind`).
// "Xác nhận và lưu" = hoàn tất s1 ⇒ run TỰ chạy tiếp tới s2 theo luật (không có bước "Gửi duyệt" thủ công).
// Bước "Nhận HĐ (upload)" là TRIGGER của khe (run mở khi HĐ được tải lên), không phải stage.
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { normalizeStage } from "../nodes/registry";

type DefStage = ProcessDefInput["stages"][number];

export const CONTRACTS_INTAKE_SLOT = "contracts.intake";
export const CONTRACTS_INTAKE_DEF = {
  id: "0c120000-0000-4000-8000-000000000093",
  key: "hd-nhan-hop-dong",
  name: "Nhận hợp đồng (mặc định)",
  description:
    "Nhận hợp đồng → AI trích xuất → xác nhận và lưu → duyệt theo luật → ký số → chờ ký → nhắc nghĩa vụ.",
  inputHint: "Mã hợp đồng",
} as const;

export const CONTRACTS_INTAKE_INPUTS = [
  { key: "contract-id", label: "Hợp đồng", type: "text", required: true },
];

const contractArg = { contract_id: { from: "input", key: "contract-id" } };
const auto = { kind: "auto", branch: [] };
const base = {
  instruction: "",
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
};
const out = (file: string, fields: unknown[] = []) => ({
  filename: file,
  template: "x",
  required_sections: ["x"],
  fields,
});
const review = (group: string, o: Record<string, unknown> = {}) => ({
  kind: "review",
  group_id: null,
  group_key: group,
  back_to_steps: [],
  remind_every_h: null,
  escalate: null,
  branch: [],
  exclude_starter: false,
  ...o,
});

const RAW: Record<string, unknown>[] = [
  {
    ...base,
    key: "extract",
    name: "AI trích xuất",
    step: 0,
    executor: { kind: "tool", tool_key: "contracts-extract", args: contractArg },
    output: out("extract.md", [{ key: "status", type: "string", required: true }]),
    after: auto,
  },
  {
    ...base,
    key: "confirm",
    name: "Xác nhận và lưu",
    step: 1,
    executor: {
      kind: "form",
      fields: [
        { key: "obligation_date", label: "Ngày đến hạn nghĩa vụ", type: "date", required: true },
        {
          key: "payment_terms",
          label: "Điều khoản thanh toán",
          type: "text",
          max_len: 200,
          required: false,
        },
        { key: "note", label: "Ghi chú bổ sung", type: "textarea", max_len: 2000, required: false },
      ],
    },
    output: out("confirm.md", [
      { key: "obligation_date", type: "date", required: true },
      { key: "payment_terms", type: "string", required: false },
      { key: "note", type: "string", required: false },
    ]),
    // G5 · nhắc mỗi 24 h, chuyển cấp sang Group owner sau 48 h.
    after: review("contracts-editor", {
      remind_every_h: 24,
      escalate: { after_h: 48, group_key: "contracts-owner" },
    }),
  },
  {
    ...base,
    key: "approve",
    name: "Duyệt theo luật",
    step: 2,
    executor: { kind: "set", values: [{ key: "outcome", from: { const: "approved" } }] },
    output: out("approve.md", [{ key: "outcome", type: "string", required: true }]),
    after: review("contracts-owner", {
      head_only: true,
      back_to_steps: [1],
      exclude_starter: true,
    }),
  },
  {
    ...base,
    key: "esign",
    name: "Ký số",
    step: 3,
    real_action: true,
    executor: { kind: "tool", tool_key: "contracts-esign-send", args: contractArg },
    output: out("esign.md", [{ key: "status", type: "string", required: true }]),
    after: auto,
  },
  {
    ...base,
    key: "signed",
    name: "Chờ ký xong",
    step: 4,
    executor: { kind: "wait_event", event: "esign.completed", timeout_h: 336 },
    output: out("signed.md"),
    after: auto,
  },
  {
    ...base,
    key: "wait-obligation",
    name: "Chờ tới ngày nghĩa vụ",
    step: 5,
    executor: {
      kind: "wait_until",
      from: { kind: "field", stage_key: "confirm", field: "obligation_date" },
      offset_days: -7,
      time: "09:00",
    },
    output: out("wait-obligation.md"),
    after: auto,
  },
  {
    ...base,
    key: "remind",
    name: "Nhắc nghĩa vụ",
    step: 6,
    executor: { kind: "tool", tool_key: "contracts-obligation-remind", args: contractArg },
    output: out("remind.md", [{ key: "status", type: "string", required: true }]),
    after: auto,
  },
];

/** Stage seed đã qua `normalizeStage` (Hub ép template/mục/answerer theo loại node) — đúng như lúc lưu def thường. */
export function contractsIntakeStages(): DefStage[] {
  return RAW.map((s) => normalizeStage(structuredClone(s) as unknown as DefStage));
}
