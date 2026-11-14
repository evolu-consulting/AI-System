// CR-105 L4 · quy trình duyệt ĐANG DÙNG (chỉ đọc): `GET /pack/contracts/approval-flow` = `ApprovalFlowCurrent`
// `{def_id, name, rel_version, is_default, steps:[{name, department_name, kind, when?}]}` (@ai/contracts). `when` dùng cho
// "Xem trước đường đi" (luật như server: giá trị trống ⇒ điều kiện đúng).
import type { FactWhen } from "@ai/contracts/hub-admin";
import {
  type ApprovalFlowCurrent,
  ApprovalFlowCurrentSchema,
  ApprovalFlowListSchema,
  type FlowCond,
  type FlowCondGroup,
  type FlowWhen,
} from "@ai/contracts/pack-contracts";

export type DealKind = "buy" | "sell" | "referral";
export type CurrentStep = {
  key: string;
  name: string;
  /** Tên phòng ban (không phải id). */
  department: string | null;
  kind: "review" | "dify" | "esign" | "notify" | "wait_until"; // CR-121 D-6
  when: FlowWhen | null;
  /** CR-108 · hạn xử lý (giờ); vắng ⇒ không hiện. */
  dueH: number | null;
  /** CR-108 · nhắc mỗi (giờ). */
  remindH: number | null;
  /** CR-108 · tên nhóm nhận khi quá hạn. */
  escalateGroup: string | null;
  /** CR-108 · số người duyệt còn dùng được của nhóm. */
  approverCount: number | null;
  /** CR-113 · nhóm chuyển cấp là mặc định (Toàn quyền). */
  escalateDefault?: boolean;
  /** CR-113 (review) · nhóm chuyển cấp đặt tường minh đã bị xoá (lỗi cấu hình). */
  escalateMissing?: boolean;
};
export type CurrentFlow = {
  defId: string;
  name: string;
  version: number;
  /** CR-125 · S2 · flow có rẽ nhánh theo điều kiện (danh sách bước = các bước có thể chạy). */
  hasBranches: boolean;
  /** CR-146 · thứ tự xét (0 = đầu); «Bắt đầu khi» (null ⇒ mọi hợp đồng còn lại); tên Group trong điều kiện. */
  position: number;
  startWhen: FactWhen | null;
  /** fix-review-r1 · điều kiện lưu không đọc được ⇒ hiện «Không đọc được điều kiện», không hiện «Mọi hợp đồng còn lại». */
  startWhenBad: boolean;
  groupNames: Record<string, string>;
  /** CR-146 · khối chỉ xem ký / đối tác; `sign` null ⇒ quy trình không có bước Ký. */
  sign: {
    signers: { kind: "user" | "group"; name: string | null }[];
    partnerSigns: boolean | null;
    order: "parallel" | "sequential" | null;
  } | null;
  partnerSend: boolean;
  /** CR-113 · Toàn quyền duyệt thay được mọi bước (vắng ⇒ true: luật chung). */
  ownerCanOverride: boolean;
  ownerGroupName: string | null;
  steps: CurrentStep[];
};
export type Facts = { deal: DealKind; value: number | null };

/** Thân `GET /approval-flow` (`{items}`) ⇒ danh sách theo thứ tự xét; sai hình ⇒ null (UI báo lỗi tải). */
export function toCurrentFlows(raw: unknown): CurrentFlow[] | null {
  const p = ApprovalFlowListSchema.safeParse(raw);
  return p.success ? p.data.items.map(fromApi) : null;
}

/** Một phần tử của danh sách ⇒ `CurrentFlow`; sai hình ⇒ null. */
export function toCurrentFlow(raw: unknown): CurrentFlow | null {
  const p = ApprovalFlowCurrentSchema.safeParse(raw);
  return p.success ? fromApi(p.data) : null;
}

function fromApi(d: ApprovalFlowCurrent): CurrentFlow {
  return {
    defId: d.def_id,
    name: d.name,
    version: d.rel_version,
    hasBranches: d.has_branches ?? false,
    position: d.position ?? 0,
    startWhen: d.start_when ?? null,
    startWhenBad: d.start_when_unreadable ?? false,
    groupNames: d.group_names ?? {},
    sign: d.sign
      ? { signers: d.sign.company_signers, partnerSigns: d.sign.partner_signs, order: d.sign.order }
      : null,
    partnerSend: d.partner_send ?? false,
    ownerCanOverride: d.owner_can_override ?? true,
    ownerGroupName: d.owner_group_name ?? null,
    steps: d.steps.map((s, i) => ({
      key: `s${i}`,
      name: s.name,
      department: s.department_name,
      kind: s.kind,
      when: s.when ?? null,
      dueH: s.due_h ?? null,
      remindH: s.remind_every_h ?? null,
      escalateGroup: s.escalate_group_name ?? null,
      approverCount: s.approver_count ?? null,
      escalateDefault: s.escalate_default ?? false,
      escalateMissing: s.escalate_group_missing === true,
    })),
  };
}

/** CR-113 · số liệu cho hộp "Luật duyệt": tên nhóm Toàn quyền, nhóm nhận khi quá hạn (các tên khác nhau, theo thứ tự bước). */
export function ruleFacts(flow: CurrentFlow): {
  owner: boolean;
  ownerGroup: string | null;
  hasDue: boolean;
  targets: string[];
} {
  const due = flow.steps.filter((s) => s.dueH !== null);
  const targets = [...new Set(due.map((s) => s.escalateGroup).filter((g): g is string => !!g))];
  return {
    owner: flow.ownerCanOverride,
    ownerGroup: flow.ownerGroupName,
    hasDue: due.length > 0,
    targets,
  };
}

function cmp(op: "ge" | "gt" | "le" | "lt", v: number, t: number): boolean {
  return op === "ge" ? v >= t : op === "gt" ? v > t : op === "le" ? v <= t : v < t;
}
function hit(c: FlowCond | FlowCondGroup, f: Facts): boolean {
  if (!("field" in c)) return holds(c, f);
  if (c.field === "deal") return c.in.length === 0 || c.in.includes(f.deal);
  // CR-121 D-0 · xem trước chỉ có loại + giá trị: trường khác chưa có dữ liệu ⇒ bước vẫn chạy.
  if (c.field !== "total_value") return true;
  if (f.value === null || !Number.isFinite(f.value)) return true;
  return cmp(c.op, f.value, c.value);
}
function holds(w: FlowWhen | FlowCondGroup, f: Facts): boolean {
  const hits = w.conds.map((c) => hit(c, f));
  return w.op === "or" ? hits.some(Boolean) : hits.every(Boolean);
}
const applies = (s: CurrentStep, f: Facts): boolean => {
  const w = s.when;
  if (!w || w.conds.length === 0) return true;
  return holds(w, f);
};

/** Bước nào chạy / bị bỏ qua với `facts` (bước đầu luôn chạy). */
export function previewPath(steps: readonly CurrentStep[], facts: Facts): boolean[] {
  return steps.map((s, i) => i === 0 || applies(s, facts));
}
