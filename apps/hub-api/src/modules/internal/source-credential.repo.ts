// HUB-FR-129 · HUB-BR-30 · PC2-R11 · P-c2 · truy vấn kênh giao khoá nguồn (plan §6.3). Scope `system` + `tenant_id` tường
// minh (bảng RLS "T"). `hub.jobs` không RLS: tra theo `token_hash` (index `jobs_token_hash_uq`), KHÔNG lọc `status` ở đây —
// job khác trạng thái vẫn nhận ra để trả 404 (sai điều kiện) thay vì 401 (sai token). KHÔNG chọn cột bản mã / token.
import type { SourceConfig } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type CredentialJob = {
  id: string;
  type: string;
  status: string;
  tenantId: string;
  payload: unknown;
};

/** Token → job (mọi trạng thái). Một query, index `jobs_token_hash_uq`. */
export async function jobByTokenHash(tx: Tx, hash: Buffer): Promise<CredentialJob | undefined> {
  const rows = await tx.execute<{
    id: string;
    type: string;
    status: string;
    tenant_id: string;
    payload: unknown;
  }>(sql`SELECT id, type, status, tenant_id, payload FROM hub.jobs WHERE token_hash = ${hash}`);
  const r = rows[0];
  return (
    r && { id: r.id, type: r.type, status: r.status, tenantId: r.tenant_id, payload: r.payload }
  );
}

/**
 * PC2-R11 · nguồn hiện tại của tenant job (không trust id/tenant từ input): còn sống, cùng tenant. Trả `config` (jsonb) để
 * service rút `credential_secret_id` + `url`; không hàng ⇒ null (⇒ 404, không rò tồn tại).
 */
export async function sourceConfigById(
  tx: Tx,
  tenantId: string,
  sourceId: string,
): Promise<SourceConfig | undefined> {
  const rows = await tx.execute<{ config: SourceConfig }>(sql`SELECT config FROM hub.sources
    WHERE id = ${sourceId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL`);
  return rows[0]?.config;
}
