// contract-flow S2/S3 · nối duyệt HĐ trên engine + mẫu luồng (tách khỏi `extraction.mount.ts` giữ trần 400 dòng).
import { logger } from "../../../lib/logger";
import {
  type PackAccessView,
  packAccessInput,
  tenantFeatureOn,
} from "../kit/adapters/pack-guard.middleware";
import type { PackUow, PackWho } from "../kit/application/ports";
import { checkPackAccess } from "../kit/domain/pack-access.rules";
import { approvalEngineTools } from "./adapters/approval-engine.tools";
import { approvalFlowRoutes } from "./adapters/approval-flow.routes";
import type { ApprovalEngineBridge, ApprovalEngineUow } from "./application/approval-engine.ports";
import {
  engineFlowDefSync,
  engineSettingsSync,
  reopenEngineApproval,
  startEngineApproval,
} from "./application/approval-engine.usecase";
import { type EngineCardDeps, engineCard } from "./application/approval-engine-card.usecase";
import {
  type ApprovalFlowTxRepos,
  type FlowDefSync,
  type FlowGroups,
  type FlowMembers,
  listDifyWorkflows,
  readApprovalFlow,
  saveApprovalFlow,
} from "./application/approval-flow.usecase";
import { myApprovals } from "./application/mywork-approvals.usecase";
import { ENGINE_FEATURE_KEY, engineAllowedForTenant } from "./domain/approval-engine.rules";

/** esign-flow · bước Ký số sau "Đã duyệt" (tool finalize; vắng ⇒ không tự gửi ký); người cụ thể (duyệt/ký) thuộc tenant + quyền
 *  `write` gói (kiểm khi lưu mẫu). */
export type EsignHooks = {
  afterApproved?: ((tenantId: string, contractId: string) => Promise<unknown>) | undefined;
  members?: FlowMembers | undefined;
};
type FlowDeps = EsignHooks & {
  engine?: ApprovalEngineBridge | undefined;
  groups: Pick<FlowGroups, "idsOf" | "existingIds" | "list">;
  flowDefSync?: FlowDefSync | undefined;
};

/** contract-flow S3a · duyệt trên engine: cờ `CONTRACTS_APPROVAL_ENGINE=on` (hoặc seam test `on`) + cầu engine có + chế độ flow
 *  (không seam HD2). Tắt ⇒ null (máy 2 bước cũ y nguyên). Cổng engine đọc lười từ cầu mỗi lời gọi (engine gắn sau). */
export function approvalEngine(
  o: {
    on: boolean | undefined;
    hd2: boolean;
    /** engine-flag-tenant · cổng theo công ty (feature `contracts-approval-engine`); false ⇒ không cổng (seam test `on`). */
    gate: boolean;
  },
  flow: FlowDeps,
  uow: ApprovalEngineUow,
  view: PackAccessView,
) {
  const env = process.env.CONTRACTS_APPROVAL_ENGINE;
  const on = o.on ?? env === "on";
  if (!on || !flow.engine || o.hd2) return null;
  const gate = o.gate
    ? async (tenantId: string) =>
        engineAllowedForTenant({
          env: "on",
          entitled: await tenantFeatureOn(view, ENGINE_FEATURE_KEY, tenantId),
        })
    : undefined;
  const ed = {
    bridge: flow.engine,
    uow,
    groups: flow.groups,
    warn: (m: string, meta: Record<string, unknown>) => logger.warn(m, meta),
    afterApproved: flow.afterApproved,
  };
  const isAdmin = async (who: PackWho) => {
    const i = await packAccessInput(view, "contracts", who);
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
  };
  const startRaw = startEngineApproval(ed);
  // Mở lượt MỚI chỉ cho công ty có entitlement; không có ⇒ "machine" (máy 2 bước cũ). Lượt đã engine vẫn chạy nốt (tool/reopen không cổng).
  const start: typeof startRaw = gate
    ? async (who, id) => ((await gate(who.tenantId)) ? startRaw(who, id) : "machine")
    : startRaw;
  return {
    start,
    defSync: engineFlowDefSync(ed),
    settingsSync: engineSettingsSync(ed),
    reopen: reopenEngineApproval(ed),
    tools: approvalEngineTools(ed),
    myApprovals: myApprovals({ port: () => flow.engine?.port, uow }),
    // esign-flow-fix · thẻ duyệt engine; owner gói (quyền `admin`) cũng Gửi lại bước Ký số.
    card: (c: Omit<EngineCardDeps, "isAdmin">) => engineCard({ ...c, isAdmin }),
  };
}

/** contract-flow S2 · `GET|PUT /approval-flow` + S3b `GET /groups` (đồng bộ def engine qua `flowDefSync` khi có — S3a). */
export function flowTemplateRoutes(
  view: PackAccessView,
  uow: PackUow<ApprovalFlowTxRepos>,
  flow: FlowDeps,
) {
  const fd = {
    uow,
    groups: flow.groups,
    ...(flow.flowDefSync ? { defSync: flow.flowDefSync } : {}),
    ...(flow.members ? { members: flow.members } : {}),
    // cf-dify · catalog workflow của tenant qua cổng engine (lười, như `approvalEngine`); engine không nối ⇒ không kiểm.
    ...(flow.engine
      ? { workflows: async (t: string) => (await flow.engine?.port?.workflowsOf(t)) ?? [] }
      : {}),
  };
  const list = flow.groups.list?.bind(flow.groups);
  return approvalFlowRoutes(view, {
    read: readApprovalFlow(fd),
    save: saveApprovalFlow(fd),
    difyWorkflows: listDifyWorkflows(fd),
    ...(list ? { groups: list } : {}),
  });
}
