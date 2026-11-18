// CR-105 L4 · `GET /approval-flow` CHỈ ĐỌC: quy trình đang dùng của tenant (khe `contracts.approval`: gán ⇒ mặc định; `resolveSlot`),
// phòng ban theo TÊN (mã Group ⇒ id theo tenant ⇒ tên). Không còn lưu mẫu (PUT bỏ; sửa ở ai-admin). Cũng giữ `GET /dify-workflows`
// và các kiểu cổng dùng chung (`FlowGroups`, `FlowMembers`). Lớp 2: chỉ cổng.

import { type RoleAssignment, withRoles } from "@ai/contracts/flow";
import { type FactWhen, FactWhenSchema } from "@ai/contracts/hub-admin";
import type { ApprovalFlowGraphStage } from "@ai/contracts/pack-contracts";
import type { EventFlow, PackUow, PackWho } from "../../kit/public";
import { PACK_OWNER_GROUP_KEY } from "../domain/approval-def.rules";
import type { DifyWorkflow } from "../domain/approval-flow.rules";
import type { FlowWhen } from "../domain/approval-flow.types";
import { defaultEscalateOf, escalateOrder } from "../domain/approval-owner.rules";
import { type GraphStage, graphOfStages } from "../domain/event-flow-graph.rules";
import {
  type EventStep,
  type SignPartnerView,
  signPartnerOf,
  stepsOfStages,
} from "../domain/event-flow-steps.rules";
import type { ApprovalEngineBridge } from "./approval-engine.ports";
import type { ApprovalFlowTxRepos, FlowGroups } from "./approval-flow.ports";
import { assignedIdsOf, assignedOf, membersOf } from "./approval-flow-roles.usecase";

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
  steps: CurrentFlowStep[];
  /** CR-125 · S2 · flow có node Nếu (rẽ nhánh) ⇒ danh sách bước là các bước CÓ THỂ chạy, không phải một đường đi. */
  has_branches: boolean;
  /** CR-146 · thứ tự xét, «Bắt đầu khi» (FactWhen), tên Group trong điều kiện, khối ký / đối tác (chỉ xem). */
  position: number;
  start_when: FactWhen | null;
  /** fix-review-r1 · điều kiện đã lưu không đọc được (sai dạng) ⇒ `start_when` = null + cờ này (UI hiện «Không đọc được điều kiện»). */
  start_when_unreadable?: true;
  group_names: Record<string, string>;
  sign: {
    company_signers: { kind: "user" | "group"; name: string | null }[];
    partner_signs: boolean | null;
    order: "parallel" | "sequential" | null;
    /** CR-184 · «Ký qua» của bước Ký. */
    provider?: string | null;
  } | null;
  /** CR-184 · MỌI stage của flow để vẽ sơ đồ đầy đủ (chỉ thêm; `steps` giữ nguyên). */
  graph: ApprovalFlowGraphStage[];
  partner_send: boolean;
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

/** CR-125 · S2 · sự kiện của flow duyệt hợp đồng (cùng sự kiện tab Quy trình ở admin và bộ điều phối). */
export const CONTRACT_FLOW_EVENT = "contract.submitted";

/** Phần dữ liệu dùng chung mọi flow (một lần cho cả danh sách): tên Group, số người duyệt, tên người ký, chủ gói. */
type FlowLookups = {
  ids: ReadonlyMap<string, string>;
  names: ReadonlyMap<string, string>;
  counts: ReadonlyMap<string, number>;
  users: ReadonlyMap<string, string>;
  ownerName: string | null;
  /** CR-182 · thành viên của các Group được giao cho vai (id Group ⇒ người). */
  members: ReadonlyMap<string, { id: string; name: string }[]>;
};

const DEPT_FACT = /department|group/;
/** Mã Group xuất hiện trong «Bắt đầu khi» (dữ kiện phòng/nhóm) ⇒ UI hiện tên, không lộ mã. */
function whenCodes(w: unknown): string[] {
  const o = w as { fact?: string; value?: unknown; conds?: unknown[] } | null;
  if (Array.isArray(o?.conds)) return o.conds.flatMap(whenCodes);
  if (typeof o?.fact !== "string" || !DEPT_FACT.test(o.fact)) return [];
  return (Array.isArray(o.value) ? o.value : [o.value]).filter(
    (v): v is string => typeof v === "string",
  );
}

/**
 * CR-146 · `GET /approval-flow` = MỌI flow Bật của công ty cho `contract.submitted` theo `position` (CÙNG nguồn + thứ tự bộ điều phối
 * `candidatesOf`, `match.rules.ts`). Số câu SQL CỐ ĐỊNH (không theo số flow): eventFlows 1 + cài đặt cấp 2 + idsOf + list Group + số
 * người duyệt + tên người ký (≤ 6). Phòng ban theo TÊN. Flow có node Nếu ⇒ `has_branches`. Chưa có flow Bật / engine không nối ⇒ `items: []`.
 */
export function readCurrentFlows(
  d: Pick<ApprovalFlowDeps, "engine" | "groups"> &
    Partial<Pick<ApprovalFlowDeps, "uow">> & {
      userNames?: (who: PackWho, ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
    },
) {
  return async (who: PackWho): Promise<{ items: CurrentFlow[] }> => {
    const flows = (await d.engine?.port?.eventFlows?.(who.tenantId, CONTRACT_FLOW_EVENT)) ?? [];
    if (flows.length === 0) return { items: [] };
    // CR-182 · R2 · màn xem giải vai như lúc chạy (thuần, 0 SQL: giao việc đã đọc cùng câu `eventFlows`) ⇒ tên phòng/người ký khớp giao việc.
    const parsed = flows.map((f) => {
      const stages = withRoles(f.stages, f.assignments ?? []).stages;
      return {
        f,
        ...stepsOfStages(stages),
        sp: signPartnerOf(stages),
        graph: graphOfStages(stages),
        codes: whenCodes(f.when),
      };
    });
    const assigned = assignedIdsOf(flows);
    const l2 = await level2KeyOf(d, who);
    const codes = [
      ...new Set(
        parsed.flatMap((p) => [
          ...p.steps.flatMap((s) => (s.groupKey ? [s.groupKey] : [])),
          ...p.codes,
        ]),
      ),
    ];
    const keys = [...new Set([...codes, PACK_OWNER_GROUP_KEY, ...(l2 ? [l2] : [])])];
    const userIds = [
      ...new Set([
        ...assigned.users,
        ...parsed.flatMap((p) =>
          (p.sp.esign?.signers ?? []).flatMap((x) => (x.kind === "user" ? [x.id] : [])),
        ),
      ]),
    ];
    const [ids, list, users, members] = await Promise.all([
      d.groups.idsOf(who.tenantId, keys),
      d.groups.list ? d.groups.list(who.tenantId) : [],
      userIds.length > 0 && d.userNames ? d.userNames(who, userIds) : new Map<string, string>(),
      membersOf(d.groups, who.tenantId, assigned.groups),
    ]);
    const names = new Map(list.map((g) => [g.id, g.name]));
    const idOf = (s: { groupId: string | null; groupKey: string | null }) =>
      s.groupId ?? ids.get(s.groupKey ?? "") ?? null;
    const deptIds = [
      ...new Set(
        parsed.flatMap((p) => p.steps.flatMap((s) => (s.kind === "review" ? (idOf(s) ?? []) : []))),
      ),
    ];
    const counts =
      deptIds.length > 0 && d.groups.memberCounts
        ? await d.groups.memberCounts(who.tenantId, deptIds)
        : new Map<string, number>();
    const lk: FlowLookups = {
      ids,
      names,
      counts,
      users,
      ownerName: ownerView(ids, names, l2).name,
      members,
    };
    return { items: parsed.map((p) => currentOf(p, lk, idOf)) };
  };
}

/** `when` lưu trong flow → `FactWhen`. Vắng ⇒ null (mọi hợp đồng còn lại); sai dạng ⇒ null + cờ (KHÔNG ép kiểu, KHÔNG nói «mọi hợp đồng»). */
export function readStartWhen(raw: unknown): {
  start_when: FactWhen | null;
  start_when_unreadable?: true;
} {
  if (raw === null || raw === undefined) return { start_when: null };
  const r = FactWhenSchema.safeParse(raw);
  return r.success ? { start_when: r.data } : { start_when: null, start_when_unreadable: true };
}

/** CR-185 · trường để Sổ Hợp Tác gộp cụm node module / vẽ nhãn Kết thúc như trang quản trị (chỉ khi có). */
const moduleFields = (g: GraphStage) => ({
  ...(g.node ? { node: g.node } : {}),
  ...(g.exec ? { exec: g.exec } : {}),
  ...(g.waitBranches.length > 0 ? { wait_branches: g.waitBranches } : {}),
  ...(g.outcome ? { outcome: g.outcome } : {}),
});

/** CR-184 · stage của sơ đồ ⇒ dạng trả về: phòng duyệt theo TÊN (không lộ mã), bước đếm từ 0. */
function graphStageOut(
  g: GraphStage,
  idOf: (s: { groupId: string | null; groupKey: string | null }) => string | null,
  lk: FlowLookups,
  by: ReadonlyMap<string, RoleAssignment>,
): ApprovalFlowGraphStage {
  const id = g.kind === "review" ? idOf(g) : null;
  const dept = g.kind === "review" ? ((id ? lk.names.get(id) : undefined) ?? g.groupKey) : null;
  return {
    key: g.key.slice(0, 100),
    step: g.step,
    name: g.name.slice(0, NAME_MAX),
    kind: g.kind,
    department_name: dept ? dept.slice(0, NAME_MAX) : null,
    provider: g.provider,
    after: g.after,
    back_to: g.backTo,
    branch: g.branch,
    yes: g.ifs?.yes ?? null,
    no: g.ifs?.no ?? null,
    next_step: g.nextStep,
    terminal: g.terminal,
    ...(g.needDigital ? { need_digital: true as const } : {}),
    ...moduleFields(g),
    ...(g.role
      ? {
          role: {
            key: g.role.key,
            label: g.role.label.slice(0, 80),
            ...(g.role.groupOnly ? { group_only: true as const } : {}),
          },
          assigned: assignedOf(by.get(g.role.key), lk),
        }
      : {}),
  };
}

function currentOf(
  p: {
    f: EventFlow;
    steps: EventStep[];
    branches: boolean;
    sp: SignPartnerView;
    codes: string[];
    graph: GraphStage[];
  },
  lk: FlowLookups,
  idOf: (s: { groupId: string | null; groupKey: string | null }) => string | null,
): CurrentFlow {
  const steps = p.steps.map((s): CurrentFlowStep => {
    if (s.kind !== "review") return { name: s.name, department_name: null, kind: s.kind };
    const id = idOf(s);
    const n = lk.counts.get(id ?? "");
    return {
      name: s.name,
      department_name: (id ? lk.names.get(id) : undefined) ?? s.groupKey,
      kind: "review",
      ...(n === undefined ? {} : { approver_count: n }),
    };
  });
  const group_names: Record<string, string> = {};
  for (const c of p.codes) {
    const n = lk.names.get(lk.ids.get(c) ?? "");
    if (n) group_names[c] = n.slice(0, NAME_MAX);
  }
  const e = p.sp.esign;
  const byRole = new Map((p.f.assignments ?? []).map((a) => [a.role_key, a]));
  return {
    def_id: p.f.defId,
    name: p.f.name,
    rel_version: p.f.relVersion,
    steps,
    has_branches: p.branches,
    position: p.f.position,
    ...readStartWhen(p.f.when),
    group_names,
    sign: e
      ? {
          company_signers: e.signers.map((x) => ({
            kind: x.kind,
            name: (x.kind === "group" ? lk.names.get(x.id) : lk.users.get(x.id)) ?? null,
          })),
          partner_signs: e.partnerSigns,
          order: e.order,
          provider: e.provider ?? null,
        }
      : null,
    graph: p.graph.map((g) => graphStageOut(g, idOf, lk, byRole)),
    partner_send: p.sp.partnerSend,
    owner_can_override: true,
    owner_group_name: lk.ownerName,
  };
}
