// CR-120 · cr120-community-flows · `FlowSlotAdapter` của 3 khe Community (ADR-0035): view/act/summary gọi ĐÚNG use case của route
// REST (`flows.service`) ⇒ một luật. Người xem dựng từ `PackWho` (danh bạ 1 câu + quyền gói cache + tenant admin). Đối tác đã bị
// `flowRuntime` chặn trước khi tới đây. Ref không thấy (tenant khác/không tồn tại) ⇒ null / `not_found` (không lộ tồn tại).
import type { FlowActionRequest, FlowView } from "@ai/contracts/flow";
import { AppError } from "../../../../lib/errors";
import type {
  ExternalOrgResolver,
  FlowActOutcome,
  FlowSlotAdapter,
  PackAccessView,
  PackWho,
} from "../../kit/public";
import { checkPackAccess, packAccessInput } from "../../kit/public";
import { SLOT_JOIN, SLOT_MODERATION, SLOT_REPORT } from "../domain/flow.rules";
import { joinView, moderationView, reportView, summaryOf } from "../domain/flow-view.rules";
import { type Access, COMMUNITY_KEY } from "./community-access";
import * as svc from "./flows.service";

export type SlotAccessDeps = {
  view: PackAccessView;
  resolver: ExternalOrgResolver;
  /** `tenant_admin` của tenant (admin.users) — cổng do wire tiêm; vắng ⇒ chỉ Group `community-admin`. */
  tenantAdmin?: ((who: PackWho) => Promise<boolean>) | undefined;
};

/** Access của người gọi flow (nội bộ): quyền gói + danh bạ. Không đọc được gói ⇒ null (= 404). */
export async function accessOfWho(d: SlotAccessDeps, who: PackWho): Promise<Access | null> {
  const i = await packAccessInput(d.view, COMMUNITY_KEY, who);
  const ok = (a: "read" | "write" | "admin") =>
    checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction[a] }) === "ok";
  if (!ok("read")) return null;
  const [dir, ta] = await Promise.all([
    d.resolver.directory(who.tenantId, who.userId),
    d.tenantAdmin ? d.tenantAdmin(who) : false,
  ]);
  if (!dir.user || dir.user.deactivated || dir.user.kind === "external") return null;
  return { who, org: null, canWrite: ok("write"), isAdmin: ta || ok("admin"), dir };
}

/** Lỗi use case ⇒ kết quả FlowRuntime (404 ⇒ not_found; 403/409/422 ⇒ lỗi mã; khác ⇒ ném lại). */
function outcomeOfError(e: unknown): FlowActOutcome {
  if (!(e instanceof AppError)) throw e;
  if (e.status === 404) return "not_found";
  if (e.status === 403 || e.status === 409 || e.status === 422)
    return { error: { code: e.code, status: e.status } };
  throw e;
}

type Pick3<R> = {
  slot: string;
  rows: (d: svc.FlowDeps, a: Access, ids: readonly string[]) => Promise<R[]>;
  view: (r: R, o: { reviewer: boolean; now: number }) => FlowView;
  decide: (d: svc.FlowDeps, a: Access, id: string, b: svc.DecideBody) => Promise<unknown>;
};

function adapterOf<R extends { id: string }>(
  d: svc.FlowDeps,
  acc: SlotAccessDeps,
  p: Pick3<R>,
): FlowSlotAdapter {
  const now = () => (d.now ? d.now() : Date.now());
  const one = async (a: Access, ref: string) => {
    const [r] = await p.rows(d, a, [ref]);
    return r ? p.view(r, { reviewer: svc.reviewer(a), now: now() }) : null;
  };
  return {
    slot: p.slot,
    packKey: COMMUNITY_KEY,
    view: async (who, ref) => {
      const a = await accessOfWho(acc, who);
      return a ? one(a, ref) : null;
    },
    act: async (who, ref, taskId, action, req: FlowActionRequest): Promise<FlowActOutcome> => {
      const a = await accessOfWho(acc, who);
      if (!a) return "not_found";
      if (req.values !== undefined || req.extension !== undefined)
        return { error: { code: "FLOW_INPUT_INVALID", status: 422 } };
      if (!a.canWrite) return { error: { code: "PACK_FORBIDDEN", status: 403 } };
      const failed = await p
        .decide(d, a, ref, { taskId, action, feedback: req.feedback })
        .then(() => null, outcomeOfError);
      if (failed) return failed;
      const v = await one(a, ref);
      return v ? { view: v } : "not_found";
    },
    summary: async (who, refs) => {
      const a = await accessOfWho(acc, who);
      if (!a) return [];
      const rows = await p.rows(d, a, refs);
      return rows.map((r) => summaryOf(p.view(r, { reviewer: svc.reviewer(a), now: now() })));
    },
  };
}

export function communityFlowSlots(d: svc.FlowDeps, acc: SlotAccessDeps): FlowSlotAdapter[] {
  return [
    adapterOf(d, acc, {
      slot: SLOT_MODERATION,
      rows: svc.modRows,
      view: moderationView,
      decide: svc.decideModeration,
    }),
    adapterOf(d, acc, {
      slot: SLOT_JOIN,
      rows: svc.joinRows,
      view: (r, o) => joinView(r, o),
      decide: svc.decideJoin,
    }),
    adapterOf(d, acc, {
      slot: SLOT_REPORT,
      rows: svc.reportRows,
      view: (r, o) => reportView(r, o),
      decide: svc.decideReport,
    }),
  ];
}
