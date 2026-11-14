// CR-161 · lát 6 · SQL trò chuyện hai công ty. Mỗi hàm MỘT câu gọi hàm DEFINER hub 0146 (role `contracts_rw`; `app.tenant_id`/`app.user_id` do
// `withPackScope` đặt; DB tự kiểm người Toàn quyền ⇒ 42501). Mảng uuid truyền qua MỘT tham số JSON (`::text::jsonb`, postgres.js mã hoá `::jsonb`
// thành chuỗi). `created_at` của tin là ISO có offset của PG ⇒ chuẩn hoá `Z` (zod `iso.datetime`). Việc nền dọn tệp = `ccFilesSweepClaim` (scope system).
import type { CcFile, CcMessage } from "@ai/contracts/pack-contracts";
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type {
  ChatFileNew,
  ChatFileRef,
  ChatPage,
  ChatRepo,
  ChatSent,
  ChatSweepClaim,
} from "../application/chat.ports";
import type { CcOwner } from "../application/connect.ports";

/** drizzle/postgres.js có thể trả jsonb đã parse hoặc chuỗi. */
const jsonOf = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const msgOf = (m: CcMessage): CcMessage => ({
  ...m,
  seq: Number(m.seq),
  created_at: new Date(m.created_at).toISOString(),
});
const idsJson = (ids: readonly string[]) => JSON.stringify(ids);

export function chatRepo(tx: Tx, tid: string): ChatRepo {
  return {
    /** Trang tin (seq giảm dần). Chưa từng kết nối ⇒ CC404 `CONNECT_NO_THREAD`. Xin `limit` dòng (use case xin limit+1). */
    async page(other, before, limit): Promise<ChatPage> {
      const [r] = await tx.execute<{
        read_only: boolean;
        last_read_seq: string | number;
        items: CcMessage[] | string;
      }>(
        sql`select read_only, last_read_seq::text as last_read_seq, items
          from hub.cc_thread_page(${other}::uuid, ${before}::bigint, ${limit}::int)`,
      );
      if (!r) return { read_only: true, last_read_seq: 0, items: [] };
      return {
        read_only: r.read_only,
        last_read_seq: Number(r.last_read_seq),
        items: jsonOf(r.items).map(msgOf),
      };
    },
    /** R8 · gửi tin (idempotent theo `client_id`) + chuông + danh sách người nhận stream: MỘT lần gọi. */
    async send(other, clientId, userName, body, fileIds): Promise<ChatSent> {
      const [r] = await tx.execute<{
        seq: string | number;
        created: boolean;
        message: CcMessage | string;
        notify: CcOwner[] | string;
      }>(sql`select seq::text as seq, created, message, notify
        from hub.cc_send(${other}::uuid, ${clientId}::uuid, ${userName}, ${body},
          array(select x::uuid from jsonb_array_elements_text(${idsJson(fileIds)}::text::jsonb) x))`);
      if (!r) throw new Error("cc_send: không có kết quả");
      return {
        seq: Number(r.seq),
        created: r.created,
        message: msgOf(jsonOf(r.message)),
        notify: jsonOf(r.notify),
      };
    },
    async markRead(other, seq): Promise<number> {
      const [r] = await tx.execute<{ n: string | number }>(
        sql`select hub.cc_mark_read(${other}::uuid, ${seq}::bigint)::text as n`,
      );
      return Number(r?.n ?? 0);
    },
    async connected(other): Promise<boolean> {
      const [r] = await tx.execute<{ c: boolean }>(
        sql`select hub.cc_connected(${tid}::uuid, ${other}::uuid) as c`,
      );
      return r?.c === true;
    },
    /** R11 · ghi dòng tệp (id = uuid route sinh, khoá `<tenant>/<id>`, `boxId` = `file_id` FileBox). Kiểm trong hàm: CC409 / CC422 `MSG_FILE_INVALID`. */
    async fileAdd(other, f: ChatFileNew): Promise<CcFile> {
      const [r] = await tx.execute<{ f: CcFile | string }>(
        sql`select hub.cc_file_add(${other}::uuid, ${f.id}::uuid, ${f.boxId}, ${f.name}, ${f.mime}, ${f.size}::bigint, ${f.key}) as f`,
      );
      if (!r) throw new Error("cc_file_add: không có kết quả");
      const file = jsonOf(r.f);
      return { ...file, size: Number(file.size) };
    },
    async fileRef(fileId): Promise<ChatFileRef | null> {
      const [r] = await tx.execute<{ storage_key: string; box_file_id: string }>(
        sql`select storage_key, box_file_id from hub.cc_file_get(${fileId}::uuid)`,
      );
      return r ? { key: r.storage_key, boxId: r.box_file_id } : null;
    },
  };
}

/** Việc nền (R11): scope `system` (hub_rw), MỘT câu `hub.cc_files_sweep` (soft-delete tệp chưa gắn tin quá `older`). */
export function ccFilesSweepClaim(db: Db, older = "24 hours"): ChatSweepClaim {
  return () =>
    withHubScope(db, { kind: "system" }, async (tx) => {
      const rows = await tx.execute<{ file_id: string; storage_key: string; box_file_id: string }>(
        sql`select file_id::text, storage_key, box_file_id from hub.cc_files_sweep(${older}::interval)`,
      );
      return rows.map((r) => ({ id: r.file_id, key: r.storage_key, boxId: r.box_file_id }));
    });
}
