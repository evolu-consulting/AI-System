// CR-105 L4 · `GET /approval-flow` CHỈ ĐỌC: quy trình đang dùng của tenant (khe `contracts.approval`: gán ⇒ mặc định; `resolveSlot`),
// phòng ban theo TÊN (mã Group ⇒ id theo tenant ⇒ tên). Không còn lưu mẫu (PUT bỏ; sửa ở ai-admin). Cũng giữ `GET /dify-workflows`
// và các kiểu cổng dùng chung (`FlowGroups`, `FlowMembers`). Lớp 2: chỉ cổng.
import type { PackUow, PackWho } from "../../kit/public";
import { type ApprovalSettings, PACK_OWNER_GROUP_KEY } from "../domain/approval-def.rules";
import type { DifyWorkflow } from "../domain/approval-flow.rules";
import type { FlowWhen } from "../domain/approval-flow.types";
import { defaultEscalateOf, escalateOrder } from "../domain/approval-owner.rules";
import { APPROVAL_SLOT, slotBodyOf, slotGroupKeys } from "../domain/approval-slot.rules";
import type { ApprovalEngineBridge } from "./approval-engine.ports";
import type { ApprovalFlowTxRepos, FlowGroups } from "./approval-flow.ports";

export type { ApprovalFlowRepo, ApprovalFlowTxRepos, FlowGroups } from "./approval-flow.ports";

/** cf-dify · workflow Dify trong catalog mà tenant được dùng (admin.workflows ∧ công tắc tenant). */
export type FlowWorkflows = (tenantId: string) => Promise<DifyWorkflow[]>;
export type ApprovalFlowDeps = {
  uow: PackUow<ApprovalFlowTxRepos>;
  groups: FlowGroups;
  /** Vắng ⇒ không kiểm catalog (engine không nối). */
  workflows?: FlowWorkflows;
  /** Cầu engine (`resolveSlot` qua cổng, lười). */
  engine?: ApprovalEngineBridge | undefined;
  /** esign-flow · người cụ thể thuộc tenant + quyền `write` gói (trả tập id hợp lệ). */
  members?: FlowMembers;
};
export type FlowMembers = (who: PackWho, ids: readonly string[]) => Promise<ReadonlySet<string>>;

export type DifyWorkflowListItem = {
  key: string;
  name: string;
  inputs: {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    options?: string[];
  }[];
};
/** `GET /dify-workflows`: danh sách chọn cho bước Dify (khoá, tên, tham số để ánh xạ trường HĐ). */
export function listDifyWorkflows(d: Pick<ApprovalFlowDeps, "workflows">) {
  return async (who: PackWho): Promise<{ items: DifyWorkflowListItem[] }> => {
    const all = d.workflows ? await d.workflows(who.tenantId) : [];
    return {
      items: all.map((w) => ({
        key: w.key,
        name: w.name,
        inputs: w.params.map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          ...(p.description ? { description: p.description.slice(0, 500) } : {}),
          ...(p.options ? { options: [...p.options] } : {}),
        })),
      })),
    };
  };
}

export type CurrentFlowStep = {
  name: string;
  department_name: string | null;
  kind: "review" | "dify" | "esign" | "notify" | "wait_until";
  when?: FlowWhen | null;
  /** CR-108 · hạn xử lý (giờ), nhắc mỗi (giờ), nhóm nhận khi quá hạn (tên), số người duyệt còn dùng được — vắng ⇒ không hiện. */
  due_h?: number;
  remind_every_h?: number;
  escalate_group_name?: string | null;
  approver_count?: number;
  /** CR-113 · nhóm nhận khi quá hạn là mặc định Toàn quyền (bước có hạn, không đặt nhóm chuyển cấp). */
  escalate_default?: boolean;
  /** CR-113 (review) · nhóm chuyển cấp đặt tường minh đã bị xoá ở tenant ⇒ lỗi cấu hình (lượt mới sẽ kẹt FLOW_GROUP_MISSING). */
  escalate_group_missing?: true;
};
export type CurrentFlow = {
  def_id: string;
  name: string;
  rel_version: number;
  is_default: boolean;
  steps: CurrentFlowStep[];
  /** CR-113 · chủ gói duyệt thay được mọi bước (ghi rõ "duyệt thay"); tên Group Toàn quyền (đích chuyển cấp mặc định). */
  owner_can_override: true;
  owner_group_name: string | null;
};

/** CR-113 · mã Group cấp 2 của cài đặt (Toàn quyền thứ hai); không có uow ⇒ chỉ Group vai owner. */
async function level2KeyOf(
  d: Partial<Pick<ApprovalFlowDeps, "uow">>,
  who: PackWho,
): Promise<string> {
  if (!d.uow) return "";
  return (await d.uow.tenant(who, (r) => r.approvalFlow.settings())).level2GroupKey;
}

type ReviewSlotStep = {
  due_h?: number;
  department_group_key?: string | null;
  escalate_group_key?: string | null;
  approver_user_id?: string | null;
};
const NAME_MAX = 200;
/** CR-113 · tên Group Toàn quyền + chuyển cấp mặc định của bước duyệt — CÙNG luật `compileDef`: Group gắn task = phòng của bước;
 *  người cụ thể không phòng ⇒ Toàn quyền đầu tiên theo `escalateOrder` (như `ownerGroupIds` của engine); đặt tường minh thắng;
 *  review · nhóm chuyển cấp đặt tường minh mà Group đã xoá ⇒ lỗi cấu hình (`escalate_group_missing`, compileDef ném
 *  `approval-flow-group-missing`), KHÔNG rơi về mặc định. */
export function ownerView(
  ids: ReadonlyMap<string, string>,
  names: ReadonlyMap<string, string>,
  level2Key: string,
) {
  const owners = escalateOrder(ids, level2Key);
  const set = new Set(owners);
  const nameOf = (g: string) => names.get(g)?.slice(0, NAME_MAX) ?? null;
  const escalate = (s: ReviewSlotStep) => {
    if (s.escalate_group_key)
      return ids.has(s.escalate_group_key)
        ? { escalate_default: false }
        : { escalate_default: false, escalate_group_missing: true as const };
    const dept = ids.get(s.department_group_key ?? "") ?? null;
    const group = dept ?? (s.approver_user_id ? (owners[0] ?? null) : null);
    const g = defaultEscalateOf({ due_h: s.due_h ?? null }, group, owners, set);
    return g
      ? { escalate_group_name: nameOf(g), escalate_default: true }
      : { escalate_default: false };
  };
  return { name: owners[0] ? nameOf(owners[0]) : null, escalate };
}

/** Quy trình đang dùng cho tenant của `who`; khe chưa có bản xuất bản áp được / engine không nối ⇒ null (route trả 404). */
export function readCurrentFlow(
  d: Pick<ApprovalFlowDeps, "engine" | "groups"> & Partial<Pick<ApprovalFlowDeps, "uow">>,
) {
  return async (who: PackWho): Promise<CurrentFlow | null> => {
    const port = d.engine?.port;
    if (!port?.resolveSlot) return null;
    const r = await port.resolveSlot(who.tenantId, APPROVAL_SLOT);
    const body = r ? slotBodyOf(r.slotBody) : null;
    if (!r || !body) return null;
    const l2 = await level2KeyOf(d, who);
    const keys = [...new Set([...slotGroupKeys(body), PACK_OWNER_GROUP_KEY, ...(l2 ? [l2] : [])])];
    const [ids, list] = await Promise.all([
      d.groups.idsOf(who.tenantId, keys),
      d.groups.list ? d.groups.list(who.tenantId) : [],
    ]);
    const names = new Map(list.map((g) => [g.id, g.name]));
    const own = ownerView(ids, names, l2);
    // Group bị xoá sau khi gán ⇒ giữ mã để người xem vẫn thấy bước dùng phòng nào.
    const deptName = (k: string | null | undefined): string | null => {
      if (!k) return null;
      const id = ids.get(k);
      return (id ? names.get(id) : undefined) ?? k;
    };
    // CR-108 · số người duyệt: MỘT câu cho mọi nhóm duyệt của bước (không truy vấn từng bước).
    const approverKey = (s: (typeof body.steps)[number]): string | null | undefined =>
      s.kind === "review"
        ? s.department_group_key
        : s.kind === "esign"
          ? s.company_signer.department_group_key
          : null;
    const deptIds = [
      ...new Set(body.steps.map(approverKey).flatMap((k) => ids.get(k ?? "") ?? [])),
    ];
    const counts =
      deptIds.length > 0 && d.groups.memberCounts
        ? await d.groups.memberCounts(who.tenantId, deptIds)
        : new Map<string, number>();
    const timing = (s: { due_h?: number; remind_every_h?: number | null }, ek?: string | null) => ({
      ...(typeof s.due_h === "number" ? { due_h: s.due_h } : {}),
      ...(typeof s.remind_every_h === "number" ? { remind_every_h: s.remind_every_h } : {}),
      ...(ek && ids.has(ek) ? { escalate_group_name: deptName(ek) } : {}),
    });
    const approvers = (k: string | null | undefined, user?: string | null) => {
      const n = user ? 1 : counts.get(ids.get(k ?? "") ?? "");
      return n === undefined ? {} : { approver_count: n };
    };
    const steps = body.steps.map((s): CurrentFlowStep => {
      if (s.kind === "dify") return { name: s.name, department_name: null, kind: "dify" };
      // CR-121 D-6 · Thông báo (phòng nhận theo mã) / Chờ tới (không phòng).
      if (s.kind === "notify")
        return { name: s.name, department_name: deptName(s.to.group_key), kind: "notify" };
      if (s.kind === "wait_until")
        return { name: s.name, department_name: null, kind: "wait_until" };
      if (s.kind === "esign")
        return {
          name: s.name,
          department_name: deptName(s.company_signer.department_group_key),
          kind: "esign",
          ...timing(s, s.escalate_group_key),
        };
      return {
        name: s.name,
        department_name: deptName(s.department_group_key),
        kind: "review",
        when: s.when ?? null,
        ...timing(s, s.escalate_group_key),
        ...own.escalate(s),
        ...approvers(s.department_group_key, s.approver_user_id),
      };
    });
    return {
      def_id: r.defId,
      name: r.name,
      rel_version: r.relVersion,
      is_default: r.isDefault === true,
      steps,
      owner_can_override: true,
      owner_group_name: own.name,
    };
  };
}
