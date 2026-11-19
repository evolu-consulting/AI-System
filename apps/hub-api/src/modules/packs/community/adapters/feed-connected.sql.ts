// CR-191 · BR-191-1/2/3 · phần «công ty đã kết nối» của bảng tin gộp: MỘT câu gọi `community.feed_connected` (community 0026, DEFINER) —
// DB tự kiểm kết nối (mỗi lần gọi), «Ai thấy bài», add-on, bản đã che. Không UNION trong RLS (tránh lộ chéo). Thời điểm ISO UTC micro giây.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PostType } from "../domain/audience.rules";
import type { CommentRow } from "./comment-list.repo";

export type ConnectedRow = {
  id: string;
  tenant_id: string;
  company_name: string;
  type: PostType;
  title: string;
  body: string;
  fields: Record<string, string | null>;
  cats: string[];
  edited: boolean;
  created_at: string;
  file_count: number;
  author_name: string;
  author_title: string | null;
  /** CR-191 BR-191-13 · mã người đăng (hàm 0031) ⇒ web lấy ảnh qua `GET /people?ids=`; hàm chỉ chạy cho người xem nội bộ. */
  author_user_id: string;
  /** CR-191 · bình luận chéo người xem thấy: số + 3 mới nhất (mới → cũ). */
  comment_count: number;
  recent: CommentRow[] | null;
};

export type ConnectedFilter = {
  cursor: { at: string; id: string } | null;
  /** Số hàng xin (route xin limit + 1). */
  take: number;
  type: PostType | null;
  /** Chỉ một công ty đã kết nối (id tenant); null = mọi công ty. */
  source: string | null;
};

export async function connectedQuery(tx: Tx, f: ConnectedFilter): Promise<ConnectedRow[]> {
  const rows = await tx.execute<Omit<ConnectedRow, "fields"> & { fields: unknown }>(sql`
    with f as (select * from community.feed_connected(${f.cursor?.at ?? null}::timestamptz, ${f.cursor?.id ?? null}::uuid,
      ${f.take}::int, ${f.type}::text, ${f.source}::uuid))
    select f.id::text, f.tenant_id::text, f.company_name, f.type, f.title_masked as title, f.body_masked as body,
      f.fields_masked as fields, f.cats, f.edited,
      to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at, f.file_count,
      f.author_name, f.author_title, f.author_user_id::text as author_user_id, coalesce(d.n, 0) as comment_count, d.recent
    from f left join community.cross_comment_digest(array(select f.id from f)) d on d.post_id = f.id
    order by f.created_at desc, f.id desc`);
  return rows.map((r) => ({
    ...r,
    // drizzle có thể trả jsonb thô
    fields: (typeof r.fields === "string"
      ? JSON.parse(r.fields)
      : r.fields) as ConnectedRow["fields"],
    file_count: Number(r.file_count),
    comment_count: Number(r.comment_count),
  }));
}

/** Id tenant trong `ids` KHÔNG phải công ty đã kết nối (MỘT câu; rỗng ⇒ hợp lệ). Dùng khi lưu «Ai thấy bài» chọn công ty. */
export async function notConnected(tx: Tx, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.execute<{ id: string }>(sql`
    select t::text as id from unnest(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid)) t
    where t not in (select c from hub.cc_connected_ids() c)`);
  return rows.map((r) => r.id);
}
