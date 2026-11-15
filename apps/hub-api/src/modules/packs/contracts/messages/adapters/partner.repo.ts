// CR-169 · lát 3a · SQL cuộc `partner` + danh bạ/công ty: chỉ GỌI hàm DEFINER `hub.pmsg_*` (hub 0149/0150/0152) trong tx `PackUow` (role `contracts_rw`).
// Người dùng KHÔNG là tham số: hàm đọc `app.tenant_id`/`app.user_id`. Mỗi thao tác đúng một câu (hàm làm gộp theo tập, không vòng lặp).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  PartnerCompanyRow,
  PartnerPersonRow,
  PartnerRepo,
  RawConversation,
} from "../application/messages.ports";
import { iso } from "./messages.sql";

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

export function partnerRepo(tx: Tx): PartnerRepo {
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
  };
}
