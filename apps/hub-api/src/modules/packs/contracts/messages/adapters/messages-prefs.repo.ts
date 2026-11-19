// CR-190 · SQL tuỳ chọn THEO NGƯỜI của hội thoại: ghim (`pinned_at`) + cờ «đánh dấu chưa đọc» (`marked_unread_at`) trong `contracts.msg_conv_prefs` (0126), dùng chung cho cuộc nội bộ
// (`internal`) và cuộc đối tác (`partner`). RLS: tenant + chỉ chính chủ (user = app.user_id). Mọi câu tham số; số câu cố định (không theo dòng).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { MessagesRepo, PrefState } from "../application/messages.ports";
import { iso, uuidArr } from "./messages.sql";

type Row = { id?: string; pinned_at: string | null; marked_unread: boolean };
const stateOf = (r: Row | undefined): PrefState => ({
  pinned_at: r?.pinned_at ?? null,
  marked_unread: r?.marked_unread === true,
});

export function prefsRepo(
  tx: Tx,
  t: string,
): Pick<MessagesRepo, "prefsOf" | "setPref" | "clearUnreadMark"> {
  return {
    prefsOf: async (me, ids) => {
      const out = new Map<string, PrefState>();
      if (ids.length === 0) return out;
      const rows = await tx.execute<
        Row & { id: string }
      >(sql`select p.conv_id as id, ${iso("p.pinned_at")} as pinned_at,
          p.marked_unread_at is not null as marked_unread
        from contracts.msg_conv_prefs p
        where p.tenant_id = ${t}::uuid and p.user_id = ${me}::uuid and p.conv_id = any(${uuidArr(ids)}::uuid[])`);
      for (const r of rows) out.set(r.id, stateOf(r));
      return out;
    },
    // Bật = upsert (giữ mốc cũ nếu đã bật). Tắt = xoá hàng nếu cột kia cũng trống, ngược lại chỉ NULL cột này (hai tập hàng rời nhau ⇒ một câu CTE an toàn).
    setPref: async (me, kind, cid, col, on) => {
      const key = sql`p.tenant_id = ${t}::uuid and p.user_id = ${me}::uuid and p.conv_kind = ${kind} and p.conv_id = ${cid}::uuid`;
      const c = sql.raw(col);
      const other = sql.raw(col === "pinned_at" ? "marked_unread_at" : "pinned_at");
      if (on) {
        const [r] =
          await tx.execute<Row>(sql`insert into contracts.msg_conv_prefs as p (tenant_id, user_id, conv_kind, conv_id, ${c})
          values (${t}::uuid, ${me}::uuid, ${kind}, ${cid}::uuid, now())
          on conflict (tenant_id, user_id, conv_kind, conv_id) do update set ${c} = coalesce(p.${c}, now()), updated_at = now()
          returning ${iso("p.pinned_at")} as pinned_at, p.marked_unread_at is not null as marked_unread`);
        return stateOf(r);
      }
      const [r] = await tx.execute<Row>(sql`with
        d as (delete from contracts.msg_conv_prefs p where ${key} and p.${other} is null returning 1),
        u as (update contracts.msg_conv_prefs p set ${c} = null, updated_at = now() where ${key} and p.${other} is not null
          returning ${iso("p.pinned_at")} as pinned_at, p.marked_unread_at is not null as marked_unread)
        select (select pinned_at from u) as pinned_at, coalesce((select marked_unread from u), false) as marked_unread
        from (select count(*) from d) x`);
      return stateOf(r);
    },
    clearUnreadMark: async (me, kind, cid) => {
      const key = sql`p.tenant_id = ${t}::uuid and p.user_id = ${me}::uuid and p.conv_kind = ${kind} and p.conv_id = ${cid}::uuid
        and p.marked_unread_at is not null`;
      await tx.execute(sql`with
        d as (delete from contracts.msg_conv_prefs p where ${key} and p.pinned_at is null returning 1),
        u as (update contracts.msg_conv_prefs p set marked_unread_at = null, updated_at = now() where ${key} and p.pinned_at is not null returning 1)
        select (select count(*) from d) + (select count(*) from u)`);
    },
  };
}
