// contract-flow S2/S3 · nối duyệt HĐ trên engine + mẫu luồng (tách khỏi `extraction.mount.ts` giữ trần 400 dòng).
import { logger } from "../../../lib/logger";
import { type PackAccessView, packAccessInput } from "../kit/adapters/pack-guard.middleware";
import { slotRegistry } from "../kit/adapters/slot-registry";
import type { PackUow, PackWho } from "../kit/application/ports";
import type { SlotSpec } from "../kit/application/slot.ports";
import { checkPackAccess } from "../kit/domain/pack-access.rules";
import { approvalEngineTools } from "./adapters/approval-engine.tools";
import { approvalFlowRoutes } from "./adapters/approval-flow.routes";
import type { ApprovalEngineBridge, ApprovalEngineUow } from "./application/approval-engine.ports";
import { startEngineApproval } from "./application/approval-engine.usecase";
import { type EngineCardDeps, engineCard } from "./application/approval-engine-card.usecase";
import {
  cancelReopenEngineApproval,
  reopenEngineApproval,
  retryEngineApproval,
} from "./application/approval-engine-reopen.usecase";
import {
  type ApprovalFlowTxRepos,
  type FlowGroups,
  type FlowMembers,
  listDifyWorkflows,
  readCurrentFlow,
} from "./application/approval-flow.usecase";
import { myApprovals } from "./application/mywork-approvals.usecase";
import { engineAllowedForTenant } from "./domain/approval-engine.rules";
import { FLOW_TOOL_KEYS } from "./domain/approval-flow.rules";
import type { FlowDeal, FlowStep } from "./domain/approval-flow.types";
import {
  conditionDepartmentKeys,
  previewPath,
  validateApprovalBody,
} from "./domain/approval-flow-stages.rules";
import {
  APPROVAL_SLOT,
  APPROVAL_SLOT_LABEL,
  compileSlotStages,
  slotBodyOf,
  slotGroupKeys,
} from "./domain/approval-slot.rules";
import { APPROVAL_SLOT_FIELDS, APPROVAL_SLOT_NODES } from "./domain/approval-slot-catalog.rules";
import { slotBodyFromStages } from "./domain/approval-slot-default.rules";

/** esign-flow · bước Ký số sau "Đã duyệt" (tool finalize; vắng ⇒ không tự gửi ký); người cụ thể (duyệt/ký) thuộc tenant + quyền
 *  `write` gói (kiểm khi lưu mẫu). */
export type EsignHooks = {
  afterApproved?: ((tenantId: string, contractId: string) => Promise<unknown>) | undefined;
  members?: FlowMembers | undefined;
};
type FlowDeps = EsignHooks & {
  engine?: ApprovalEngineBridge | undefined;
  groups: Pick<FlowGroups, "idsOf" | "existingIds" | "list" | "memberCounts">;
};

/** contract-flow S3a · duyệt trên engine: cờ `CONTRACTS_APPROVAL_ENGINE=on` (hoặc seam test `on`) + cầu engine có + chế độ flow
 *  (không seam HD2). Tắt ⇒ null (máy 2 bước cũ y nguyên). Cổng engine đọc lười từ cầu mỗi lời gọi (engine gắn sau). */
export function approvalEngine(
  o: {
    on: boolean | undefined;
    hd2: boolean;
    /** CR-121 D-4 · cổng theo công ty = đã gán quy trình cho khe duyệt HĐ (không còn feature); false ⇒ không cổng (seam test `on`). */
    gate: boolean;
  },
  flow: FlowDeps,
  uow: ApprovalEngineUow,
  view: PackAccessView,
) {
  const env = process.env.CONTRACTS_APPROVAL_ENGINE;
  const on = o.on ?? env === "on";
  if (!on || !flow.engine || o.hd2) return null;
  // CR-121 D-4 · cổng = công ty đã gán quy trình cho khe duyệt HĐ (MỘT câu `slotAssigned`, chỉ ở lúc mở lượt mới); không đọc feature.
  const gate = o.gate
    ? async (tenantId: string) =>
        engineAllowedForTenant({
          env: "on",
          assigned: (await flow.engine?.port?.slotAssigned?.(tenantId, APPROVAL_SLOT)) === true,
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
  // Mở lượt MỚI chỉ cho công ty đã gán quy trình; chưa gán ⇒ "machine" (máy 2 bước cũ). Lượt đã engine vẫn chạy nốt (tool/reopen không cổng).
  const start: typeof startRaw = gate
    ? async (who, id) => ((await gate(who.tenantId)) ? startRaw(who, id) : "machine")
    : startRaw;
  // CR-121 D-4 · gán ⇒ engine chạy, nên không còn ca "đã gán mà không chạy" để báo (trước đây ghi chú vì thiếu feature). Giữ chữ ký cho
  // `extraction.mount.ts` / `approval.usecase.ts` (ngoài lát này); phần A gỡ hẳn cờ `engine_off` cùng máy cũ.
  const engineOff = async (_who: PackWho, _startedBy: string): Promise<boolean> => false;
  return {
    start,
    engineOff,
    reopen: reopenEngineApproval(ed),
    retry: retryEngineApproval(ed), // CR-107
    cancelReopen: cancelReopenEngineApproval(ed),
    tools: approvalEngineTools(ed),
    myApprovals: myApprovals({ port: () => flow.engine?.port, uow }),
    // esign-flow-fix · thẻ duyệt engine; owner gói (quyền `admin`) cũng Gửi lại bước Ký số.
    // CR-113 · tên Group cho "chuyển cấp tới" + log lỗi ghi "duyệt thay".
    card: (c: Omit<EngineCardDeps, "isAdmin">) =>
      engineCard({
        ...c,
        isAdmin,
        warn: ed.warn,
        ...(flow.groups.list
          ? { groupNames: async (t: string) => (await flow.groups.list?.(t)) ?? [] }
          : {}),
      }),
  };
}

/** CR-105 · khe `contracts.approval` ("Sổ Hợp Tác · Duyệt hợp đồng") cho thư viện quy trình: `compile` = `compileDef` trên mã Group. */
export const approvalSlotSpec: SlotSpec = {
  key: APPROVAL_SLOT,
  label: APPROVAL_SLOT_LABEL,
  packKey: "contracts",
  fields: APPROVAL_SLOT_FIELDS,
  nodes: APPROVAL_SLOT_NODES,
  requiredInputs: ["contract-id"],
  systemTools: [FLOW_TOOL_KEYS.route, FLOW_TOOL_KEYS.finalize],
  validate: validateApprovalBody,
  compile: compileSlotStages,
  // CR-121 D-2 · mã phòng ban trong điều kiện cũng phải có ở công ty khi gán (cùng một câu kiểm Group).
  groupKeys: (b) => {
    const body = slotBodyOf(b);
    if (!body) return [];
    const steps = body.steps as unknown as FlowStep[];
    return [...new Set([...slotGroupKeys(body), ...conditionDepartmentKeys(steps)])];
  },
  preview: (b, i) => {
    const body = slotBodyOf(b);
    if (!body) return null;
    const steps = body.steps as unknown as FlowStep[];
    const path = previewPath(
      { steps },
      {
        contractType: (i.contractType ?? null) as FlowDeal | null,
        value: i.value ?? null,
        creatorDepartments: i.creatorDepartments,
        newPartner: i.newPartner,
      },
    );
    return path.map((p) => ({
      key: p.key,
      name: steps[p.index]?.name ?? p.key,
      run: p.run,
      state: p.state,
    }));
  },
  fromStages: slotBodyFromStages,
};

/** CR-105 L4 · `GET /approval-flow` (chỉ đọc, quy trình đang dùng) + S3b `GET /groups` + `GET /dify-workflows`. */
export function flowTemplateRoutes(
  view: PackAccessView,
  uow: PackUow<ApprovalFlowTxRepos>,
  flow: FlowDeps,
) {
  slotRegistry.register(approvalSlotSpec); // CR-105 · gói bật ⇒ khe đăng ký (đăng ký lại cùng khoá ⇒ thay)
  const fd = {
    uow,
    groups: flow.groups,
    engine: flow.engine,
    ...(flow.members ? { members: flow.members } : {}),
    // cf-dify · catalog workflow của tenant qua cổng engine (lười, như `approvalEngine`); engine không nối ⇒ không kiểm.
    ...(flow.engine
      ? { workflows: async (t: string) => (await flow.engine?.port?.workflowsOf(t)) ?? [] }
      : {}),
  };
  const list = flow.groups.list?.bind(flow.groups);
  return approvalFlowRoutes(view, {
    read: readCurrentFlow(fd),
    difyWorkflows: listDifyWorkflows(fd),
    ...(list ? { groups: list } : {}),
  });
}
