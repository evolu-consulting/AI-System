// CR-124 · q4 · FLOW4-FR-08/09/10 · 2 flow MẪU của Thư viện theo sự kiện `contract.received` (bên NHẬN hợp đồng đối tác), cùng khuôn
// `flow-templates.def.ts` (duyệt theo MÃ Group, công ty sao ra đổi mã). Nguồn sự thật của seed hub 0121 (test `flow-templates-receive.def.test.ts`
// khớp từng byte JSON với migration). Đồng ý ⇒ Kết thúc · Đồng ý (confirmed), Trả lại ⇒ returned, Từ chối ⇒ declined — OutcomeHandler của
// gói Hợp đồng đổi kết thúc thành câu trả lời gửi về bên gửi (không node «Trả lời đối tác»).
//   «Nhận HĐ quan trọng»: mức ≥ Quan trọng ⇒ Kế toán duyệt → Giám đốc duyệt → Kết thúc · Đồng ý.
//   «Nhận HĐ thường»   : không điều kiện (xếp CUỐI danh sách) ⇒ một người duyệt (phòng Kinh doanh) → Kết thúc · Đồng ý.
import type { FactWhen, ProcessDefInput } from "@ai/contracts/hub-admin";
import { approve, finish, norm } from "./flow-templates.def";

type DefStage = ProcessDefInput["stages"][number];

export const RECEIVE_EVENT = "contract.received";
export const RECEIVE_APP = "contracts";
export const RECEIVE_INPUTS = [
  { key: "contract_id", label: "Hợp đồng", type: "text", required: true },
];

/** Điều kiện Bắt đầu của «Nhận HĐ quan trọng»: mức quan trọng ∈ {Quan trọng, Rất quan trọng}. */
export const RECEIVE_IMPORTANT_WHEN: FactWhen = {
  op: "and",
  conds: [{ fact: "importance", op: "in", value: ["important", "critical"] }],
};

const to = { reject: 3, ret: 4 };
const ends = [
  finish(2, "confirmed", "Đồng ý"),
  finish(3, "declined", "Từ chối"),
  finish(4, "returned", "Trả lại"),
];

/** q6 · HĐ nhận không có người gửi thật bên trong công ty nhận: người gây sự kiện (người phụ trách / quản trị do hệ thống chọn) KHÔNG bị loại khỏi duyệt. */
const open = (group: string) => ({
  after: {
    kind: "review",
    group_id: null,
    group_key: group,
    back_to_steps: [],
    remind_every_h: 24,
    escalate: null,
    branch: [],
    exclude_starter: false,
  },
});

const quanTrong = () => [
  approve("ke-toan", "Kế toán duyệt", 0, "ke-toan", to, open("ke-toan")),
  approve("giam-doc", "Giám đốc duyệt", 1, "giam-doc", to, open("giam-doc")),
  ...ends,
];
const thuong = () => [
  approve(
    "nguoi-xac-nhan",
    "Người xác nhận",
    0,
    "phong-kinh-doanh",
    { reject: 2, ret: 3 },
    open("phong-kinh-doanh"),
  ),
  finish(1, "confirmed", "Đồng ý"),
  finish(2, "declined", "Từ chối"),
  finish(3, "returned", "Trả lại"),
];

export type ReceiveTemplate = {
  id: string;
  key: string;
  name: string;
  description: string;
  /** Điều kiện Bắt đầu; vắng ⇒ không điều kiện (flow mặc định, đứng cuối). */
  when?: FactWhen;
  stages: () => DefStage[];
};

export const RECEIVE_TEMPLATES: readonly ReceiveTemplate[] = [
  {
    id: "0c124000-0000-4000-8000-0000000000c1",
    key: "hd-nhan-quan-trong",
    name: "Nhận HĐ quan trọng",
    description:
      "Hợp đồng đối tác gửi mức Quan trọng trở lên: Kế toán duyệt, Giám đốc duyệt, rồi trả lời Đồng ý.",
    when: RECEIVE_IMPORTANT_WHEN,
    stages: () => norm(quanTrong()),
  },
  {
    id: "0c124000-0000-4000-8000-0000000000c2",
    key: "hd-nhan-thuong",
    name: "Nhận HĐ thường",
    description: "Hợp đồng đối tác gửi thông thường: một người xác nhận rồi trả lời Đồng ý.",
    stages: () => norm(thuong()),
  },
];

export const receiveTriggerOf = (t: ReceiveTemplate) => ({
  event: RECEIVE_EVENT,
  ...(t.when ? { when: t.when } : {}),
});

/** FlowDef đầy đủ của một mẫu nhận (để kiểm bằng `parseFlowDef` / `flowDefIssues`). */
export const receiveDefOf = (t: ReceiveTemplate) => ({
  key: t.key,
  name: t.name,
  app: RECEIVE_APP,
  owner: "library" as const,
  trigger: receiveTriggerOf(t),
  stages: t.stages(),
});
