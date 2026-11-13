// CR-140 · tool gói `contracts-record-payment` (stage tool của node «Ghi thanh toán vào HĐ», danh tính = người bắt đầu run, công ty = công ty
// của run). Ghi dòng «đã trả» vào sổ thanh toán của HĐ khi bước chi tiền xong mà HĐ không có đợt thanh toán. Idempotent theo lượt (thử lại
// không ghi đôi). HĐ của công ty khác ⇒ RLS không thấy ⇒ `CONTRACT_PAYMENT_NO_CONTRACT`, không ghi gì. Không có HĐ trong args ⇒ bỏ qua.
import {
  planRecordPayment,
  RECORD_PAYMENT_NO_CONTRACT,
  RECORD_PAYMENT_NO_RUN,
  RECORD_PAYMENT_TOOL,
} from "@ai/contracts/modules";
import type { PackToolCtx, PackToolDef, PackUow } from "../../kit/public";
import { localDate } from "../domain/local-time.rules";
import { withBusinessCodes } from "./intake.errors";
import type { RecordPaymentRepo } from "./record-payment.repo";

export type RecordPaymentDeps = {
  uow: PackUow<RecordPaymentRepo>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

const PARAMS: PackToolDef["params"] = [
  { name: "contract_id", type: "text", required: false, description: "Hợp đồng" },
  { name: "amount", type: "number", required: false, description: "Số tiền đã chi" },
  { name: "paid_at", type: "text", required: false, description: "Ngày chi (YYYY-MM-DD)" },
];

export function recordPaymentTool(d: RecordPaymentDeps): PackToolDef {
  return {
    pack: "contracts",
    name: RECORD_PAYMENT_TOOL,
    action: "write",
    description:
      "Ghi khoản đã chi vào sổ thanh toán của hợp đồng (khi hợp đồng không có đợt thanh toán).",
    // Ghi sổ nội bộ, idempotent theo lượt ⇒ không phải «hành động thật», thử lại an toàn.
    side_effect: false,
    params: PARAMS,
    run: withBusinessCodes((ctx, args) => run(d, ctx, args)),
  };
}

async function run(d: RecordPaymentDeps, ctx: PackToolCtx, args: Record<string, unknown>) {
  const runId = ctx.processRunId;
  if (!runId) throw new Error(RECORD_PAYMENT_NO_RUN);
  const p = planRecordPayment(args);
  if (!p.ok) throw new Error(p.code);
  if (!p.plan) return { status: "skipped" };
  const { contractId, amount, paidAt } = p.plan;
  const day =
    paidAt ?? localDate((d.now ?? (() => new Date()))(), await d.timeZoneOf(ctx.tenantId));
  const out = await d.uow.tenant({ tenantId: ctx.tenantId, userId: ctx.userId }, (r) =>
    r.recordPayment({
      contractId,
      runId,
      by: ctx.userId,
      amount,
      paidAt: day,
    }),
  );
  if (out.status === "not_found") throw new Error(RECORD_PAYMENT_NO_CONTRACT);
  return { status: out.status, contract_id: contractId };
}
