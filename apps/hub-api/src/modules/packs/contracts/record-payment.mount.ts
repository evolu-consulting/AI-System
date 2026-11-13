// CR-140 · nối node «Ghi thanh toán vào HĐ» (`contracts.record-payment`): tool gói (PackUow role `contracts_rw`, RLS công ty) + binding sổ module.
// Ngữ cảnh lượt (HĐ gắn cây lượt, người làm bước trước, lượt có node này) lấy từ cổng engine `packRuns` (gắn lười như tool «Tạo hợp đồng từ hồ sơ»).
import type { Db } from "@ai/db";
import {
  createPackUow,
  moduleRegistry,
  type PackRunsBridge,
  type PackToolDef,
} from "../kit/public";
import { recordPaymentRepo } from "./adapters/record-payment.repo";
import { RECORD_PAYMENT_NODE_KEY, recordPaymentTool } from "./adapters/record-payment.tool";
import { recordPaymentBinding } from "./nodes/record-payment/binding";

export type RecordPaymentMountDeps = {
  packTools?: { register(t: PackToolDef): void } | undefined;
  packRuns?: PackRunsBridge | undefined;
};

export function mountRecordPayment(d: RecordPaymentMountDeps, db: Db): void {
  const tool = recordPaymentTool({
    uow: createPackUow(db, "contracts", recordPaymentRepo),
    stepContext: async (tenantId, runId) => {
      const f = d.packRuns?.port?.stepContext;
      return f
        ? f(tenantId, runId, "contracts", RECORD_PAYMENT_NODE_KEY)
        : { records: [], actor: null, hasNode: false }; // engine tắt ⇒ từ chối (NOT_IN_STAGE)
    },
  });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(recordPaymentBinding());
}
