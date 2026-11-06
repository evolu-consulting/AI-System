// CR-122 · B · flow MẪU của Thư viện theo sự kiện `contract.submitted` (đã xuất bản, `trigger` + `app`, KHÔNG khe): "Duyệt 2 cấp",
// "Duyệt theo giá trị", "Duyệt theo phòng ban". Nguồn sự thật của dữ liệu seed (`flow-templates.seed.ts`). Duyệt theo MÃ Group
// (`group_key`) — công ty sao mẫu ra thì E1b đổi mã → id Group của công ty lúc chạy. Từ chối ⇒ Kết thúc · Từ chối, Trả lại ⇒ Kết thúc ·
// Trả lại (HĐ về Nháp). KHÔNG chèn node Ghi giá trị: bước dùng đầu vào `contract-id` của HĐ (lát A nối dữ liệu hồ sơ cho mọi bước).
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { normalizeStage } from "../nodes/registry";

type DefStage = ProcessDefInput["stages"][number];

export const FLOW_TEMPLATE_EVENT = "contract.submitted";
export const FLOW_TEMPLATE_APP = "contracts";
export const FLOW_TEMPLATE_INPUTS = [
  { key: "contract-id", label: "Hợp đồng", type: "text", required: true },
];

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
const review = (group: string) => ({
  kind: "review",
  group_id: null,
  group_key: group,
  back_to_steps: [],
  remind_every_h: 24,
  escalate: null,
  branch: [],
  exclude_starter: true,
});

type Stage = Record<string, unknown>;
/** Bước Duyệt (node Duyệt độc lập): Từ chối ⇒ `reject`, Trả lại ⇒ `ret` (bước Kết thúc). */
const approve = (
  key: string,
  name: string,
  step: number,
  group: string,
  to: { reject: number; ret: number },
  o: Stage = {},
) => ({
  ...base,
  key,
  name,
  step,
  executor: { kind: "approve", reject_step: to.reject, return_step: to.ret },
  output: out(`${key}.md`, [{ key: "decision", type: "string", required: true }]),
  after: review(group),
  ...o,
});
const esignSend = (step: number): Stage => ({
  ...base,
  key: "ky-so",
  name: "Ký số",
  step,
  real_action: true,
  executor: {
    kind: "tool",
    tool_key: "contracts-esign-send",
    args: { contract_id: { from: "input", key: "contract-id" } },
  },
  output: out("ky-so.md", [{ key: "status", type: "string", required: true }]),
  after: auto,
});
/** Chờ ký xong; từ chối / huỷ / quá hạn chờ ⇒ bước `fail` (Kết thúc · Từ chối). */
const esignWait = (step: number, fail: number): Stage => ({
  ...base,
  key: "cho-ky",
  name: "Chờ ký xong",
  step,
  executor: {
    kind: "wait_event",
    event: "esign.completed",
    also_events: ["esign.declined", "esign.voided"],
    timeout_h: 168,
    branches: [
      { on: "esign.declined", goto_step: fail },
      { on: "esign.voided", goto_step: fail },
      { on: "timeout", goto_step: fail },
    ],
  },
  output: out("cho-ky.md"),
  after: auto,
});
const finish = (step: number, outcome: string, label: string): Stage => ({
  ...base,
  key: `ket-thuc-${outcome}`,
  name: `Kết thúc · ${label}`,
  step,
  timeout_s: 60,
  executor: { kind: "set", values: [] },
  output: out("end.md"),
  after: auto,
  outcome,
});
const notifyStarter = (step: number): Stage => ({
  ...base,
  key: "bao-nguoi-tao",
  name: "Thông báo người tạo",
  step,
  executor: {
    kind: "notify",
    to: [{ who: "starter" }],
    channels: ["bell"],
    title: "Hợp đồng đã được duyệt và ký",
    body: "Hợp đồng bạn gửi duyệt đã được duyệt và ký số xong.",
  },
  output: out("bao-nguoi-tao.md"),
  after: auto,
});
const ifFact = (
  step: number,
  name: string,
  cond: { key: string; op: string; value: string | number },
  then: number,
  otherwise: number,
): Stage => ({
  ...base,
  key: "re-nhanh",
  name,
  step,
  executor: {
    kind: "if",
    when: {
      op: "and",
      conds: [{ from: { kind: "fact", key: cond.key }, op: cond.op, value: cond.value }],
    },
    then_step: then,
    else_step: otherwise,
  },
  output: out("re-nhanh.md"),
  after: auto,
});

const norm = (xs: Stage[]): DefStage[] =>
  xs.map((s) => normalizeStage(structuredClone(s) as unknown as DefStage));

/** 1 · Trưởng phòng duyệt → Giám đốc duyệt → Ký số → Thông báo người tạo → Kết thúc · Đã duyệt. */
const duyet2Cap = (): Stage[] => {
  const to = { reject: 6, ret: 7 };
  return [
    approve("truong-phong", "Trưởng phòng duyệt", 0, "truong-phong", to),
    approve("giam-doc", "Giám đốc duyệt", 1, "giam-doc", to),
    esignSend(2),
    esignWait(3, 6),
    notifyStarter(4),
    finish(5, "approved", "Đã duyệt"),
    finish(6, "rejected", "Từ chối"),
    finish(7, "returned", "Trả lại"),
  ];
};

/** 2 · Nếu giá trị HĐ > 100 triệu thì Pháp chế duyệt, ngược lại Kế toán duyệt → gộp nhánh → Ký số → Kết thúc. */
const duyetTheoGiaTri = (): Stage[] => {
  const to = { reject: 6, ret: 7 };
  return [
    ifFact(
      0,
      "Giá trị trên 100 triệu?",
      { key: "total_value", op: "gt", value: 100_000_000 },
      1,
      2,
    ),
    approve("phap-che", "Pháp chế duyệt", 1, "phap-che", to, { next_step: 3 }),
    approve("ke-toan", "Kế toán duyệt", 2, "ke-toan", to, { next_step: 3 }),
    esignSend(3),
    esignWait(4, 6),
    finish(5, "approved", "Đã duyệt"),
    finish(6, "rejected", "Từ chối"),
    finish(7, "returned", "Trả lại"),
  ];
};

/** 3 · Nếu phòng ban = X thì nhóm duyệt X, ngược lại nhóm truong-phong duyệt → gộp nhánh → Ký số → Kết thúc. X = mã phòng ban mẫu, công ty đổi khi sao. */
export const FLOW_TEMPLATE_DEPARTMENT = "phong-kinh-doanh";
const duyetTheoPhongBan = (): Stage[] => {
  const to = { reject: 6, ret: 7 };
  return [
    ifFact(
      0,
      "Người tạo thuộc phòng ban mẫu?",
      { key: "creator_department", op: "eq", value: FLOW_TEMPLATE_DEPARTMENT },
      1,
      2,
    ),
    approve("nhom-duyet", "Nhóm phòng ban duyệt", 1, "duyet-kinh-doanh", to, { next_step: 3 }),
    approve("truong-phong", "Trưởng phòng duyệt", 2, "truong-phong", to, { next_step: 3 }),
    esignSend(3),
    esignWait(4, 6),
    finish(5, "approved", "Đã duyệt"),
    finish(6, "rejected", "Từ chối"),
    finish(7, "returned", "Trả lại"),
  ];
};

export type FlowTemplate = {
  /** Id cố định ⇒ seed chạy lại không nhân bản. */
  id: string;
  key: string;
  name: string;
  description: string;
  stages: () => DefStage[];
};

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  {
    id: "0c122000-0000-4000-8000-0000000000b1",
    key: "hd-duyet-2-cap",
    name: "Duyệt 2 cấp",
    description: "Trưởng phòng duyệt, Giám đốc duyệt, ký số, báo người tạo.",
    stages: () => norm(duyet2Cap()),
  },
  {
    id: "0c122000-0000-4000-8000-0000000000b2",
    key: "hd-duyet-theo-gia-tri",
    name: "Duyệt theo giá trị",
    description: "Trên 100 triệu Pháp chế duyệt, còn lại Kế toán duyệt, rồi ký số.",
    stages: () => norm(duyetTheoGiaTri()),
  },
  {
    id: "0c122000-0000-4000-8000-0000000000b3",
    key: "hd-duyet-theo-phong-ban",
    name: "Duyệt theo phòng ban",
    description: "Người tạo thuộc phòng ban mẫu thì nhóm của phòng đó duyệt, rồi ký số.",
    stages: () => norm(duyetTheoPhongBan()),
  },
];

/** FlowDef đầy đủ của một mẫu (để kiểm bằng `parseFlowDef` / `flowDefIssues`). */
export const flowDefOf = (t: FlowTemplate) => ({
  key: t.key,
  name: t.name,
  app: FLOW_TEMPLATE_APP,
  owner: "library" as const,
  trigger: { event: FLOW_TEMPLATE_EVENT },
  stages: t.stages(),
});
