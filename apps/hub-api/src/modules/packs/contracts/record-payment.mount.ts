// CR-140 · nối node «Ghi thanh toán vào HĐ» (`contracts.record-payment`): tool gói (PackUow role `contracts_rw`, RLS công ty) + binding sổ module.
import type { Db } from "@ai/db";
import { createPackUow, moduleRegistry, type PackToolDef, packTenantOnly } from "../kit/public";
import { tenantTz, type WithConfig } from "../packs.tenant-config";
import { recordPaymentRepo } from "./adapters/record-payment.repo";
import { recordPaymentTool } from "./adapters/record-payment.tool";
import { recordPaymentBinding } from "./nodes/record-payment/binding";

export type RecordPaymentMountDeps = {
  packTools?: { register(t: PackToolDef): void } | undefined;
  config?: WithConfig["config"] | undefined;
};

export function mountRecordPayment(d: RecordPaymentMountDeps, db: Db): void {
  const uow = packTenantOnly(createPackUow(db, "contracts", recordPaymentRepo));
  const tool = recordPaymentTool({
    uow,
    timeZoneOf: d.config ? tenantTz({ config: d.config }) : async () => "Asia/Ho_Chi_Minh",
  });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(recordPaymentBinding());
}
