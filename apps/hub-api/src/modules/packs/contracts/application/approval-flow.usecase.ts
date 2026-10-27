// contract-flow S2 · đọc/lưu mẫu luồng duyệt HĐ của tenant. Đọc: mẫu đã lưu, hoặc mẫu mặc định dựng từ `approval_settings`
// (`is_default`, version 1). Lưu: luật chéo bước → nhóm (duyệt + chuyển cấp) phải có ở tenant → ghi có khoá lạc quan (version +1)
// → đồng bộ def engine qua cổng `FlowDefSync` (S3a; vắng ⇒ bỏ qua). Lớp 2: chỉ cổng.
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import {
  type ApprovalFlowIssue,
  type ApprovalFlowResponse,
  type DifyWorkflow,
  defaultFlowFromSettings,
  type FlowStep,
  flowGroupIds,
  flowUserIds,
  hasDifyStep,
  validateDifyCatalog,
  validateFlow,
} from "../domain/approval-flow.rules";

export type StoredFlow = { version: number; steps: FlowStep[]; updatedAt: string };
export type ApprovalFlowRepo = {
  settings(): Promise<ApprovalSettings>;
  /** S3b · phút từ 2020-01-01 tới lần lưu cài đặt duyệt gần nhất (0 khi chưa lưu) — version def của mẫu mặc định. */
  settingsRev(): Promise<number>;
  flow(): Promise<StoredFlow | null>;
  /** Khoá lạc quan: `expected` lệch ⇒ null. */
  save(steps: readonly FlowStep[], expected: number, actor: string): Promise<StoredFlow | null>;
};
export type ApprovalFlowTxRepos = { approvalFlow: ApprovalFlowRepo };

/** Group của tenant: id theo khoá (mẫu mặc định) + id nào còn tồn tại (kiểm khi lưu). */
export type FlowGroups = {
  idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
  existingIds(tenantId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
  /** S3b · Group của tenant (id + tên) cho `GET /pack/contracts/groups`. */
  list?(tenantId: string): Promise<{ id: string; name: string }[]>;
};
/** Seam S3a: đẩy def engine `contracts-approval` khi version đổi (`port.ensureDef`). */
export type FlowDefSync = {
  sync(who: PackWho, flow: { version: number; steps: readonly FlowStep[] }): Promise<void>;
};
/** cf-dify · workflow Dify trong catalog mà tenant được dùng (admin.workflows ∧ công tắc tenant). */
export type FlowWorkflows = (tenantId: string) => Promise<DifyWorkflow[]>;
export type ApprovalFlowDeps = {
  uow: PackUow<ApprovalFlowTxRepos>;
  groups: FlowGroups;
  defSync?: FlowDefSync;
  /** Vắng ⇒ không kiểm catalog (engine không nối). */
  workflows?: FlowWorkflows;
  /** esign-flow · người cụ thể thuộc tenant + quyền `write` gói (trả tập id hợp lệ). */
  members?: FlowMembers;
};
export type FlowMembers = (who: PackWho, ids: readonly string[]) => Promise<ReadonlySet<string>>;

/** `GET /dify-workflows`: danh sách chọn cho bước Dify (chỉ khoá + tên). */
export function listDifyWorkflows(d: Pick<ApprovalFlowDeps, "workflows">) {
  return async (who: PackWho): Promise<{ items: { key: string; name: string }[] }> => {
    const all = d.workflows ? await d.workflows(who.tenantId) : [];
    return { items: all.map((w) => ({ key: w.key, name: w.name })) };
  };
}

/** esign-flow · người cụ thể (duyệt/ký) phải thuộc tenant + có quyền `write` gói; không có cổng ⇒ mọi người cụ thể bị từ chối
 *  (fail-closed). */
async function userIssues(
  d: ApprovalFlowDeps,
  who: PackWho,
  steps: readonly FlowStep[],
): Promise<ApprovalFlowIssue[]> {
  const refs = flowUserIds(steps);
  if (refs.length === 0) return [];
  const ok = d.members ? await d.members(who, [...new Set(refs.map((r) => r.id))]) : new Set();
  return refs.filter((r) => !ok.has(r.id)).map((r) => ({ path: r.path, rule: "USER_NOT_MEMBER" }));
}

export type SaveFlowOutcome =
  | { kind: "ok"; flow: ApprovalFlowResponse }
  | { kind: "invalid"; issues: ApprovalFlowIssue[] }
  | { kind: "group_missing" }
  | { kind: "conflict"; current: ApprovalFlowResponse };

const stored = (f: StoredFlow): ApprovalFlowResponse => ({
  version: f.version,
  is_default: false,
  steps: f.steps,
  updated_at: f.updatedAt,
});

/** Đã lưu ⇒ trả luôn; chưa ⇒ mẫu mặc định (Group theo khoá đọc SAU tx, cache — không giữ kết nối tx khi gọi lõi). */
export function readApprovalFlow(d: ApprovalFlowDeps) {
  return async (who: PackWho): Promise<ApprovalFlowResponse> => {
    const got = await d.uow.tenant(who, async (r) => {
      const f = await r.approvalFlow.flow();
      return f ? { f, s: null } : { f: null, s: await r.approvalFlow.settings() };
    });
    if (got.f) return stored(got.f);
    const ids = await d.groups.idsOf(who.tenantId, [got.s.level1GroupKey, got.s.level2GroupKey]);
    const steps = defaultFlowFromSettings(got.s, ids);
    return { version: 1, is_default: true, steps, updated_at: null };
  };
}

export function saveApprovalFlow(d: ApprovalFlowDeps) {
  return async (
    who: PackWho,
    body: { version: number; steps: FlowStep[] },
  ): Promise<SaveFlowOutcome> => {
    const issues = validateFlow(body.steps);
    if (d.workflows && hasDifyStep(body.steps))
      issues.push(...validateDifyCatalog(body.steps, await d.workflows(who.tenantId)));
    issues.push(...(await userIssues(d, who, body.steps)));
    if (issues.length > 0) return { kind: "invalid", issues };
    const want = flowGroupIds(body.steps);
    const have = await d.groups.existingIds(who.tenantId, want);
    if (want.some((id) => !have.has(id))) return { kind: "group_missing" };
    const f = await d.uow.tenant(who, (r) =>
      r.approvalFlow.save(body.steps, body.version, who.userId),
    );
    if (!f) return { kind: "conflict", current: await readApprovalFlow(d)(who) };
    if (d.defSync) await d.defSync.sync(who, { version: f.version, steps: f.steps });
    return { kind: "ok", flow: stored(f) };
  };
}
