// HD-FR-08 · HD-NFR-03 · plan §5: ghi tải lên trong tx `PackUow` (role `contracts_rw`, RLS FORCE) — MỘT câu văn bản hằng: CTE
// `INSERT files` → `INSERT contracts` → `INSERT contract_events('uploaded')`. `tenant_id` tường minh (từ token) ngoài RLS. Cha
// không có / tenant khác ⇒ FK kép `contracts_parent_fk` 23503 ⇒ `PARENT_INVALID` (không lộ tồn tại).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  type NewUploadedContract,
  type UploadContractRepo,
  UploadError,
  type UploadExtract,
} from "../application/upload-contract.ports";
import { initialState } from "../domain/contract-state.rules";
import { newVersionVerdict } from "../domain/versions.rules";

type Out = { id: string; status: "draft"; extract_state: UploadExtract; version: number };

/** Lỗi PG trong chuỗi `cause` (Drizzle bọc lỗi postgres.js). */
function pgError(
  err: unknown,
): { code?: string; constraint_name?: string; message?: string } | null {
  for (
    let e = err, i = 0;
    e && typeof e === "object" && i < 5;
    e = (e as { cause?: unknown }).cause, i++
  )
    if ("code" in e && typeof (e as { code: unknown }).code === "string")
      return e as { code?: string; constraint_name?: string; message?: string };
  return null;
}

type VersionOut = {
  found: boolean;
  kind: string | null;
  superseded: boolean;
  locked: boolean;
  draft: boolean;
  id: string | null;
  status: "draft" | null;
  extract_state: UploadExtract | null;
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
  const approvalId = r.extractState === "reading" ? (r.approvalId ?? null) : null;
  const init = initialState("upload", { reading: r.extractState === "reading" });
  let rows: VersionOut[];
  try {
    // CR-101 DOC-model: v(n+1) kế thừa loại chứng từ, HĐ NT cha, hạn mức, cách đặt hàng của bản cũ.
    rows = await tx.execute<VersionOut>(sql`with b as (
        select c.id, c.kind, c.title, c.root_id, c.version_no, c.owner_user_id, c.created_by, c.locked_at is not null as locked,
          c.superseded_at is not null as superseded, c.doc_type, c.frame_root_id, c.credit_limit, c.order_terms
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
        insert into contracts.contracts (id, tenant_id, kind, title, status, extract_state, error, owner_user_id, created_by, fields, file_id,
          source_text, run_id, root_id, version_no, supersedes_id, doc_type, frame_root_id, credit_limit, order_terms)
        select ${r.id}::uuid, ${tenantId}::uuid, 'contract', coalesce(nullif(${r.title}, ''), ok.title), ${init.status}, ${r.extractState}, ${r.error},
          ok.owner_user_id, case when ok.owner_user_id is null then ok.created_by else ${r.userId}::uuid end,
          ${JSON.stringify(r.fields)}::jsonb, f.id, ${r.sourceText}, ${approvalId}::uuid, ok.root_id, ok.no, ok.id,
          ok.doc_type, ok.frame_root_id, ok.credit_limit, ok.order_terms
        from ok, f
        returning id, status, extract_state, version, version_no, root_id, supersedes_id),
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
        coalesce((select draft from k), false) as draft, c.id, c.status, c.extract_state, c.version, c.version_no, c.root_id, c.supersedes_id
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
    status: "draft" as const,
    extractState: o.extract_state as UploadExtract,
    version: o.version as number,
    version_no: o.version_no as number,
    root_id: o.root_id as string,
    supersedes_id: o.supersedes_id as string,
  };
}

export function uploadContractRepo(tx: Tx, tenantId: string): UploadContractRepo {
  return {
    // CR-157b · «Tải tệp khác»: đọc không khoá (cổng trước quota/FileBox).
    replaceGate: async (id) => {
      const [r] = await tx.execute<{
        status: string;
        extract_state: string;
        created_by: string;
        owner_user_id: string | null;
      }>(sql`select status, extract_state, created_by, owner_user_id from contracts.contracts
        where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`);
      return r
        ? {
            status: r.status,
            extractState: r.extract_state,
            createdBy: r.created_by,
            ownerId: r.owner_user_id,
          }
        : null;
    },
    // MỘT câu: khoá HĐ → điều kiện DRAFT + failed → files → đổi tệp/chữ/trạng thái đọc, bỏ xác nhận đối chiếu → event. Chưa có lượt duyệt mới.
    replaceFile: async (r, id) => {
      const data = JSON.stringify({ name: r.name, mime: r.mime, size: r.size });
      const [o] = await tx.execute<{ version: number }>(sql`with b as (
          select c.id from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid
            and c.status = 'draft' and c.extract_state = 'failed' for update),
        f as (insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
          select ${r.fileRowId}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime},
            ${r.size}, ${r.userId}::uuid from b returning id),
        u as (update contracts.contracts t set file_id = f.id, source_text = ${r.sourceText}, extract_state = ${r.extractState},
            error = ${r.error}, reconciled_by = null, reconciled_at = null, version = t.version + 1, updated_at = now()
          from f where t.id = ${id}::uuid and t.tenant_id = ${tenantId}::uuid returning t.id, t.version),
        e as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
          select ${tenantId}::uuid, u.id, 'file_replaced', ${r.userId}::uuid, ${data}::jsonb from u)
        select version from u`);
      return o ? { version: Number(o.version) } : null;
    },
    insertVersion: (r, base) => insertVersion(tx, tenantId, r, base),
    annexInherit: (id, parentId) => annexInherit(tx, tenantId, id, parentId),
    insert: async (r: NewUploadedContract) => {
      const data = JSON.stringify({ name: r.name, mime: r.mime, size: r.size });
      const approvalId = r.extractState === "reading" ? (r.approvalId ?? null) : null;
      const init = initialState("upload", { reading: r.extractState === "reading" });
      const doc = r.doc ?? {
        docType: "contract",
        frameId: null,
        creditLimit: null,
        orderTerms: null,
      };
      try {
        // CR-101: `frameId` (bản bất kỳ của chuỗi HĐ NT, thấy được) ⇒ `root_id`; không thấy ⇒ giữ id ⇒ FK/trigger 0055 từ chối.
        const rows = await tx.execute<Out>(sql`with fr as (
            select coalesce((select k.root_id from contracts.contracts k
              where k.tenant_id = ${tenantId}::uuid and k.id = ${doc.frameId}::uuid), ${doc.frameId}::uuid) as root),
          f as (
            insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
            values (${r.fileRowId}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime},
              ${r.size}, ${r.userId}::uuid)
            returning id),
          c as (
            insert into contracts.contracts (id, tenant_id, kind, parent_id, title, status, extract_state, error, owner_user_id, created_by,
              fields, file_id, source_text, run_id, doc_type, frame_root_id, credit_limit, order_terms)
            select ${r.id}::uuid, ${tenantId}::uuid, ${r.kind}, ${r.parentId}::uuid, ${r.title}, ${init.status}, ${r.extractState}, ${r.error},
              ${r.userId}::uuid, ${r.userId}::uuid, ${JSON.stringify(r.fields)}::jsonb, f.id, ${r.sourceText},
              ${approvalId}::uuid, ${doc.docType}, fr.root, ${doc.creditLimit}::bigint, ${doc.orderTerms} from f, fr
            returning id, status, extract_state, version),
          a as (
            -- M3 · lượt duyệt mở trong CÙNG câu (chế độ flow): giữ "1 tx 3 câu" của tải lên (HD-NFR-03).
            insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
            select ${approvalId}::uuid, ${tenantId}::uuid, c.id, 'extracting', ${r.userId}::uuid from c
            where ${approvalId}::uuid is not null),
          e as (
            insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
            select ${tenantId}::uuid, c.id, 'uploaded', ${r.userId}::uuid, ${data}::jsonb from c)
          select id, status, extract_state, version from c`);
        const out = rows[0];
        if (!out) throw new Error("upload insert returned no row");
        return {
          id: out.id,
          status: "draft" as const,
          extractState: out.extract_state,
          version: out.version,
        };
      } catch (e) {
        throw insertError(e);
      }
    },
  };
}

/** CR-182 R6: cha = HĐ (kind=contract) đã duyệt (status done) mà người gọi thấy (RLS) ⇒ chép hướng + đối tác/loại (fields: type, buyer_*, supplier_*); không ⇒ false. Một câu. */
async function annexInherit(
  tx: Tx,
  tenantId: string,
  id: string,
  parentId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`update contracts.contracts n
    set direction = p.direction,
      fields = n.fields || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(p.fields) e
        where e.key in ('type', 'buyer_name', 'buyer_tax_id', 'supplier_name', 'supplier_tax_id')), '{}'::jsonb)
    from contracts.contracts p
    where n.id = ${id}::uuid and n.tenant_id = ${tenantId}::uuid and p.id = ${parentId}::uuid and p.tenant_id = n.tenant_id
      and p.kind = 'contract' and p.status = 'done'
    returning n.id`);
  return rows.length === 1;
}

/** Cha không có / tenant khác ⇒ `PARENT_INVALID`; HĐ NT không có / không thấy / tenant khác (CR-101) ⇒ `FRAME_INVALID`. */
function insertError(e: unknown): unknown {
  const pg = pgError(e);
  const fk = pg?.code === "23503" ? pg.constraint_name : null;
  if (fk === "contracts_parent_fk") return new UploadError("PARENT_INVALID");
  if (fk === "contracts_frame_fk" || (pg?.code === "EK422" && pg.message === "FRAME_INVALID"))
    return new UploadError("FRAME_INVALID");
  return e;
}
