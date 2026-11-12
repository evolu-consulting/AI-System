// CR-127 · E3b · spec §5.2 · R#33 · cài cổng kit `ContractAccess` cho engine (uỷ quyền / giao việc): "B xem được HĐ không" = luật xem
// hiện có của gói (RLS `contracts.contracts` dưới scope người đó — HĐ không thấy ≡ không có). `isSigner`: nhóm «Người ký HĐ»
// (`partner_settings.signer_group_id`, MIGC 0098).
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import { registerContractAccess } from "../kit/public";

export function mountContractAccess(db: Db): void {
  registerContractAccess({
    canView: (_tx, tenantId, userId, contractId) =>
      withPackScope(db, { packKey: "contracts", tenantId, userId }, async (tx) => {
        const [r] = await tx.execute<{ ok: boolean }>(
          sql`select exists (select 1 from contracts.contracts c where c.id = ${contractId}::uuid) as ok`,
        );
        return r?.ok === true;
      }),
    // CR-127 · P2 · R#31: B thuộc nhóm «Người ký HĐ» (`partner_settings.signer_group_id`, MIGC 0098) của công ty. Nhóm đọc ở scope gói, thành viên ở scope hub.
    isSigner: async (_tx, tenantId, userId) => {
      const gid = await withPackScope(
        db,
        { packKey: "contracts", tenantId, userId: null },
        async (tx) => {
          const [r] = await tx.execute<{ g: string | null }>(
            sql`select signer_group_id::text as g from contracts.partner_settings where tenant_id = ${tenantId}::uuid`,
          );
          return r?.g ?? null;
        },
      );
      if (!gid) return false;
      const rows = await withHubScope(db, { kind: "system" }, (tx) =>
        tx.execute<{ ok: boolean }>(sql`select exists (select 1 from admin.group_members m
          where m.tenant_id = ${tenantId}::uuid and m.group_id = ${gid}::uuid and m.user_id = ${userId}::uuid) as ok`),
      );
      return rows[0]?.ok === true;
    },
  });
}
