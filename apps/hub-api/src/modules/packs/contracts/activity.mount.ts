// my-activity-rag · lớp 4: nguồn hoạt động của gói contracts (`ActivitySource`) cho tool lõi `my-activity`. Tx = `PackUow` của gói
// (role `contracts_rw`, RLS FORCE, `app.user_id` = NGƯỜI GỌI) ⇒ chỉ thấy đúng những gì người đó thấy trên giao diện.
import type { Db } from "@ai/db";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { ActivitySource } from "../kit/application/activity.ports";
import { activityRepo } from "./adapters/activity.repo";

export function contractsActivitySource(db: Db): ActivitySource {
  const uow = packTenantOnly(createPackUow(db, "contracts", activityRepo));
  return {
    pack: "contracts",
    mine: (who, w) => uow.tenant(who, (r) => r.activity.mine(who.userId, w)),
    record: (who, ref, limit) => uow.tenant(who, (r) => r.activity.record(ref, limit)),
  };
}
