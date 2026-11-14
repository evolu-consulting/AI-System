// CR-161 · lát 5 · bài Bảng tin công khai của công ty đã kết nối (R10): MỘT câu gọi `community.cc_posts` (community 0020, DEFINER).
// DB tự kiểm connected (không ⇒ 42501), bản đã che, add-on Bảng tin của bên đăng (không ⇒ rỗng). Trả ISO UTC giữ micro giây.
import type { CcPost } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PostsRepo } from "../application/connect.ports";
import type { Cursor } from "../domain/connect.codec";

export function postsRepo(tx: Tx): PostsRepo {
  return {
    async page(owner: string, cur: Cursor | null, limit: number): Promise<CcPost[]> {
      const rows = await tx.execute<{
        id: string;
        type: "sell" | "buy" | "note";
        title_masked: string;
        body_masked: string;
        fields_masked: Record<string, unknown> | string;
        cats: string[];
        created_at: string;
        file_count: number;
      }>(sql`select id::text, type, title_masked, body_masked, fields_masked, cats,
          to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at, file_count
        from community.cc_posts(${owner}::uuid, ${cur?.t ?? null}::timestamptz, ${cur?.id ?? null}::uuid, ${limit}::int)`);
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        title: r.title_masked,
        body: r.body_masked,
        fields: typeof r.fields_masked === "string" ? JSON.parse(r.fields_masked) : r.fields_masked, // drizzle có thể trả jsonb thô
        cats: r.cats,
        created_at: r.created_at,
        file_count: Number(r.file_count),
      }));
    },
  };
}
