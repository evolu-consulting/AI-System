// CR-105 L4 · `GET /approval-flow` CHỈ ĐỌC: quy trình đang dùng của tenant (khe `contracts.approval`: gán ⇒ mặc định; `resolveSlot`),
// phòng ban theo TÊN (mã Group ⇒ id theo tenant ⇒ tên). Không còn lưu mẫu (PUT bỏ; sửa ở ai-admin). Cũng giữ `GET /dify-workflows`
// và các kiểu cổng dùng chung (`FlowGroups`, `FlowMembers`). Lớp 2: chỉ cổng.
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import type { DifyWorkflow } from "../domain/approval-flow.rules";
import type { FlowWhen } from "../domain/approval-flow.types";
import { APPROVAL_SLOT, slotBodyOf, slotGroupKeys } from "../domain/approval-slot.rules";
import type { ApprovalEngineBridge } from "./approval-engine.ports";

export type ApprovalFlowRepo = {
  settings(): Promise<ApprovalSettings>;
};
export type ApprovalFlowTxRepos = { approvalFlow: ApprovalFlowRepo };

/** Group của tenant: id theo khoá (phân giải mã) + id nào còn tồn tại. */
export type FlowGroups = {
  idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  existingIds(tenantId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** S3b · Group của tenant (id + tên) cho `GET /pack/contracts/groups`. */
  list?(tenantId: string): Promise<{ id: string; name: string }[]>;
};
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
  kind: "review" | "dify" | "esign";
  when?: FlowWhen | null;
};
export type CurrentFlow = {
  def_id: string;
  name: string;
  rel_version: number;
  is_default: boolean;
  steps: CurrentFlowStep[];
};

/** Quy trình đang dùng cho tenant của `who`; khe chưa có bản xuất bản áp được / engine không nối ⇒ null (route trả 404). */
export function readCurrentFlow(d: Pick<ApprovalFlowDeps, "engine" | "groups">) {
  return async (who: PackWho): Promise<CurrentFlow | null> => {
    const port = d.engine?.port;
    if (!port?.resolveSlot) return null;
    const r = await port.resolveSlot(who.tenantId, APPROVAL_SLOT);
    const body = r ? slotBodyOf(r.slotBody) : null;
    if (!r || !body) return null;
    const keys = slotGroupKeys(body);
    const [ids, list] = await Promise.all([
      keys.length > 0 ? d.groups.idsOf(who.tenantId, keys) : new Map<string, string>(),
      keys.length > 0 && d.groups.list ? d.groups.list(who.tenantId) : [],
    ]);
    const names = new Map(list.map((g) => [g.id, g.name]));
    // Group bị xoá sau khi gán ⇒ giữ mã để người xem vẫn thấy bước dùng phòng nào.
    const deptName = (k: string | null | undefined): string | null => {
      if (!k) return null;
      const id = ids.get(k);
      return (id ? names.get(id) : undefined) ?? k;
    };
    const steps = body.steps.map((s): CurrentFlowStep => {
      if (s.kind === "dify") return { name: s.name, department_name: null, kind: "dify" };
      if (s.kind === "esign")
        return {
          name: s.name,
          department_name: deptName(s.company_signer.department_group_key),
          kind: "esign",
        };
      return {
        name: s.name,
        department_name: deptName(s.department_group_key),
        kind: "review",
        when: s.when ?? null,
      };
    });
    return {
      def_id: r.defId,
      name: r.name,
      rel_version: r.relVersion,
      is_default: r.isDefault === true,
      steps,
    };
  };
}
