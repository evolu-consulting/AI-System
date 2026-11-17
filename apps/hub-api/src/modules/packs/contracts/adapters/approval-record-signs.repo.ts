// CR-181 · s10 · các bản đã ký (không huỷ) của HĐ cho «Hồ sơ duyệt». MỘT câu SQL (số câu không phụ thuộc số bản): `sign_versions` ⨝ tên tệp gốc/tệp ra
// ⨝ chữ ký in đầu tiên của bản (`sign_marks.user_signature_id`). Chạy trong tx gói (RLS tenant) — mọi hàng lọc `tenant_id`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SignVersionRow } from "../domain/approval-record.rules";

export type SignsOf = (contractId: string) => Promise<SignVersionRow[]>;

export function signsOfQ(tx: Tx, tid: string): SignsOf {
  return async (contractId) => {
    const rows = await tx.execute<{
      file_id: string;
      file_name: string;
      out_name: string;
      seq: number;
      sha256: string;
      signed_by: string;
      kind: "internal" | "digital";
      at: string;
      stamp_id: string | null;
    }>(sql`select v.file_id::text as file_id, f.name as file_name, o.name as out_name, v.seq, v.sha256, v.signed_by::text as signed_by,
        v.signature_kind as kind, to_char(v.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
        (select m.user_signature_id::text from contracts.sign_marks m where m.tenant_id = v.tenant_id and m.version_id = v.id
          order by m.ord, m.id limit 1) as stamp_id
      from contracts.sign_versions v
      join contracts.files f on f.id = v.file_id and f.tenant_id = v.tenant_id
      join contracts.files o on o.id = v.out_file_id and o.tenant_id = v.tenant_id
      where v.tenant_id = ${tid}::uuid and v.contract_id = ${contractId}::uuid and v.voided_at is null
      order by v.created_at, v.seq limit 500`);
    return rows.map((r) => ({
      fileId: r.file_id,
      fileName: r.file_name,
      outName: r.out_name,
      seq: Number(r.seq),
      sha256: r.sha256,
      signedBy: r.signed_by,
      kind: r.kind,
      at: r.at,
      stampId: r.stamp_id,
    }));
  };
}

/** Sự kiện «đã lưu hồ sơ duyệt» (không cần cột mới): `data.file_id` = `contracts.files.id` của PDF đã lưu ở FileBox. */
export const RECORD_SAVED_EVENT = "approval_record_saved";

export function savedRecordQ(tx: Tx, tid: string) {
  return async (contractId: string) => {
    const [r] = await tx.execute<{
      org: string;
      file_id: string;
      name: string;
    }>(sql`select f.org, f.file_id, f.name
      from contracts.contract_events e join contracts.files f on f.tenant_id = e.tenant_id and f.id = (e.data ->> 'file_id')::uuid
      where e.tenant_id = ${tid}::uuid and e.contract_id = ${contractId}::uuid and e.type = ${RECORD_SAVED_EVENT}
      order by e.id desc limit 1`);
    return r ? { org: r.org, fileId: r.file_id, name: r.name } : null;
  };
}
