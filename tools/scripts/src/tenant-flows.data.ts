// CR-159 · dữ liệu + luật THUẦN của `bun run tenant:flows`: quy trình cho 3 công ty evolu / nitigroup / preschool. KHÔNG I/O.
// Người = email trong `deploy/tenants/<key>.yaml` (script tra id người dùng thật ở công ty đó rồi truyền vào `flowsFor`).
// Mỗi công ty tối đa 3 quy trình, KHÔNG ngưỡng tiền; mọi bước Duyệt có Duyệt / Trả lại về người tạo / Từ chối (bước Kết thúc riêng):
//   «Duyệt hợp đồng gửi đi» (contract.submitted) · «Nhận hợp đồng từ đối tác» (contract.received + người phụ trách ở trigger.params)
//   · «Đề nghị mua hàng / thanh toán» (mở bằng phiếu; luật mở không bao giờ đúng nên không tranh quyền duyệt HĐ).
// Người duyệt cụ thể = `after.approver_user_id` (người dùng thật của công ty, không tạo nhóm). «Quá hạn chuyển cho» (escalate.user_id) = người
// thay thế khi người duyệt CHÍNH LÀ người tạo (STARTER_CANNOT_REVIEW / R#15): việc giao thêm cho người đó thay vì treo.
import { APPROVAL_FLOW_DUE_DEFAULT_H } from "@ai/contracts/pack-contracts";
import {
  approve,
  esignSend,
  esignWait,
  FLOW_TEMPLATE_INPUTS,
  finish,
  norm,
  reviewNew,
  type Stage,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import { partnerSend } from "./seed-demo-partner.data";
import { date, money, note, txt, work } from "./seed-purchase-flow.kit";

export type FlowDef = {
  name: string;
  trigger: Record<string, unknown>;
  stages: unknown[];
  /** đầu vào của def (bước Ký/Gửi đối tác đọc `contract_id`); phiếu không có. */
  inputs: unknown[];
};
export const TENANT_KEYS = ["evolu", "nitigroup", "preschool"] as const;
export type TenantKey = (typeof TENANT_KEYS)[number];

export const FLOW_NAMES = {
  send: "Duyệt hợp đồng gửi đi",
  receive: "Nhận hợp đồng từ đối tác",
  buy: "Đề nghị mua hàng / thanh toán",
} as const;
/** Email người của từng công ty (khớp `deploy/tenants/*.yaml`). */
export const WHO = {
  evolu: { thomas: "thomas.tran@evolu.com", julian: "julian.bui@evolu.com" },
  nitigroup: {
    tien: "thuytien.le@nitigroupvn.com",
    ngan: "thuyngan.le@nitigroupvn.com",
    vy: "thuyvy.trang@nitigroupvn.com",
    phuong: "thuphuong.pham@nitigroupvn.com",
  },
  preschool: { dung: "dung.dang@preschool.com" },
} as const;
/** Nhóm (phòng ban gốc của yaml) chứa người chọn đối tác: server bắt buộc `assignee_group` cho node Gửi đối tác; người cụ thể vẫn khoá bằng `approver_user_id`. */
export const PICK_GROUP = {
  evolu: "pb-ban-giam-doc",
  nitigroup: "pb-giam-doc",
  preschool: "pb-ban-giam-doc",
} as const;
/** Mã phòng ban không có trưởng ở nitigroup.yaml; người tạo thuộc phòng này ⇒ Ngân duyệt thay «trưởng phòng». */
export const NITI_HEADLESS_DEPT = "pb-kinh-doanh";
/** Luật không bao giờ đúng: quy trình chỉ mở bằng phiếu, không tranh quyền duyệt HĐ (như `seed-purchase-flow.kit`). */
export const NEVER_TRIGGER = {
  event: "contract.submitted",
  when: { op: "and", conds: [{ fact: "total_value", op: "lt", value: -1 }] },
};
export const emailsOf = (key: TenantKey): string[] => Object.values(WHO[key]);

type To = { reject: number; ret: number };
type Uid = (email: string) => string;
const SIGN_PROVIDER = "upload"; // «Ký qua» = tải bản đã ký

const personAfter = (uid: string, backup?: string, o: Record<string, unknown> = {}) => {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return {
    ...after,
    approver_user_id: uid,
    ...(backup ? { escalate: { after_h: APPROVAL_FLOW_DUE_DEFAULT_H, user_id: backup } } : {}),
    ...o,
  };
};
/** Bước Duyệt do MỘT người cụ thể làm (Duyệt / Trả lại / Từ chối). `backup` = người thay khi người duyệt là người tạo. */
const byPerson = (
  key: string,
  name: string,
  step: number,
  uid: string,
  backup: string | undefined,
  to: To,
  o: Stage = {},
): Stage => approve(key, name, step, "", to, { after: personAfter(uid, backup), ...o });
/** «Trưởng phòng của người tạo duyệt» (`starter_head`; phòng không trưởng ⇒ engine leo lên phòng cha). */
const headOfStarter = (step: number, backup: string | undefined, to: To, o: Stage = {}): Stage => {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return approve("truong-phong", "Trưởng phòng duyệt", step, "", to, {
    after: {
      ...after,
      approver_mode: "starter_head",
      ...(backup ? { escalate: { after_h: APPROVAL_FLOW_DUE_DEFAULT_H, user_id: backup } } : {}),
    },
    ...o,
  });
};
/** Bước làm việc (điền form) do một người làm; người tạo cũng được làm (không loại người gửi). */
const workBy = (
  key: string,
  name: string,
  step: number,
  uid: string,
  fields: Parameters<typeof work>[4],
): Stage => ({
  ...work(key, name, step, "", fields),
  after: personAfter(uid, undefined, { exclude_starter: false }),
});
const sign = (step: number, signer: string): Stage => {
  const s = { ...esignSend(step), name: "Ký hợp đồng" } as unknown as Stage & {
    executor: { args: Record<string, unknown> };
  };
  return {
    ...s,
    executor: {
      ...s.executor,
      args: {
        ...s.executor.args,
        provider: { from: "const", value: SIGN_PROVIDER },
        company_signers: { from: "const", value: `user:${signer}` },
      },
    },
  };
};
/** Gửi đối tác xác nhận (3 bước của node: chọn đối tác & người nhận → gửi → chờ trả lời); người chọn = `picker`. */
const partner = (
  step: number,
  picker: string,
  group: string,
  go: { returned: number; declined: number },
): Stage[] =>
  partnerSend(step, { send_fields: "total_value", reply_days: 7, assignee_group: group }, go).map(
    (s) =>
      (s as { key?: string }).key === "chon-doi-tac"
        ? {
            ...s,
            after: personAfter(picker, undefined, { exclude_starter: false, group_key: group }),
          }
        : s,
  );
const ifDept = (step: number, dept: string, then: number, otherwise: number): Stage => ({
  key: "re-nhanh",
  name: "Người tạo thuộc Phòng Kinh doanh?",
  step,
  instruction: "",
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
  executor: {
    kind: "if",
    when: {
      op: "and",
      conds: [{ from: { kind: "fact", key: "creator_department" }, op: "eq", value: dept }],
    },
    then_step: then,
    else_step: otherwise,
  },
  output: { filename: "re-nhanh.md", template: "x", required_sections: ["x"], fields: [] },
  after: { kind: "auto", branch: [] },
});
const finishes = (at: number, ok: [string, string]) => [
  finish(at, ok[0], ok[1]),
  finish(at + 1, ok[0] === "confirmed" ? "declined" : "rejected", "Từ chối"),
  finish(at + 2, "returned", "Trả lại"),
];
const SEND_TRIGGER = { event: "contract.submitted" };
const inputs = FLOW_TEMPLATE_INPUTS as unknown[];

/** Phiếu «Đề nghị mua hàng / thanh toán»: nội dung, số tiền, nhà cung cấp, tệp. */
const phieu = (): Stage => ({
  key: "phieu-de-nghi",
  name: "Đề nghị mua hàng / thanh toán",
  step: 0,
  node: "core.start-form",
  instruction: "",
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
  executor: { kind: "set", values: [] },
  output: { filename: "phieu.md", template: "x", required_sections: ["x"], fields: [] },
  after: { kind: "auto", branch: [] },
  start_form: {
    fields: [
      { key: "noi_dung", label: "Nội dung", type: "longtext", required: true },
      { key: "so_tien", label: "Số tiền (đồng)", type: "money", required: true },
      { key: "nha_cung_cap", label: "Nhà cung cấp", type: "text", required: true },
      { key: "tep_dinh_kem", label: "Tệp đính kèm", type: "attachments", required: false },
    ],
    starters: { kind: "everyone" },
    title_template: "Đề nghị: {{nha_cung_cap}}",
  },
});
/** «Ghi đã chi»: một bước làm việc (node `contracts.record-payment` cần HĐ gắn lượt — phiếu không có HĐ ⇒ không dùng được). */
const paid = (step: number, uid: string): Stage =>
  workBy("ghi-da-chi", "Ghi đã chi", step, uid, [
    money("so_tien_da_chi", "Số tiền đã chi (đồng)", true),
    date("ngay_chi", "Ngày chi", true),
    note("ghi_chu", "Ghi chú"),
  ]);

function evolu(u: Uid): FlowDef[] {
  const T = u(WHO.evolu.thomas);
  const J = u(WHO.evolu.julian);
  const send = norm([
    byPerson("thomas-duyet", "Thomas duyệt", 0, T, J, { reject: 7, ret: 8 }),
    sign(1, T),
    esignWait(2, 7),
    ...partner(3, T, PICK_GROUP.evolu, { returned: 8, declined: 7 }),
    ...finishes(6, ["approved", "Đã xác nhận"]),
  ]);
  const recv = norm([
    byPerson("thomas-duyet", "Thomas duyệt", 0, T, J, { reject: 4, ret: 5 }),
    sign(1, T),
    esignWait(2, 4),
    ...finishes(3, ["confirmed", "Đồng ý"]),
  ]);
  const buy = norm([
    phieu(),
    byPerson("thomas-duyet", "Thomas duyệt", 1, T, J, { reject: 4, ret: 5 }),
    paid(2, T),
    ...finishes(3, ["approved", "Đã chi"]),
  ]);
  return [
    { name: FLOW_NAMES.send, trigger: SEND_TRIGGER, stages: send, inputs },
    {
      name: FLOW_NAMES.receive,
      trigger: { event: "contract.received", params: { owner_user_id: J } },
      stages: recv,
      inputs,
    },
    { name: FLOW_NAMES.buy, trigger: NEVER_TRIGGER, stages: buy, inputs: [] },
  ];
}

function nitigroup(u: Uid): FlowDef[] {
  const [tien, ngan, vy, phuong] = [
    u(WHO.nitigroup.tien),
    u(WHO.nitigroup.ngan),
    u(WHO.nitigroup.vy),
    u(WHO.nitigroup.phuong),
  ] as [string, string, string, string];
  const send = norm([
    ifDept(0, NITI_HEADLESS_DEPT, 1, 2),
    byPerson(
      "ngan-thay-truong-phong",
      "Ngân duyệt (thay trưởng phòng)",
      1,
      ngan,
      tien,
      {
        reject: 10,
        ret: 11,
      },
      { next_step: 3 },
    ),
    headOfStarter(2, ngan, { reject: 10, ret: 11 }, { next_step: 3 }),
    byPerson("tien-duyet", "Tiên duyệt", 3, tien, ngan, { reject: 10, ret: 11 }),
    sign(4, tien),
    esignWait(5, 10),
    ...partner(6, tien, PICK_GROUP.nitigroup, { returned: 11, declined: 10 }),
    ...finishes(9, ["approved", "Đã xác nhận"]),
  ]);
  const recv = norm([
    byPerson("ngan-duyet", "Ngân duyệt", 0, ngan, tien, { reject: 5, ret: 6 }),
    byPerson("tien-duyet", "Tiên duyệt", 1, tien, ngan, { reject: 5, ret: 6 }),
    sign(2, tien),
    esignWait(3, 5),
    ...finishes(4, ["confirmed", "Đồng ý"]),
  ]);
  const to = { reject: 6, ret: 7 };
  const buy = norm([
    phieu(),
    headOfStarter(1, ngan, to),
    byPerson("ke-toan-kiem", "Kế toán kiểm", 2, phuong, ngan, to),
    byPerson("tien-duyet", "Tiên duyệt", 3, tien, ngan, to),
    paid(4, phuong),
    ...finishes(5, ["approved", "Đã chi"]),
  ]);
  return [
    { name: FLOW_NAMES.send, trigger: SEND_TRIGGER, stages: send, inputs },
    {
      name: FLOW_NAMES.receive,
      trigger: { event: "contract.received", params: { owner_user_id: vy } },
      stages: recv,
      inputs,
    },
    { name: FLOW_NAMES.buy, trigger: NEVER_TRIGGER, stages: buy, inputs: [] },
  ];
}

/** Engine buộc bước hành động thật (Ký, Gửi đối tác) phải đứng ngay sau MỘT bước kiểu duyệt (`REAL_ACTION`) ⇒ preschool («không bước duyệt») chèn bước làm việc «Chuẩn bị ký» của Dung (không duyệt/từ chối). */
function preschool(u: Uid): FlowDef[] {
  const D = u(WHO.preschool.dung);
  const prep = (name: string) =>
    workBy("chuan-bi-ky", name, 0, D, [txt("ghi_chu", "Ghi chú (nếu có)")]);
  const send = norm([
    prep("Chuẩn bị ký"),
    sign(1, D),
    esignWait(2, 7),
    ...partner(3, D, PICK_GROUP.preschool, { returned: 8, declined: 7 }),
    ...finishes(6, ["approved", "Đã xác nhận"]),
  ]);
  const recv = norm([
    prep("Xem hợp đồng nhận"),
    sign(1, D),
    esignWait(2, 4),
    ...finishes(3, ["confirmed", "Đồng ý"]),
  ]);
  return [
    { name: FLOW_NAMES.send, trigger: SEND_TRIGGER, stages: send, inputs },
    {
      name: FLOW_NAMES.receive,
      trigger: { event: "contract.received", params: { owner_user_id: D } },
      stages: recv,
      inputs,
    },
  ];
}

/** Quy trình của một công ty; `uid` đổi email → id người dùng của công ty đó (thiếu ⇒ ném lỗi). */
export function flowsFor(key: TenantKey, uid: Uid): FlowDef[] {
  return key === "evolu" ? evolu(uid) : key === "nitigroup" ? nitigroup(uid) : preschool(uid);
}
