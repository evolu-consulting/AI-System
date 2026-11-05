// CR-118 · UW-FR-10/11/13/14 · ADR-0035 · `FlowSlotAdapter` của khe `contracts.approval`: bọc ĐÚNG use case thẻ duyệt hôm nay
// (`getApproval` / `actApproval` — không đổi hành vi, quyền bước vẫn do engine `can_act` / máy trạng thái quyết) rồi chiếu sang
// FlowView. Thêm duy nhất: task id phải khớp task đang mở của người xem (bấm trên thẻ cũ ⇒ 409, kiểm lại trong use case —
// CR-120 `expect`), đầu vào lạ ⇒ 422.
import { type ContractApproval, ProductLinksSchema } from "@ai/contracts";
import type { FlowActError, FlowSlotAdapter } from "../../kit/application/flow.ports";
import type { PackWho } from "../../kit/application/ports";
import {
  APPROVAL_FLOW_SLOT,
  type ApprovalSummaryRow,
  flowViewOfCard,
  summaryItemOf,
} from "../domain/approval-flow-view.rules";
import type { ApprovalAction, actApproval, getApproval } from "./approval.usecase";

export type ApprovalFlowSlotDeps = {
  get: ReturnType<typeof getApproval>;
  act: ReturnType<typeof actApproval>;
  /** Một câu SQL cho cả lô, trong tx tenant của người xem. */
  rows: (who: PackWho, ids: readonly string[]) => Promise<ApprovalSummaryRow[]>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<string>(["approve", "reject", "redo", "return"]);
const STATUS = {
  APPROVAL_NOT_OPEN: 409,
  NOT_REVIEWER: 403,
  STARTER_CANNOT_REVIEW: 403,
  FEEDBACK_REQUIRED: 422,
} as const;
const fail = (code: string, status: 403 | 409 | 422 | 503): FlowActError => ({
  error: { code, status },
});

async function viewOf(d: ApprovalFlowSlotDeps, who: PackWho, ref: string, card: unknown) {
  const [row] = await d.rows(who, [ref]);
  const ver = row?.mode === "engine" ? row.flow_version : null;
  return flowViewOfCard(card as ContractApproval, ref, ver);
}

/** Đầu vào hành động ⇒ thân `actApproval`; `values` (form) không có ở khe này, `extension` chỉ cho Duyệt. */
function bodyOf(
  action: string,
  req: Parameters<FlowSlotAdapter["act"]>[4],
): ApprovalAction | FlowActError {
  if (!ACTIONS.has(action)) return fail("FLOW_ACTION_UNKNOWN", 422);
  if (req.values !== undefined) return fail("FLOW_INPUT_INVALID", 422);
  const b: ApprovalAction = { action: action as ApprovalAction["action"] };
  if (req.feedback) b.feedback = req.feedback;
  if (req.extension === undefined) return b;
  const p = ProductLinksSchema.safeParse(req.extension);
  if (action !== "approve" || !p.success) return fail("FLOW_INPUT_INVALID", 422);
  return { ...b, products: p.data };
}

export function approvalFlowSlot(d: ApprovalFlowSlotDeps): FlowSlotAdapter {
  return {
    slot: APPROVAL_FLOW_SLOT,
    packKey: "contracts",
    view: async (who, ref) => {
      if (!UUID.test(ref)) return null;
      const card = await d.get(who, ref);
      return card ? viewOf(d, who, ref, card) : null;
    },
    act: async (who, ref, taskId, action, req) => {
      if (!UUID.test(ref)) return "not_found";
      const b = bodyOf(action, req);
      if (!("action" in b)) return b;
      const cur = await d.get(who, ref);
      if (!cur) return "not_found";
      if (cur.task_id !== taskId) return fail("APPROVAL_NOT_OPEN", 409);
      // CR-120 · idempotent: kiểm lại task/giai đoạn TRONG use case (khoá / task engine định quyết) — bấm lại/đua không quyết bước kế.
      const out = await d.act(who, ref, { ...b, expect: { taskId, step: cur.step ?? null } });
      if (out === "not_found") return out;
      if (out === "unavailable") return fail("AGENT_UNAVAILABLE", 503);
      if ("error" in out) return fail(out.error, STATUS[out.error]);
      return { view: await viewOf(d, who, ref, out) };
    },
    summary: async (who, refs) => {
      const ids = refs.filter((r) => UUID.test(r));
      return (await d.rows(who, ids)).map(summaryItemOf);
    },
  };
}
