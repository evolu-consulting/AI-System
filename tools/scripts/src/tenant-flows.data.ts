// CR-159 · dữ liệu + luật THUẦN của `bun run tenant:flows`: quy trình cho 3 công ty evolu / nitigroup / preschool. KHÔNG I/O.
// Người = email trong `deploy/tenants/<key>.yaml` (script tra id người dùng thật ở công ty đó rồi truyền vào `flowsFor`).
// Mỗi công ty tối đa 3 quy trình, KHÔNG ngưỡng tiền; mọi bước Duyệt có Duyệt / Trả lại về người tạo / Từ chối (bước Kết thúc riêng):
//   «Duyệt hợp đồng gửi đi» (contract.submitted) · «Nhận hợp đồng từ đối tác» (contract.received + người phụ trách ở trigger.params)
//   · «Đề nghị mua hàng / thanh toán» (mở bằng phiếu; luật mở không bao giờ đúng nên không tranh quyền duyệt HĐ).
// CR-160: HĐ gửi đi và phiếu mở bằng nhánh `if starter_is_top` (người gửi là trưởng phòng gốc ⇒ bỏ duyệt) thay nhánh theo phòng; không còn đích dự phòng cho cấp cao nhất.
// Người duyệt cụ thể = `after.approver_user_id` (người dùng thật của công ty, không tạo nhóm). Không còn «Quá hạn chuyển cho» (người thay thế): chỉ trưởng phòng
// (`starter_head`, engine tự leo cấp) hoặc người cụ thể ở bước làm việc.
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
import { type Org, readOrg, shapeOf } from "./tenant-flows.org";

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
/** «Người gửi là cấp cao nhất?» (CR-160, dữ kiện `starter_is_top`: người gửi là trưởng phòng gốc): Đúng ⇒ bỏ bước duyệt (`skip`), Sai ⇒ trưởng phòng (`head`). */
const ifTop = (step: number, skip: number, head: number): Stage => ({
  key: "re-nhanh",
  name: "Người gửi là cấp cao nhất?",
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
      conds: [{ from: { kind: "fact", key: "starter_is_top" }, op: "eq", value: true }],
    },
    then_step: skip,
    else_step: head,
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

type Gate = { stages: Stage[]; next: number };
type Kind = "send" | "receive" | "buy";
/** Số bước của khối duyệt đầu (để tính đích Từ chối / Trả lại trước khi dựng). */
const gateWidth = (org: Org, kind: Kind): number =>
  shapeOf(org) === "none" ? (kind === "buy" ? 0 : 1) : kind === "send" ? 3 : kind === "buy" ? 2 : 1;
/**
 * Bước duyệt đầu (luật chung): trưởng phòng của người tạo (`starter_head`, tự leo cấp). `top` = trưởng gốc, người ký.
 * `none` (chỉ có trưởng gốc) ⇒ chỉ bước «Chuẩn bị ký» (engine buộc bước Ký đứng sau MỘT bước kiểu duyệt: `REAL_ACTION`); phiếu không có bước nào.
 * HĐ gửi đi / phiếu ⇒ `if starter_is_top`: Đúng bỏ duyệt (HĐ: sang «Chuẩn bị ký»; phiếu: sang bước sau duyệt). Nhận HĐ: người tạo là người
 * phụ trách ở trigger (không phải người gửi ngoài), không rẽ.
 */
function gate(org: Org, step: number, to: To, top: string, kind: Kind): Gate {
  const prep = (s: number) =>
    workBy("chuan-bi-ky", "Chuẩn bị ký", s, top, [txt("ghi_chu", "Ghi chú (nếu có)")]);
  if (shapeOf(org) === "none")
    return kind === "buy" ? { stages: [], next: step } : { stages: [prep(step)], next: step + 1 };
  if (kind === "receive") return { stages: [headOfStarter(step, undefined, to)], next: step + 1 };
  if (kind === "buy")
    return {
      stages: [ifTop(step, step + 2, step + 1), headOfStarter(step + 1, undefined, to)],
      next: step + 2,
    };
  return {
    stages: [
      ifTop(step, step + 2, step + 1),
      headOfStarter(step + 1, undefined, to, { next_step: step + 3 }),
      prep(step + 2),
    ],
    next: step + 3,
  };
}
const topOf = (org: Org, uid: Uid): string => uid(org.rootHead as string);
/** HĐ gửi đi: [duyệt đầu] → Ký (trưởng gốc) → Gửi đối tác xác nhận → Kết thúc. */
function sendFlow(org: Org, uid: Uid, group: string): Stage[] {
  const top = topOf(org, uid);
  const end = gateWidth(org, "send") + 2 + 3; // duyệt + Ký + Chờ ký + 3 bước Gửi đối tác
  const g = gate(org, 0, { reject: end + 1, ret: end + 2 }, top, "send");
  return norm([
    ...g.stages,
    sign(g.next, top),
    esignWait(g.next + 1, end + 1),
    ...partner(g.next + 2, top, group, { returned: end + 2, declined: end + 1 }),
    ...finishes(end, ["approved", "Đã xác nhận"]),
  ]);
}
/** Nhận HĐ: [duyệt đầu từ người phụ trách] → Ký (trưởng gốc) → Kết thúc (Đồng ý / Từ chối / Trả lại). */
function receiveFlow(org: Org, uid: Uid): Stage[] {
  const top = topOf(org, uid);
  const end = gateWidth(org, "receive") + 2; // duyệt đầu + Ký + Chờ ký
  const gg = gate(org, 0, { reject: end + 1, ret: end + 2 }, top, "receive");
  return norm([
    ...gg.stages,
    sign(gg.next, top),
    esignWait(gg.next + 1, end + 1),
    ...finishes(end, ["confirmed", "Đồng ý"]),
  ]);
}
/** Phiếu: phiếu → [`if starter_is_top` ⇒ bỏ duyệt | trưởng phòng duyệt] → (nitigroup: Phương kiểm) → ghi đã chi → Kết thúc. `check` = người kiểm (kế toán) nếu có. */
function buyFlow(org: Org, uid: Uid, payer: string, check?: string): Stage[] {
  const top = topOf(org, uid);
  const mid = check ? 1 : 0;
  const end = 1 + gateWidth(org, "buy") + mid + 1; // phiếu + duyệt đầu + [kiểm] + ghi đã chi
  const to = { reject: end + 1, ret: end + 2 };
  const g = gate(org, 1, to, top, "buy");
  const checkStage = check
    ? [byPerson("ke-toan-kiem", "Kế toán kiểm", g.next, check, undefined, to)]
    : [];
  return norm([
    phieu(),
    ...g.stages,
    ...checkStage,
    paid(g.next + mid, payer),
    ...finishes(g.next + mid + 1, ["approved", "Đã chi"]),
  ]);
}
const SEND_TRIGGER_DEF = (stages: Stage[]): Pick<FlowDef, "trigger" | "stages"> => ({
  trigger: SEND_TRIGGER,
  stages,
});
const recvTrigger = (owner: string) => ({
  event: "contract.received",
  params: { owner_user_id: owner },
});

/** Quy trình của một công ty; `uid` đổi email → id người dùng của công ty đó (thiếu ⇒ ném lỗi); `org` = cây phòng ban từ yaml. */
export function flowsFor(key: TenantKey, uid: Uid, org: Org = readOrg(key)): FlowDef[] {
  const owner = uid(
    key === "evolu"
      ? WHO.evolu.julian
      : key === "nitigroup"
        ? WHO.nitigroup.vy
        : WHO.preschool.dung,
  );
  const buy = (): FlowDef[] => {
    if (key === "preschool") return [];
    const payer = uid(key === "evolu" ? (org.rootHead as string) : WHO.nitigroup.phuong);
    const check = key === "nitigroup" ? payer : undefined;
    return [
      {
        name: FLOW_NAMES.buy,
        trigger: NEVER_TRIGGER,
        stages: buyFlow(org, uid, payer, check),
        inputs: [],
      },
    ];
  };
  return [
    { name: FLOW_NAMES.send, ...SEND_TRIGGER_DEF(sendFlow(org, uid, PICK_GROUP[key])), inputs },
    {
      name: FLOW_NAMES.receive,
      trigger: recvTrigger(owner),
      stages: receiveFlow(org, uid),
      inputs,
    },
    ...buy(),
  ];
}
