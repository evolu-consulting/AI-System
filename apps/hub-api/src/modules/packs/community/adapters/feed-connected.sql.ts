// CR-191 · BR-191-1/2/3 · phần «công ty đã kết nối» của bảng tin gộp: MỘT câu gọi `community.feed_connected` (community 0026, DEFINER) —
// DB tự kiểm kết nối (mỗi lần gọi), «Ai thấy bài», add-on, bản đã che. Không UNION trong RLS (tránh lộ chéo). Thời điểm ISO UTC micro giây.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PostType } from "../domain/audience.rules";

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
    select id::text, tenant_id::text, company_name, type, title_masked as title, body_masked as body, fields_masked as fields,
      cats, edited, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at, file_count,
      author_name, author_title, author_user_id::text as author_user_id
    from community.feed_connected(${f.cursor?.at ?? null}::timestamptz, ${f.cursor?.id ?? null}::uuid, ${f.take}::int,
      ${f.type}::text, ${f.source}::uuid)`);
  return rows.map((r) => ({
    ...r,
    // drizzle có thể trả jsonb thô
    fields: (typeof r.fields === "string"
      ? JSON.parse(r.fields)
      : r.fields) as ConnectedRow["fields"],
    file_count: Number(r.file_count),
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
