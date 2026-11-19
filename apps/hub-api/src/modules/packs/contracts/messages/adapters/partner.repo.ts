// CR-169 · lát 3a · SQL cuộc `partner` + danh bạ/công ty: chỉ GỌI hàm DEFINER `hub.pmsg_*` (hub 0149/0150/0152) trong tx `PackUow` (role `contracts_rw`).
// Người dùng KHÔNG là tham số: hàm đọc `app.tenant_id`/`app.user_id`. Mỗi thao tác đúng một câu (hàm làm gộp theo tập, không vòng lặp).
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type {
  PartnerCompanyRow,
  PartnerDirHead,
  PartnerDirRow,
  PartnerPersonRow,
  PartnerRepo,
  RawAttachment,
  RawConversation,
  RawMessage,
  RawSearchHit,
} from "../application/messages.ports";
import { iso, uuidArr } from "./messages.sql";

type DetailRow = {
  id: string;
  peer_user: string;
  peer_name: string;
  peer_title: string | null;
  peer_active: boolean;
  company_id: string;
  company_name: string;
  last: RawConversation["last"];
  unread: number;
  last_at: string;
  read_only: boolean;
  my_read_seq: string | number;
  peer_read_seq: string | number;
};

/** drizzle/postgres.js có thể trả jsonb đã parse hoặc chuỗi. */
const jsonOf = <T>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
const idsJson = (ids: readonly string[]) => JSON.stringify(ids);
const msgOf = (m: RawMessage): RawMessage => ({ ...m, seq: Number(m.seq) });

export function partnerRepo(tx: Tx, tid: string): PartnerRepo {
  return {
    async open(tenant, user) {
      const [r] = await tx.execute<{ id: string; created: boolean }>(
        sql`select id, created from hub.pmsg_open(${tenant}::uuid, ${user}::uuid)`,
      );
      if (!r) throw new Error("pmsg_open: không trả dòng");
      return r;
    },
    async detail(id) {
      const [r] =
        await tx.execute<DetailRow>(sql`select d.id, d.peer_user, d.peer_name, d.peer_title, d.peer_active, d.company_id,
          d.company_name, d.last, d.unread, ${iso("d.last_at")} as last_at, d.read_only, d.my_read_seq, d.peer_read_seq
        from hub.pmsg_detail(${id}::uuid) d`);
      if (!r) return null;
      return {
        id: r.id,
        kind: "partner",
        title: null,
        last_at: r.last_at,
        member_count: 2,
        peer_id: r.peer_user,
        unread: r.unread,
        last: r.last,
        my_role: "member",
        members: null,
        partner: {
          peer_name: r.peer_name,
          peer_title: r.peer_title,
          peer_active: r.peer_active,
          company_id: r.company_id,
          company_name: r.company_name,
          read_only: r.read_only,
          my_read_seq: Number(r.my_read_seq),
          peer_read_seq: Number(r.peer_read_seq),
        },
      };
    },
    people(q) {
      // `tenants` qua MỘT tham số jsonb (không phụ thuộc số công ty), hàm lọc `= any(array)`.
      return tx.execute<PartnerPersonRow>(sql`select user_id, name, job_title, tenant_id, company_name, department_id, department_name, sort_key
        from hub.pmsg_people(${q.tenants === null ? null : sql`array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(q.tenants)}::text::jsonb) x)`},
          ${q.q}::text, ${q.cur?.key ?? null}::text, ${q.cur?.id ?? null}::uuid, ${q.limit}::int)`);
    },
    companies(cur, limit) {
      return tx.execute<PartnerCompanyRow>(sql`select company_id, name, sort_key
        from hub.pmsg_companies(${cur?.key ?? null}::text, ${cur?.id ?? null}::uuid, ${limit}::int)`);
    },
    dirHeads(company, q, flagged) {
      return tx.execute<PartnerDirHead>(sql`select company_id, name, total, unread
        from hub.pmsg_dir_heads(${company}::uuid, ${q}::text, ${uuidArr(flagged)}::uuid[])`);
    },
    async dirRows(a) {
      const rows = await tx.execute<
        Omit<PartnerDirRow, "last"> & { last: PartnerDirRow["last"] | string }
      >(
        sql`select company_id, company_name, user_id, name, job_title, thread_id, last, ${iso("last_at")} as last_at, unread, peer_active, read_only, k1, k2, k3
        from hub.pmsg_dir_rows(${a.company}::uuid, ${a.q}::text, ${uuidArr(a.pinned)}::uuid[], ${uuidArr(a.flagged)}::uuid[],
          ${a.cur?.k1 ?? null}::int, ${a.cur?.k2 ?? null}::numeric, ${a.cur?.k3 ?? null}::text, ${a.cur?.id ?? null}::uuid, ${a.limit}::int)`,
      );
      return rows.map((r) => ({ ...r, last: r.last === null ? null : jsonOf(r.last) }));
    },
    async page(id, before, limit) {
      const [r] = await tx.execute<{ items: RawMessage[] | string; has_more: boolean }>(
        sql`select items, has_more from hub.pmsg_page(${id}::uuid, ${before}::bigint, ${limit}::int)`,
      );
      return r
        ? { items: jsonOf(r.items).map(msgOf), has_more: r.has_more }
        : { items: [], has_more: false };
    },
    async send(m) {
      // `file_ids` qua MỘT tham số JSON (số tệp ≤ 10 không đổi SQL văn bản).
      const [r] = await tx.execute<{
        seq: string | number;
        created: boolean;
        message: RawMessage | string;
        notify: { tenant_id: string; user_id: string }[] | string;
      }>(sql`select seq::text as seq, created, message, notify from hub.pmsg_send(${m.id}::uuid, ${m.clientId}::uuid, ${m.body},
          array(select x::uuid from jsonb_array_elements_text(${idsJson(m.fileIds)}::text::jsonb) x))`);
      if (!r) throw new Error("pmsg_send: không có kết quả");
      return {
        seq: Number(r.seq),
        created: r.created,
        message: msgOf(jsonOf(r.message)),
        notify: jsonOf(r.notify),
      };
    },
    async remove(id, seq) {
      const [r] = await tx.execute<{ b: string[] | string | null }>(
        sql`select hub.pmsg_delete(${id}::uuid, ${seq}::bigint) as b`,
      );
      const b = r?.b ?? [];
      // text[] có thể về dạng mảng hoặc literal `{a,b}` tuỳ driver; id FileBox chỉ gồm [A-Za-z0-9_-] (DB kiểm).
      return typeof b === "string"
        ? b
            .replace(/^{|}$/g, "")
            .split(",")
            .filter((x) => x.length > 0)
        : b;
    },
    async markRead(id, seq) {
      const [r] = await tx.execute<{ n: string | number }>(
        sql`select hub.pmsg_mark_read(${id}::uuid, ${seq}::bigint)::text as n`,
      );
      return Number(r?.n ?? 0);
    },
    attachments(id, q) {
      return tx.execute<RawAttachment>(sql`select a.id, a.name, a.mime, a.size::int as size, a.seq::int as seq, a.sender_user as sender_id,
          a.sender_name, ${iso("a.at")} as at
        from hub.pmsg_files_list(${id}::uuid, ${q.kind}::text, ${q.cur?.seq ?? null}::bigint, ${q.cur?.id ?? null}::uuid, ${q.limit}::int) a`);
    },
    search(q) {
      return tx.execute<RawSearchHit>(sql`select s.conversation_id, 'partner'::text as kind, null::text as title, s.seq::int as seq, s.sender_user as sender_id,
          s.sender_name, ${iso("s.at")} as at, s.body, s.peer_user as peer_id, s.peer_name, s.company_id, s.company_name
        from hub.pmsg_search(${q.pattern}::text, ${q.conversationId}::uuid, ${q.cur?.at ?? null}::timestamptz, ${q.cur?.cid ?? null}::uuid,
          ${q.cur?.seq ?? null}::bigint, ${q.limit}::int) s`);
    },
    async connected(company) {
      const [r] = await tx.execute<{ c: boolean }>(
        sql`select hub.cc_connected(${tid}::uuid, ${company}::uuid) as c`,
      );
      return r?.c === true;
    },
    async fileAdd(id, f) {
      const [r] = await tx.execute<{
        f: { id: string; name: string; mime: string; size: number } | string;
      }>(
        sql`select hub.pmsg_file_add(${id}::uuid, ${f.fileId}::uuid, ${f.boxId}, ${f.name}, ${f.mime}, ${f.size}::bigint, ${f.key}) as f`,
      );
      if (!r) throw new Error("pmsg_file_add: không có kết quả");
      const file = jsonOf(r.f);
      return { ...file, size: Number(file.size) };
    },
    async fileGet(id, fileId) {
      const [r] = await tx.execute<{ storage_key: string; box_file_id: string }>(
        sql`select storage_key, box_file_id from hub.pmsg_file_get(${id}::uuid, ${fileId}::uuid)`,
      );
      return r ? { key: r.storage_key, boxId: r.box_file_id } : null;
    },
  };
}

/** Việc nền: scope `system` (hub_rw), MỘT câu `hub.pmsg_files_sweep` (soft-delete tệp chưa gắn tin quá `older`, tối thiểu 1 giờ). */
export type PartnerSweepClaim = () => Promise<{ id: string; key: string; boxId: string }[]>;
export function partnerFilesSweepClaim(db: Db, older = "24 hours"): PartnerSweepClaim {
  return () =>
    withHubScope(db, { kind: "system" }, async (tx) => {
      const rows = await tx.execute<{ file_id: string; storage_key: string; box_file_id: string }>(
        sql`select file_id::text, storage_key, box_file_id from hub.pmsg_files_sweep(${older}::interval)`,
      );
      return rows.map((r) => ({ id: r.file_id, key: r.storage_key, boxId: r.box_file_id }));
    });
}
