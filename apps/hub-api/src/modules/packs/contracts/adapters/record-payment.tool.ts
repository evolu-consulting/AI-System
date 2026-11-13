// CR-140 · tool gói `contracts-record-payment` (stage tool của node «Ghi thanh toán vào HĐ»; công ty = công ty của run). Ghi dòng «đã trả» vào
// sổ thanh toán của HĐ khi bước chi tiền xong mà HĐ không có đợt thanh toán.
// - HĐ lấy từ liên kết lượt↔HĐ của engine (cây lượt: lượt cha + Quy trình con); args chỉ đối chiếu, lệch ⇒ lỗi. Lượt thật không có HĐ (đơn mua
//   nhỏ) ⇒ bỏ qua; nguồn args rỗng / ngày sai ⇒ lỗi hiện ở «Cần xử lý», không âm thầm.
// - Người ghi (`done_by`) = người hoàn tất bước chi liền trước (thủ quỹ), KHÔNG phải người bắt đầu lượt. Ghi bằng scope công ty (không theo người)
//   vì thủ quỹ có thể không thấy HĐ theo luật thấy; mọi câu lọc công ty tường minh.
// - Chỉ chạy trong lượt có bước node này (`agent: false`: Agent/MCP không gắn được; gọi ngoài node ⇒ `CONTRACT_PAYMENT_NOT_IN_STAGE`).
// - Idempotent theo lượt (khoá tư vấn + nhật ký HĐ); thử lại không ghi đôi.
import {
  pickContract,
  planRecordPayment,
  RECORD_PAYMENT_BAD_AMOUNT,
  RECORD_PAYMENT_NO_ACTOR,
  RECORD_PAYMENT_NO_CONTRACT,
  RECORD_PAYMENT_NO_RUN,
  RECORD_PAYMENT_NOT_IN_STAGE,
  RECORD_PAYMENT_TOOL,
} from "@ai/contracts/modules";
import type { PackSystemUow, PackToolCtx, PackToolDef } from "../../kit/public";
import { withBusinessCodes } from "./intake.errors";
import type { RecordPaymentRepo } from "./record-payment.repo";

export const RECORD_PAYMENT_NODE_KEY = "contracts.record-payment";

export type RecordPaymentDeps = {
  uow: PackSystemUow<RecordPaymentRepo>;
  /** Cổng engine `PackRunsPort.stepContext` (tiêm lúc mount; vắng ⇒ không biết lượt ⇒ từ chối). */
  stepContext: (
    tenantId: string,
    runId: string,
  ) => Promise<{ records: string[]; actor: string | null; hasNode: boolean }>;
};

const PARAMS: PackToolDef["params"] = [
  { name: "contract_id", type: "text", required: false, description: "Hợp đồng (đối chiếu)" },
  { name: "amount", type: "number", required: false, description: "Số tiền đã chi" },
  { name: "paid_at", type: "text", required: true, description: "Ngày chi (YYYY-MM-DD)" },
];

export function recordPaymentTool(d: RecordPaymentDeps): PackToolDef {
  return {
    pack: "contracts",
    name: RECORD_PAYMENT_TOOL,
    action: "write",
    agent: false, // chỉ stage của node «Ghi thanh toán vào HĐ» — không lộ cho Agent / MCP
    description:
      "Ghi khoản đã chi vào sổ thanh toán của hợp đồng (khi hợp đồng không có đợt thanh toán). Chỉ chạy trong bước của quy trình.",
    // Ghi sổ nội bộ, idempotent theo lượt ⇒ không phải «hành động thật», thử lại an toàn.
    side_effect: false,
    params: PARAMS,
    run: withBusinessCodes((ctx, args) => run(d, ctx, args)),
  };
}

async function run(d: RecordPaymentDeps, ctx: PackToolCtx, args: Record<string, unknown>) {
  const runId = ctx.processRunId;
  if (!runId) throw new Error(RECORD_PAYMENT_NO_RUN);
  const info = await d.stepContext(ctx.tenantId, runId);
  if (!info.hasNode) throw new Error(RECORD_PAYMENT_NOT_IN_STAGE);
  const argId = typeof args.contract_id === "string" ? args.contract_id.trim() : "";
  if (info.records.length === 0 && argId === "") return { status: "skipped" }; // lượt thật không có HĐ (đơn mua nhỏ)
  const plan = planRecordPayment(args);
  if (!plan.ok) throw new Error(plan.code);
  const pick = pickContract(info.records, plan.plan.contractId);
  if (pick.kind === "error") throw new Error(pick.code);
  if (pick.kind === "skip") return { status: "skipped" };
  if (!info.actor) throw new Error(RECORD_PAYMENT_NO_ACTOR);
  const by = info.actor;
  const out = await d.uow.system(ctx.tenantId, (r) =>
    r.recordPayment({
      contractId: pick.id,
      runId,
      by,
      amount: plan.plan.amount,
      paidAt: plan.plan.paidAt,
    }),
  );
  if (out.status === "not_found") throw new Error(RECORD_PAYMENT_NO_CONTRACT);
  if (out.status === "no_amount" || out.status === "over_total")
    throw new Error(RECORD_PAYMENT_BAD_AMOUNT);
  return { status: out.status, contract_id: pick.id };
}
