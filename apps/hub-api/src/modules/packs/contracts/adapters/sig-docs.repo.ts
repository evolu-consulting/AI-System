// CR-188 · BR-188-5 «Giấy tờ đã ký bằng chữ ký này»: MỘT câu SQL (số câu cố định) — dấu ký của đúng phiên bản chữ ký (`sign_marks`, chỉ mục 0125)
// ⨝ bản ký chưa huỷ ⨝ HĐ dưới RLS «xem HĐ»: HĐ người gọi không mở được thì KHÔNG có hàng. Cờ `foreign` báo chữ ký đã in bởi người KHÁC người gọi
// (người gọi không phải quản trị ⇒ ném 403 trước khi trả bất cứ hàng nào).
import { SIG_DOCS_PAGE, type SigDocItem, type SigDocKind } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { AppError } from "../../../../lib/errors";
import { docKindOf } from "../domain/verify-file.rules";
import { contractNameSql } from "./contract-name.sql";

type Row = {
  foreign: boolean;
  version_id: string | null;
  contract_id: string | null;
  title: string | null;
  kind: string | null;
  doc_type: string | null;
  partner: string | null;
  file_name: string | null;
  seq: number | null;
  signed_at: string | null;
};

export type SigDocsFilter = {
  kind?: SigDocKind | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor: { at: string; id: string } | null;
};

export type SigDocsPage = SigDocItem[];

export type SigDocsRepo = ReturnType<typeof sigDocsRepo>;

const KIND_COND = {
  appendix: sql`and c.kind = 'appendix'`,
  contract: sql`and c.kind <> 'appendix' and c.doc_type = 'contract'`,
  other: sql`and c.kind <> 'appendix' and c.doc_type <> 'contract'`,
} as const;

/** Điều kiện lọc (loại, khoảng ngày gồm cả ngày cuối, con trỏ) — chỉ tham số hoá, không nối chuỗi. */
function filterSql(f: SigDocsFilter) {
  const kind = f.kind ? KIND_COND[f.kind] : sql``;
  const from = f.from ? sql`and v.created_at >= ${f.from}::date` : sql``;
  const to = f.to ? sql`and v.created_at < (${f.to}::date + 1)` : sql``;
  const cur = f.cursor
    ? sql`and (v.created_at, v.id) < (${f.cursor.at}::timestamptz, ${f.cursor.id}::uuid)`
    : sql``;
  return sql`${kind} ${from} ${to} ${cur}`;
}

const toItem = (r: Row): SigDocItem | null =>
  r.version_id === null || r.contract_id === null
    ? null
    : {
        version_id: r.version_id,
        contract_id: r.contract_id,
        title: r.title ?? "",
        kind: docKindOf(r.kind ?? "contract", r.doc_type ?? "contract"),
        partner: r.partner,
        file_name: r.file_name ?? "",
        seq: Number(r.seq),
        signed_at: r.signed_at ?? "",
      };

export function sigDocsRepo(tx: Tx, tenantId: string) {
  return {
    list: async (
      userId: string,
      isAdmin: boolean,
      sigId: string,
      f: SigDocsFilter,
    ): Promise<SigDocsPage> => {
      const res = await tx.execute<Row>(sql`
        with own as (
          select coalesce(bool_or(m.signer_id <> ${userId}::uuid), false) as foreign
            from contracts.sign_marks m
           where m.tenant_id = ${tenantId}::uuid and m.user_signature_id = ${sigId}::uuid),
        page as (
          select v.id::text as version_id, c.id::text as contract_id, ${contractNameSql("c")} as title, c.kind, c.doc_type,
              case when c.direction = 'sale' then c.buyer else c.seller end as partner,
              f.name as file_name, v.seq, to_char(v.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as signed_at,
              v.created_at as ord_at, v.id as ord_id
            from (select distinct m.version_id from contracts.sign_marks m
                   where m.tenant_id = ${tenantId}::uuid and m.user_signature_id = ${sigId}::uuid) mk
            join contracts.sign_versions v on v.id = mk.version_id and v.tenant_id = ${tenantId}::uuid and v.voided_at is null
            join contracts.contracts c on c.id = v.contract_id and c.tenant_id = v.tenant_id
            join contracts.files f on f.id = v.file_id and f.tenant_id = v.tenant_id
           where true ${filterSql(f)}
           order by v.created_at desc, v.id desc limit ${SIG_DOCS_PAGE + 1})
        select own.foreign, page.version_id, page.contract_id, page.title, page.kind, page.doc_type, page.partner, page.file_name, page.seq, page.signed_at
          from own left join page on true
         order by page.ord_at desc nulls last, page.ord_id desc nulls last`);
      if (res[0]?.foreign && !isAdmin) throw new AppError("FORBIDDEN", 403, "Not your signature");
      return res.map(toItem).filter((x): x is SigDocItem => x !== null);
    },
  };
}
