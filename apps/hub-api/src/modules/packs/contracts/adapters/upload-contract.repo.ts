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
import { newVersionVerdict } from "../domain/versions.rules";

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

type VersionOut = {
  found: boolean;
  kind: string | null;
  superseded: boolean;
  locked: boolean;
  draft: boolean;
  id: string | null;
  status: UploadStatus | null;
  version: number | null;
  version_no: number | null;
  root_id: string | null;
  supersedes_id: string | null;
};

/** CR-097 K2 · HD-FR-101: MỘT câu — khoá bản `base` (RLS: không thấy ⇒ rỗng ⇒ 404) → điều kiện (HĐ, hiện hành, đã khoá, chuỗi chưa
 *  có nháp) → files → contracts (v(n+1): cùng `root_id`, `owner_user_id` của bản cũ; bản cũ không phụ trách ⇒ `created_by` của bản cũ
 *  để tập người thấy không rộng hơn) → lượt duyệt (flow) → event `uploaded`. Đua hai lượt tải ⇒ index `contracts_open_draft_uq`. */
async function insertVersion(tx: Tx, tenantId: string, r: NewUploadedContract, base: string) {
  const data = JSON.stringify({ name: r.name, mime: r.mime, size: r.size });
  const approvalId = r.status === "extracting" ? (r.approvalId ?? null) : null;
  let rows: VersionOut[];
  try {
    rows = await tx.execute<VersionOut>(sql`with b as (
        select c.id, c.kind, c.title, c.root_id, c.version_no, c.owner_user_id, c.created_by, c.locked_at is not null as locked,
          c.superseded_at is not null as superseded
        from contracts.contracts c where c.id = ${base}::uuid and c.tenant_id = ${tenantId}::uuid for update),
      k as (select b.*, exists (select 1 from contracts.contracts v where v.tenant_id = ${tenantId}::uuid
            and v.root_id = b.root_id and v.version_no > b.version_no) as draft,
          (select max(v.version_no) from contracts.contracts v where v.tenant_id = ${tenantId}::uuid
            and v.root_id = b.root_id) + 1 as no
        from b),
      ok as (select k.* from k where k.kind = 'contract' and not k.superseded and k.locked and not k.draft),
      f as (
        insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
        select ${r.fileRowId}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime},
          ${r.size}, ${r.userId}::uuid from ok
        returning id),
      c as (
        insert into contracts.contracts (id, tenant_id, kind, title, status, error, owner_user_id, created_by, fields, file_id,
          source_text, run_id, root_id, version_no, supersedes_id)
        select ${r.id}::uuid, ${tenantId}::uuid, 'contract', coalesce(nullif(${r.title}, ''), ok.title), ${r.status}, ${r.error},
          ok.owner_user_id, case when ok.owner_user_id is null then ok.created_by else ${r.userId}::uuid end,
          ${JSON.stringify(r.fields)}::jsonb, f.id, ${r.sourceText}, ${approvalId}::uuid, ok.root_id, ok.no, ok.id
        from ok, f
        returning id, status, version, version_no, root_id, supersedes_id),
      a as (
        insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
        select ${approvalId}::uuid, ${tenantId}::uuid, c.id, 'extracting', ${r.userId}::uuid from c
        where ${approvalId}::uuid is not null),
      e as (
        insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        select ${tenantId}::uuid, c.id, 'uploaded', ${r.userId}::uuid,
          ${data}::jsonb || jsonb_build_object('version_no', c.version_no, 'supersedes_id', c.supersedes_id) from c)
      select exists (select 1 from k) as found, (select kind from k) as kind,
        coalesce((select superseded from k), false) as superseded, coalesce((select locked from k), false) as locked,
        coalesce((select draft from k), false) as draft, c.id, c.status, c.version, c.version_no, c.root_id, c.supersedes_id
      from (select 1) one left join c on true`);
  } catch (e) {
    const pg = pgError(e);
    if (pg?.code === "23505") throw new UploadError("VERSION_DRAFT_EXISTS");
    throw e;
  }
  const o = rows[0];
  const verdict = newVersionVerdict({
    found: o?.found === true,
    kind: o?.kind ?? "",
    superseded: o?.superseded === true,
    locked: o?.locked === true,
    draft: o?.draft === true,
  });
  if (verdict !== "ok" || !o?.id) throw new UploadError(verdict === "ok" ? "NOT_FOUND" : verdict);
  return {
    id: o.id,
    status: o.status as UploadStatus,
    version: o.version as number,
    version_no: o.version_no as number,
    root_id: o.root_id as string,
    supersedes_id: o.supersedes_id as string,
  };
}

export function uploadContractRepo(tx: Tx, tenantId: string): UploadContractRepo {
  return {
    insertVersion: (r, base) => insertVersion(tx, tenantId, r, base),
    insert: async (r: NewUploadedContract) => {
      const data = JSON.stringify({ name: r.name, mime: r.mime, size: r.size });
      const approvalId = r.status === "extracting" ? (r.approvalId ?? null) : null;
      try {
        const rows = await tx.execute<Out>(sql`with f as (
            insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
            values (${r.fileRowId}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime},
              ${r.size}, ${r.userId}::uuid)
            returning id),
          c as (
            insert into contracts.contracts (id, tenant_id, kind, parent_id, title, status, error, owner_user_id, created_by,
              fields, file_id, source_text, run_id)
            select ${r.id}::uuid, ${tenantId}::uuid, ${r.kind}, ${r.parentId}::uuid, ${r.title}, ${r.status}, ${r.error},
              ${r.userId}::uuid, ${r.userId}::uuid, ${JSON.stringify(r.fields)}::jsonb, f.id, ${r.sourceText},
              ${approvalId}::uuid from f
            returning id, status, version),
          a as (
            -- M3 · lượt duyệt mở trong CÙNG câu (chế độ flow): giữ "1 tx 3 câu" của tải lên (HD-NFR-03).
            insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
            select ${approvalId}::uuid, ${tenantId}::uuid, c.id, 'extracting', ${r.userId}::uuid from c
            where ${approvalId}::uuid is not null),
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
