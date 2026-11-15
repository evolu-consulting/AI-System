// CR-127 · E3b · spec §5.2 · R#33 · cài cổng kit `ContractAccess` cho engine (uỷ quyền / giao việc): "B xem được HĐ không" = luật xem
// hiện có của gói (RLS `contracts.contracts` dưới scope người đó — HĐ không thấy ≡ không có). `isSigner`: «Người ký phía công ty» của bước Ký
// trong quy trình Nhận HĐ (CR-146b).
import type { Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import { registerContractAccess } from "../kit/public";
import { receiveFlowOf, signerMembersOf } from "./adapters/receive-flow.repo";

export function mountContractAccess(db: Db): void {
  registerContractAccess({
    canView: (_tx, tenantId, userId, contractId) =>
      withPackScope(db, { packKey: "contracts", tenantId, userId }, async (tx) => {
        const [r] = await tx.execute<{ ok: boolean }>(
          sql`select exists (select 1 from contracts.contracts c where c.id = ${contractId}::uuid) as ok`,
        );
        return r?.ok === true;
      }),
    // CR-146b · R#31: B là «Người ký phía công ty» của bước Ký trong quy trình Nhận HĐ (người được chọn, hoặc thành viên phòng được chọn).
    isSigner: async (_tx, tenantId, userId) => {
      const { signers } = await receiveFlowOf(db, tenantId);
      if (!signers) return false;
      return (await signerMembersOf(db, tenantId, signers)).some((m) => m.id === userId);
    },
  });
}
