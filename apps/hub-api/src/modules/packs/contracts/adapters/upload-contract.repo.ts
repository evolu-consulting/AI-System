// HD-FR-08 · HD-NFR-03 · plan §5: ghi tải lên trong tx `PackUow` (role `contracts_rw`, RLS FORCE) — MỘT câu văn bản hằng: CTE
// `INSERT files` → `INSERT contracts` → `INSERT contract_events('uploaded')`. `tenant_id` tường minh (từ token) ngoài RLS. Cha
// không có / tenant khác ⇒ FK kép `contracts_parent_fk` 23503 ⇒ `PARENT_INVALID` (không lộ tồn tại).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  type NewUploadedContract,
  type UploadContractRepo,
  UploadError,
  type UploadStatus,
} from "../application/upload-contract.ports";

type Out = { id: string; status: UploadStatus; version: number };

/** Lỗi PG trong chuỗi `cause` (Drizzle bọc lỗi postgres.js). */
function pgError(err: unknown): { code?: string; constraint_name?: string } | null {
  for (
    let e = err, i = 0;
    e && typeof e === "object" && i < 5;
    e = (e as { cause?: unknown }).cause, i++
  )
    if ("code" in e && typeof (e as { code: unknown }).code === "string")
      return e as { code?: string; constraint_name?: string };
  return null;
}

export function uploadContractRepo(tx: Tx, tenantId: string): UploadContractRepo {
  return {
    insert: async (r: NewUploadedContract) => {
      const data = JSON.stringify({ name: r.name, mime: r.mime, size: r.size });
      try {
        const rows = await tx.execute<Out>(sql`with f as (
            insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
            values (${r.fileRowId}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime},
              ${r.size}, ${r.userId}::uuid)
            returning id),
          c as (
            insert into contracts.contracts (id, tenant_id, kind, parent_id, title, status, error, owner_user_id, created_by,
              fields, file_id, source_text)
            select ${r.id}::uuid, ${tenantId}::uuid, ${r.kind}, ${r.parentId}::uuid, ${r.title}, ${r.status}, ${r.error},
              ${r.userId}::uuid, ${r.userId}::uuid, ${JSON.stringify(r.fields)}::jsonb, f.id, ${r.sourceText} from f
            returning id, status, version),
          e as (
            insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${tenantId}::uuid, c.id, 'uploaded', ${r.userId}::uuid, ${data}::jsonb from c)
          select id, status, version from c`);
        const out = rows[0];
        if (!out) throw new Error("upload insert returned no row");
        return out;
      } catch (e) {
        const pg = pgError(e);
        if (pg?.code === "23503" && pg.constraint_name === "contracts_parent_fk")
          throw new UploadError("PARENT_INVALID");
        throw e;
      }
    },
  };
}
