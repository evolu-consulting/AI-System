// CR-133 · «Tài liệu kèm»: SQL trong tx `PackUow` (role `contracts_rw`, RLS tenant + hiển thị HĐ). `tenant_id` tường minh (từ token) ngoài RLS.
// Mỗi thao tác MỘT câu văn bản hằng. HĐ không thấy (RLS) ⇒ `facts` rỗng ⇒ use case 404, không lộ tồn tại.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ContractFileRef,
  ContractFilesRepo,
  NewContractFile,
} from "../application/contract-files.usecase";
import { MAX_CONTRACT_FILES, type OwnFileRow } from "../domain/contract-files.rules";

export function contractFilesRepo(tx: Tx, tenantId: string): ContractFilesRepo {
  return {
    facts: async (id) => {
      const [r] = await tx.execute<{ created_by: string; owner_user_id: string | null }>(sql`
        select c.created_by, c.owner_user_id from contracts.contracts c
        where c.id = ${id}::uuid and c.tenant_id = ${tenantId}::uuid`);
      return r ?? null;
    },
    list: (id) =>
      tx.execute<OwnFileRow>(sql`
        select f.id, f.name, f.mime, f.size_bytes, cf.added_by, cf.added_at
        from contracts.contract_files cf
        join contracts.files f on f.id = cf.file_id and f.tenant_id = cf.tenant_id and f.deleted_at is null
        where cf.contract_id = ${id}::uuid and cf.tenant_id = ${tenantId}::uuid
        order by cf.added_at, f.id`),
    count: async (id) => {
      const [r] = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from contracts.contract_files cf
        join contracts.files f on f.id = cf.file_id and f.tenant_id = cf.tenant_id and f.deleted_at is null
        where cf.contract_id = ${id}::uuid and cf.tenant_id = ${tenantId}::uuid`);
      return r?.n ?? 0;
    },
    insert: async (r: NewContractFile, by) => {
      const rows = await tx.execute<{ file_id: string }>(sql`with c as (
          select c.id from contracts.contracts c where c.id = ${r.contractId}::uuid and c.tenant_id = ${tenantId}::uuid),
        n as (select count(*)::int as n from contracts.contract_files cf
          join contracts.files f on f.id = cf.file_id and f.tenant_id = cf.tenant_id and f.deleted_at is null
          where cf.contract_id = ${r.contractId}::uuid and cf.tenant_id = ${tenantId}::uuid),
        f as (
          insert into contracts.files (id, tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
          select ${r.id}::uuid, ${tenantId}::uuid, ${r.org}, ${r.fileId}, ${r.versionId}, ${r.name}, ${r.mime}, ${r.size},
            ${by}::uuid from c, n where n.n < ${MAX_CONTRACT_FILES}
          returning id)
        insert into contracts.contract_files (tenant_id, contract_id, file_id, added_by)
        select ${tenantId}::uuid, ${r.contractId}::uuid, f.id, ${by}::uuid from f
        returning file_id`);
      return rows.length > 0;
    },
    find: async (id, fileId): Promise<ContractFileRef | null> => {
      const [r] = await tx.execute<ContractFileRef>(sql`
        select f.org, f.file_id, cf.added_by from contracts.contract_files cf
        join contracts.contracts c on c.id = cf.contract_id and c.tenant_id = cf.tenant_id
        join contracts.files f on f.id = cf.file_id and f.tenant_id = cf.tenant_id and f.deleted_at is null
        where cf.contract_id = ${id}::uuid and cf.file_id = ${fileId}::uuid and cf.tenant_id = ${tenantId}::uuid`);
      return r ?? null;
    },
    remove: async (id, fileId) => {
      const rows = await tx.execute<{ file_id: string }>(sql`with d as (
          delete from contracts.contract_files where contract_id = ${id}::uuid and file_id = ${fileId}::uuid
            and tenant_id = ${tenantId}::uuid returning file_id)
        update contracts.files f set deleted_at = now() from d
        where f.id = d.file_id and f.tenant_id = ${tenantId}::uuid returning f.id as file_id`);
      return rows.length > 0;
    },
  };
}
