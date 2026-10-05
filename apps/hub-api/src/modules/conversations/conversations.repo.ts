// HUB-FR-40 · HUB-BR-14 · Drizzle query bảng `hub.conversations` (plan H1 §3.2). Gọi trong `withHubScope(user)`:
// RLS lọc theo (tenant, user) của JWT; câu vẫn lọc `tenant_id` + `user_id` tường minh (H1-R03, CONVENTIONS "luôn lọc tenant").
import type { Tx } from "@ai/db";
import { conversations } from "@ai/db/schema/hub";
import { and, desc, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { AttachmentRefRow, ConversationRow, PageKey } from "./conversations.rules";

export type Owner = { tenantId: string; userId: string };

/** Khoá cursor dạng chuỗi UTC đủ µs (khớp `PageKey`). */
export const keyAt = (col: AnyPgColumn) =>
  sql<string>`to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/** Thời điểm ghi cắt về ms: JSON trả ms, nên thứ tự (ms, id) client thấy khớp thứ tự DB. */
export const NOW_MS = sql`date_trunc('milliseconds', now())`;

const c = conversations;
// Bí danh tường minh: Drizzle in cột trong sql`` không kèm tên bảng (câu con tương quan sẽ trỏ nhầm bảng).
const flowCount = sql<number>`(select count(*)::int from hub.flows fc where fc.conversation_id = "conversations"."id")`;
const rowCols = {
  id: c.id,
  title: c.title,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  flowCount,
};

const live = (o: Owner): SQL =>
  and(eq(c.tenantId, o.tenantId), eq(c.userId, o.userId), isNull(c.deletedAt)) as SQL;

export async function listConversations(
  tx: Tx,
  o: Owner,
  p: { pattern?: string; after?: PageKey; limit: number },
): Promise<(ConversationRow & { key: PageKey })[]> {
  const conds: SQL[] = [live(o)];
  if (p.pattern !== undefined) conds.push(sql`${c.titleNorm} like ${p.pattern}`);
  if (p.after) {
    conds.push(sql`(${c.updatedAt}, ${c.id}) < (${p.after[0]}::timestamptz, ${p.after[1]}::uuid)`);
  }
  const rows = await tx
    .select({ ...rowCols, at: keyAt(c.updatedAt) })
    .from(c)
    .where(and(...conds))
    .orderBy(desc(c.updatedAt), desc(c.id))
    .limit(p.limit + 1);
  return rows.map(({ at, ...r }) => ({ ...r, key: [at, r.id] as const }));
}

/** Hội thoại còn sống của chủ; khác chủ / đã xoá / không có → null (route trả 404). */
export async function findConversation(
  tx: Tx,
  o: Owner,
  id: string,
): Promise<ConversationRow | null> {
  const [r] = await tx
    .select(rowCols)
    .from(c)
    .where(and(live(o), eq(c.id, id)));
  return r ?? null;
}

export async function insertConversation(
  tx: Tx,
  o: Owner,
  v: { title: string; titleNorm: string },
): Promise<ConversationRow> {
  const [r] = await tx
    .insert(c)
    .values({ tenantId: o.tenantId, userId: o.userId, ...v, createdAt: NOW_MS, updatedAt: NOW_MS })
    .returning({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt });
  if (!r) throw new Error("insert conversations returned no row");
  return { ...r, flowCount: 0 };
}

/** Đổi tên (khoá dòng hội thoại trước, plan §3.5); `updated_at` không lùi. Không thấy → false. */
export async function renameConversation(
  tx: Tx,
  o: Owner,
  id: string,
  v: { title: string; titleNorm: string },
): Promise<boolean> {
  const rows = await tx
    .update(c)
    .set({ ...v, updatedAt: sql`greatest(${c.updatedAt}, ${NOW_MS})` })
    .where(and(live(o), eq(c.id, id)))
    .returning({ id: c.id });
  return rows.length > 0;
}

/** Xoá mềm (E9 phần hội thoại). Đã xoá / không thấy → false. */
export async function softDeleteConversation(tx: Tx, o: Owner, id: string): Promise<boolean> {
  const rows = await tx
    .update(c)
    .set({ deletedAt: sql`now()` })
    .where(and(live(o), eq(c.id, id)))
    .returning({ id: c.id });
  return rows.length > 0;
}

/**
 * H2c-R12 (plan-db §2.6) · file của các tin trong trang (một câu cho cả trang E10/E11), theo `position`. Scope `user`
 * (RLS + lọc tường minh).
 */
export async function messageAttachments(
  tx: Tx,
  o: Owner,
  messageIds: readonly string[],
): Promise<Map<string, AttachmentRefRow[]>> {
  const out = new Map<string, AttachmentRefRow[]>();
  if (messageIds.length === 0) return out;
  const rows = await tx.execute<{
    message_id: string;
    id: string;
    filename: string;
    mime: AttachmentRefRow["mime"];
    size: string | number;
    purged_at: Date | string | null;
  }>(sql`select message_id, id, filename, mime, size, purged_at from hub.attachments
    where message_id = any(${`{${messageIds.join(",")}}`}::uuid[])
      and tenant_id = ${o.tenantId} and user_id = ${o.userId}
    order by message_id, position`);
  for (const r of rows) {
    const list = out.get(r.message_id) ?? [];
    const purgedAt = r.purged_at === null ? null : new Date(r.purged_at);
    list.push({ id: r.id, filename: r.filename, mime: r.mime, size: Number(r.size), purgedAt });
    out.set(r.message_id, list);
  }
  return out;
}
