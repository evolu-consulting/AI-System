// CR-181 · s9 · phần «ký trên tài liệu» chạy TRONG tx engine (role hub ⇒ `withPackRoleInTx` đổi sang role gói + tenant, rồi trả lại):
//   · `signWaitReady` — stage chờ `esign.completed` của bước Ký `ondoc` sắp mở: ô Bên A của người ký công ty đã ký đủ (Q8/D3/C4) ⇒ true;
//   · `signOnBack` — «Chưa đạt» quay lại bước trước cùng run ⇒ bỏ các bản đã ký của run, mở lại chỗ ký (Q17, soát Opus s9 #5).
// Một câu mỗi việc; không mở kết nối khác (run đang khoá).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { withPackRoleInTx } from "../../kit/public";
import { CONTRACTS_PACK } from "../domain/contract-flow-events.rules";
import { ondocADone, ondocDone, ondocKeys, ondocStepAt } from "../domain/sign-turn.rules";

/** BR-D3/C4 · ô Bên A của người ký `keys` trên tệp còn cần ký: tổng + còn mở. CR-182: thêm ô Bên B (đối tác) tổng + còn mở. Một câu, `tenant_id` tường minh. */
export async function ondocCounts(
  tx: Tx,
  tenantId: string,
  contractId: string,
  keys: readonly string[],
): Promise<{ total: number; open: number; b_total: number; b_open: number }> {
  const [c] = await tx.execute<{
    total: number;
    open: number;
    b_total: number;
    b_open: number;
  }>(sql`
    with k as (select (f.signer_kind || ':' || lower(f.signer_ref::text)) = any(${`{${keys.join(",")}}`}::text[]) as mine, f.side, f.signed_version_id
      from contracts.sign_fields f
      join contracts.sign_docs d on d.tenant_id = f.tenant_id and d.contract_id = f.contract_id
        and d.file_id = f.file_id and d.needs_sign
      where f.tenant_id = ${tenantId}::uuid and f.contract_id = ${contractId}::uuid)
    select (count(*) filter (where side = 'A' and mine))::int as total,
      (count(*) filter (where side = 'A' and mine and signed_version_id is null))::int as open,
      (count(*) filter (where side = 'B'))::int as b_total,
      (count(*) filter (where side = 'B' and signed_version_id is null))::int as b_open from k`);
  return {
    total: Number(c?.total ?? 0),
    open: Number(c?.open ?? 0),
    b_total: Number(c?.b_total ?? 0),
    b_open: Number(c?.b_open ?? 0),
  };
}

/** CR-182 · kênh NOTIFY «bên A đã ký đủ, còn chỗ Bên B» ⇒ mời đối tác ký (nghe ở `partner-sign.mount.ts`; không poll). */
export const PARTNER_SIGN_START_CHANNEL = "contracts_partner_sign_start";

export async function signWaitReady(
  tx: Tx,
  e: { tenantId: string; recordId: string; event: string; stages: unknown[]; idx: number },
): Promise<boolean> {
  if (e.event !== "esign.completed") return false;
  const signers = ondocStepAt(e.stages, e.idx);
  if (!signers || signers.length === 0) return false;
  return withPackRoleInTx(tx, CONTRACTS_PACK, e.tenantId, async () => {
    const c = await ondocCounts(tx, e.tenantId, e.recordId, ondocKeys(signers));
    // Bên A đã ký đủ nhưng còn chỗ Bên B ⇒ chưa thả bước; báo (giao khi COMMIT) để mời đối tác ký.
    if (ondocADone(c) && c.b_open > 0)
      await tx.execute(
        sql`select pg_notify(${PARTNER_SIGN_START_CHANNEL}, ${JSON.stringify({ t: e.tenantId, c: e.recordId })})`,
      );
    return ondocDone(c);
  });
}

/** Q17 · bỏ bản ký của run làm TỪ `since` (lúc stage đích bắt đầu) + mở lại chỗ đã ký trong các bản đó; `since` null ⇒ mọi bản của run. Một câu. */
export async function signOnBack(
  tx: Tx,
  e: { tenantId: string; runId: string; since: Date | null },
): Promise<void> {
  const since = e.since ? e.since.toISOString() : null;
  await withPackRoleInTx(tx, CONTRACTS_PACK, e.tenantId, async () => {
    await tx.execute(sql`
      with v as (
        update contracts.sign_versions set voided_at = now()
        where run_id = ${e.runId}::uuid and tenant_id = ${e.tenantId}::uuid and voided_at is null
          and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)
        returning id)
      update contracts.sign_fields set signed_by = null, signed_version_id = null
      where tenant_id = ${e.tenantId}::uuid and signed_version_id in (select id from v)`);
  });
}
