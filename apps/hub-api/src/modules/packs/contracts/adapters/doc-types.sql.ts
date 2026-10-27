// CR-101 DOC-model: mảnh SQL chứng từ dùng trong câu danh sách / chi tiết của `contracts.repo.ts` (văn bản cố định, không thêm câu).
import { FRAME_CHILDREN_MAX } from "@ai/contracts";
import { sql } from "drizzle-orm";

/** Bản hiện hành của chuỗi bí danh `x`: chưa bị thay và không phải nháp mở (v≥2 chưa khoá). */
const currentRow = (x: string) =>
  sql.raw(
    `${x}.superseded_at is null and not (${x}.supersedes_id is not null and ${x}.locked_at is null)`,
  );

/** Chi tiết: chứng từ của HĐ `c` — cha (bản hiện hành thấy được của chuỗi HĐ NT; không thấy ⇒ null ⇒ mapper `restricted`)
 *  + con (khi `c` là HĐ NT: bản hiện hành thấy được, index `contracts_frame_idx`, tới trần). */
export const docOf = sql`jsonb_build_object('doc_type', c.doc_type, 'frame_root_id', c.frame_root_id, 'credit_limit', c.credit_limit,
      'order_terms', c.order_terms,
      'frame', (select jsonb_build_object('id', fc.id, 'title', fc.title, 'number', fc.number) from contracts.contracts fc
        where c.frame_root_id is not null and fc.tenant_id = c.tenant_id and fc.root_id = c.frame_root_id
          and fc.superseded_at is null order by fc.version_no limit 1),
      'children', case when c.doc_type = 'framework' then (select jsonb_agg(jsonb_build_object('id', k.id,
          'doc_type', k.doc_type, 'title', k.title, 'number', k.number, 'status', k.status, 'value', k.value,
          'start_date', k.start_date) order by k.start_date nulls last, k.id)
        from (select k.* from contracts.contracts k where k.tenant_id = c.tenant_id and k.frame_root_id = c.root_id
          and ${currentRow("k")} order by k.start_date nulls last, k.id limit ${FRAME_CHILDREN_MAX}::int) k) end)`;

/** Danh sách: loại chứng từ từng hàng trang `p` (cùng thứ tự `items`); `frame_restricted` = có cha mà RLS không cho thấy. */
export const docsOf = (
  tid: string,
  want: boolean,
) => sql`case when ${want}::boolean then coalesce((select json_agg(
      json_build_object('id', c.id, 'doc_type', c.doc_type, 'frame_root_id', c.frame_root_id,
        'frame_restricted', c.frame_root_id is not null and not exists (select 1 from contracts.contracts fv
          where fv.tenant_id = c.tenant_id and fv.id = c.frame_root_id)) order by pp.ord)
    from (select p.id, row_number() over () as ord from p) pp
    join contracts.contracts c on c.id = pp.id and c.tenant_id = ${tid}::uuid), '[]'::json) end`;

/** Luật 4c: con (bản hiện hành, thấy được) của các HĐ NT trong trang — MỘT lọc `frame_root_id = any(mảng)` theo index
 *  `contracts_frame_idx`, cùng câu danh sách (số câu không đổi). */
export const childrenOf = (
  tid: string,
  want: boolean,
) => sql`case when ${want}::boolean then coalesce((select json_agg(
      json_build_object('frame_root_id', k.frame_root_id, 'id', k.id, 'doc_type', k.doc_type, 'title', k.title,
        'number', k.number, 'status', k.status, 'value', k.value) order by k.frame_root_id, k.start_date nulls last, k.id)
    from contracts.contracts k
    where k.tenant_id = ${tid}::uuid and k.frame_root_id = any(array(select c.root_id from p
        join contracts.contracts c on c.id = p.id and c.tenant_id = ${tid}::uuid where c.doc_type = 'framework'))
      and ${currentRow("k")}), '[]'::json) end`;

type ListChildRaw = { value: number | string | null } & Record<string, unknown>;
export const listChildren = (v: ListChildRaw[] | string | null | undefined) =>
  (typeof v === "string" ? (JSON.parse(v) as ListChildRaw[]) : (v ?? [])).map((k) => ({
    ...k,
    value: k.value === null ? null : Number(k.value),
  }));
