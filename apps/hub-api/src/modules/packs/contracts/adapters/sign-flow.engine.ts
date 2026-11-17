// CR-181 · s9 · phần «ký trên tài liệu» chạy TRONG tx engine (role hub ⇒ `withPackRoleInTx` đổi sang role gói + tenant, rồi trả lại):
//   · `signWaitReady` — stage chờ `esign.completed` của bước Ký `ondoc` sắp mở: ô Bên A của người ký công ty đã ký đủ (Q8/D3/C4) ⇒ true;
//   · `signOnBack` — «Chưa đạt» quay lại bước trước cùng run ⇒ bỏ các bản đã ký của run, mở lại chỗ ký (Q17, soát Opus s9 #5).
// Một câu mỗi việc; không mở kết nối khác (run đang khoá).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { withPackRoleInTx } from "../../kit/public";
import { CONTRACTS_PACK } from "../domain/contract-flow-events.rules";
import { ondocDone, ondocKeys, ondocStepAt } from "../domain/sign-turn.rules";
import { signVersionsRepo } from "./sign-versions.repo";

/** BR-D3/C4 · Q6 · ô Bên A của người ký `keys` trên tệp còn cần ký: tổng + còn mở (Bên B không tính). Một câu, `tenant_id` tường minh. */
export async function ondocCounts(
  tx: Tx,
  tenantId: string,
  contractId: string,
  keys: readonly string[],
): Promise<{ total: number; open: number }> {
  const [c] = await tx.execute<{ total: number; open: number }>(sql`
    select count(*)::int as total, (count(*) filter (where f.signed_version_id is null))::int as open
    from contracts.sign_fields f
    join contracts.sign_docs d on d.tenant_id = f.tenant_id and d.contract_id = f.contract_id
      and d.file_id = f.file_id and d.needs_sign
    where f.tenant_id = ${tenantId}::uuid and f.contract_id = ${contractId}::uuid and f.side = 'A'
      and (f.signer_kind || ':' || lower(f.signer_ref::text)) = any(${`{${keys.join(",")}}`}::text[])`);
  return { total: Number(c?.total ?? 0), open: Number(c?.open ?? 0) };
}

export async function signWaitReady(
  tx: Tx,
  e: { tenantId: string; recordId: string; event: string; stages: unknown[]; idx: number },
): Promise<boolean> {
  if (e.event !== "esign.completed") return false;
  const signers = ondocStepAt(e.stages, e.idx);
  if (!signers || signers.length === 0) return false;
  return withPackRoleInTx(tx, CONTRACTS_PACK, e.tenantId, async () =>
    ondocDone(await ondocCounts(tx, e.tenantId, e.recordId, ondocKeys(signers))),
  );
}

export async function signOnBack(tx: Tx, e: { tenantId: string; runId: string }): Promise<void> {
  await withPackRoleInTx(tx, CONTRACTS_PACK, e.tenantId, async () => {
    await signVersionsRepo(tx, e.tenantId).voidByRun(e.runId);
  });
}
