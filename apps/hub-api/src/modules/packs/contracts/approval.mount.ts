// contract-flow S2/S3 · nối duyệt HĐ trên engine + mẫu luồng (tách khỏi `extraction.mount.ts` giữ trần 400 dòng).
import { logger } from "../../../lib/logger";
import type { PackUow, PackWho } from "../kit/public";
import { checkPackAccess, type PackAccessView, packAccessInput } from "../kit/public";
import { approvalFlowRoutes } from "./adapters/approval-flow.routes";
import type { ApprovalEngineBridge, ApprovalEngineUow } from "./application/approval-engine.ports";
import { type EngineCardDeps, engineCard } from "./application/approval-engine-card.usecase";
import {
  type ApprovalFlowTxRepos,
  type FlowGroups,
  type FlowMembers,
  listDifyWorkflows,
  readCurrentFlow,
} from "./application/approval-flow.usecase";
import type { ContractFlowGate } from "./application/contract-flow.ports";
import { myApprovals } from "./application/mywork-approvals.usecase";

/** esign-flow · bước Ký số sau "Đã duyệt" (tool finalize; vắng ⇒ không tự gửi ký); người cụ thể (duyệt/ký) thuộc tenant + quyền
 *  `write` gói (kiểm khi lưu mẫu). */
export type EsignHooks = {
  afterApproved?: ((tenantId: string, contractId: string) => Promise<unknown>) | undefined;
  members?: FlowMembers | undefined;
};
type FlowDeps = EsignHooks & {
  /** CR-122 A1 · cổng cờ flow (bật ⇒ `contract.approved` cùng tx khi tool finalize ghi "Đã duyệt"). */
  flowGate?: ContractFlowGate | undefined;
  engine?: ApprovalEngineBridge | undefined;
  groups: Pick<FlowGroups, "idsOf" | "existingIds" | "list" | "memberCounts">;
};

/** cr121-a2 · duyệt HĐ CHỈ chạy trên engine: mọi lượt MỚI mở run theo luật định tuyến của khe (luật admin nếu có, không thì luật
 *  mặc định / mẫu khe — `routeSlot`), không còn env `CONTRACTS_APPROVAL_ENGINE` hay cổng "đã gán". null CHỈ khi chế độ HD2 (seam
 *  `transport`, không mở lượt duyệt), cầu engine vắng (app luôn dựng qua `withPackBridges`), hoặc seam TEST `legacyMachine` (hồi quy
 *  đường decide cũ cho lượt máy cũ còn dở — gỡ cùng máy cũ). Cổng engine đọc lười từ cầu mỗi lời gọi (engine gắn sau). */
export function approvalEngine(
  o: { hd2: boolean; legacyMachine: boolean },
  flow: FlowDeps,
  uow: ApprovalEngineUow,
  view: PackAccessView,
) {
  if (!flow.engine || o.hd2 || o.legacyMachine) return null;
  const warn = (m: string, meta: Record<string, unknown>) => logger.warn(m, meta);
  const isAdmin = async (who: PackWho) => {
    const i = await packAccessInput(view, "contracts", who);
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
  };
  return {
    myApprovals: myApprovals({ port: () => flow.engine?.port, uow }),
    // esign-flow-fix · thẻ duyệt engine; owner gói (quyền `admin`) cũng Gửi lại bước Ký số.
    // CR-113 · tên Group cho "chuyển cấp tới" + log lỗi ghi "duyệt thay".
    card: (c: Omit<EngineCardDeps, "isAdmin">) =>
      engineCard({
        ...c,
        isAdmin,
        warn,
        ...(flow.groups.list
          ? { groupNames: async (t: string) => (await flow.groups.list?.(t)) ?? [] }
          : {}),
      }),
  };
}

/** CR-127 Z3c · KHÔNG đăng ký khe `contracts.approval` (duyệt HĐ = flow công ty `contract.submitted`: một đường soạn duy nhất).
 *  CR-105 L4 · `GET /approval-flow` (chỉ đọc, quy trình đang dùng) + S3b `GET /groups` + `GET /dify-workflows`. */
export function flowTemplateRoutes(
  view: PackAccessView,
  uow: PackUow<ApprovalFlowTxRepos>,
  flow: FlowDeps,
) {
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
