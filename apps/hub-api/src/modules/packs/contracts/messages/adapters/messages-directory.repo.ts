// CR-190 · SQL danh bạ nhóm trang Tin nhắn phía gói (nội bộ `contracts.msg_*`): cuộc của người gọi bản nhẹ (kèm ghim/cờ) và id ghim/cờ của cuộc `partner` — mỗi việc MỘT câu, không theo dòng.
// Dòng đầy đủ (tin cuối…) chỉ lấy cho các dòng của trang (`conversationsByIds` ở messages.repo). RLS: thành viên + chỉ hàng tuỳ chọn của chính mình.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { logger } from "../../../../../lib/logger";
import type { MessagesRepo } from "../application/messages.ports";
import { iso } from "./messages.sql";

/** Trần số cuộc đọc nhẹ mỗi lần (một người có thể có tối đa ~một cuộc 1-1 cho mỗi đồng nghiệp + nhóm). */
const CONV_CAP = 3000;

export function directoryRepo(
  tx: Tx,
  t: string,
): Pick<MessagesRepo, "directoryConvs" | "partnerPrefs"> {
  return {
    directoryConvs: async (me) => {
      const rows = await tx.execute<{
        id: string;
        kind: "direct" | "group";
        title: string | null;
        peer_id: string | null;
        last_seq: number;
        last_at: string;
        unread: number;
        pinned_at: string | null;
        marked_unread: boolean;
        last_sender: string | null;
      }>(sql`select c.id, c.kind, c.title, c.last_seq::int as last_seq, ${iso("c.last_at")} as last_at, u.n as unread,
          ${iso("p.pinned_at")} as pinned_at, p.marked_unread_at is not null as marked_unread, ls.sender_id as last_sender,
          (select mm.user_id from contracts.msg_members mm where mm.tenant_id = c.tenant_id and mm.conversation_id = c.id
             and mm.user_id <> me.user_id and c.kind = 'direct' limit 1) as peer_id
        from contracts.msg_members me
        join contracts.msg_conversations c on c.tenant_id = me.tenant_id and c.id = me.conversation_id
        left join contracts.msg_conv_prefs p on p.tenant_id = me.tenant_id and p.user_id = me.user_id and p.conv_kind = 'internal' and p.conv_id = c.id
        left join lateral (select x.sender_id from contracts.msg_messages x
          where c.last_seq > 0 and x.tenant_id = c.tenant_id and x.conversation_id = c.id order by x.seq desc limit 1) ls on true
        cross join lateral (select count(*)::int as n from (select 1 from contracts.msg_messages x
            where c.last_seq > me.last_read_seq and x.tenant_id = c.tenant_id and x.conversation_id = c.id
              and x.seq > me.last_read_seq and x.sender_id <> me.user_id and x.deleted_at is null limit 100) s) u
        where me.tenant_id = ${t}::uuid and me.user_id = ${me}::uuid
        order by c.last_at desc, c.id desc limit ${CONV_CAP}::int`);
      if (rows.length >= CONV_CAP)
        logger.warn("msg-directory-convs-cap", { tenant_id: t, cap: CONV_CAP });
      return rows.map((r) => ({ ...r, last_seq: Number(r.last_seq) }));
    },
    partnerPrefs: async (me) => {
      const rows = await tx.execute<{ conv_id: string; pinned: boolean; marked: boolean }>(
        sql`select p.conv_id, p.pinned_at is not null as pinned, p.marked_unread_at is not null as marked
          from contracts.msg_conv_prefs p
          where p.tenant_id = ${t}::uuid and p.user_id = ${me}::uuid and p.conv_kind = 'partner'`,
      );
      return {
        pinned: rows.filter((r) => r.pinned).map((r) => r.conv_id),
        flagged: rows.filter((r) => r.marked).map((r) => r.conv_id),
      };
    },
  };
}
