// CR-182 · đợt 2 · SQL của «Đối tác ký qua link» (tx `PackUow`, role `contracts_rw`). Mỗi thao tác MỘT câu văn bản hằng; `tenant_id` tường minh.
// Đường CÔNG KHAI chỉ đi qua hàm DEFINER theo BĂM token (`partner_sign_link_open/quick_put/quick_get/finish`, migration 0123) — bảng không lộ.
// Phía công ty đọc/ghi bảng link dưới RLS tenant.
import type { PartnerQuickMethod } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  CloseCode,
  ContactRow,
  LinkRow,
  LinkStatusRow,
  PartnerSignRepo,
} from "../application/partner-sign.repo.port";

const hex = (h: string) => sql`decode(${h}, 'hex')`;

/** Cài cổng `PartnerSignRepo` (application) bằng SQL trong tx của `PackUow`. */
export function partnerSignRepo(tx: Tx, tenantId: string): PartnerSignRepo {
  return {
    /** Tra link theo BĂM token (DEFINER). `audit` ⇒ ghi `opened_at` lần đầu. */
    open: async (th: string, audit: boolean): Promise<LinkRow | null> => {
      const [r] = await tx.execute<LinkRow>(
        sql`select * from contracts.partner_sign_link_open(${hex(th)}, ${audit})`,
      );
      return r ?? null;
    },
    quickPut: async (
      th: string,
      method: PartnerQuickMethod,
      pngB64: string,
    ): Promise<CloseCode> => {
      const [r] = await tx.execute<{ c: CloseCode }>(
        sql`select contracts.partner_sign_quick_put(${hex(th)}, ${method}, decode(${pngB64}, 'base64')) as c`,
      );
      return r?.c ?? "invalid";
    },
    quickGet: async (th: string): Promise<{ id: string; png: Uint8Array } | null> => {
      const [r] = await tx.execute<{ id: string; b64: string }>(
        sql`select id, encode(png, 'base64') as b64 from contracts.partner_sign_quick_get(${hex(th)})`,
      );
      return r ? { id: r.id, png: new Uint8Array(Buffer.from(r.b64, "base64")) } : null;
    },
    finish: async (th: string, how: "sign" | "decline", why: string | null): Promise<CloseCode> => {
      const [r] = await tx.execute<{ c: CloseCode }>(
        sql`select contracts.partner_sign_finish(${hex(th)}, ${how}, ${why}) as c`,
      );
      return r?.c ?? "invalid";
    },
    /** Khoá hàng link FOR UPDATE (DEFINER) ⇒ trạng thái: open | signed | declined | expired | revoked | invalid. */
    lockState: async (th: string): Promise<string> => {
      const [r] = await tx.execute<{ s: string }>(
        sql`select contracts.partner_sign_lock(${hex(th)}) as s`,
      );
      return r?.s ?? "invalid";
    },
    /** `run_id` của bản ký đối tác mới nhất chưa huỷ (= lượt mà link đã ký). null nếu không có. */
    signedRun: async (contractId: string): Promise<string | null> => {
      const [r] = await tx.execute<{
        run: string | null;
      }>(sql`select run_id::text as run from contracts.sign_versions
        where tenant_id = ${tenantId}::uuid and contract_id = ${contractId}::uuid and signer_contact_id is not null and voided_at is null
        order by created_at desc, id desc limit 1`);
      return r?.run ?? null;
    },
    /** Số bản đối tác (liên hệ này) đã Lưu trên HĐ — trần chống dồn bản. */
    versionCount: async (contractId: string, contactId: string): Promise<number> => {
      const [r] = await tx.execute<{
        n: number;
      }>(sql`select count(*)::int as n from contracts.sign_versions
        where tenant_id = ${tenantId}::uuid and contract_id = ${contractId}::uuid and signer_contact_id = ${contactId}::uuid`);
      return Number(r?.n ?? 0);
    },
    contract: async (contractId: string) => {
      const [r] = await tx.execute<{ title: string; created_by: string; company_name: string }>(sql`
        select c.title, c.created_by::text as created_by, coalesce(contracts.tenant_name(), '') as company_name
        from contracts.contracts c where c.id = ${contractId}::uuid and c.tenant_id = ${tenantId}::uuid`);
      return r ?? null;
    },
    /** Liên hệ nhận link: đối tác của HĐ, liên hệ đầu tiên CÓ email (cùng thứ tự `sign-doc.repo.partner`). */
    firstContact: async (contractId: string): Promise<ContactRow | null> => {
      const [r] = await tx.execute<ContactRow>(sql`
        select pc.id::text as id, pc.name, pc.email, p.name as partner_name
        from contracts.contracts c
        left join lateral contracts.partner_role_of(c) p on true
        left join lateral (select x.id, x.name, x.email from contracts.partner_contacts x
          where x.tenant_id = c.tenant_id and x.party_key = p.party_key and x.email is not null and btrim(x.email) <> ''
          order by x.sort, x.created_at, x.id limit 1) pc on true
        where c.id = ${contractId}::uuid and c.tenant_id = ${tenantId}::uuid`);
      return r?.id ? r : null;
    },
    contact: async (contactId: string, contractId: string): Promise<ContactRow | null> => {
      const [r] = await tx.execute<ContactRow>(sql`
        select x.id::text as id, x.name, x.email, p.name as partner_name
        from contracts.partner_contacts x join contracts.contracts c on c.tenant_id = x.tenant_id
        left join lateral contracts.partner_role_of(c) p on true
        where x.id = ${contactId}::uuid and x.tenant_id = ${tenantId}::uuid and c.id = ${contractId}::uuid`);
      return r ?? null;
    },
    /** Khoá theo HĐ (hết tx) — hai nơi cùng muốn tạo link không tạo trùng. */
    lock: async (contractId: string): Promise<void> => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`partner-sign:${contractId}`}, 0))`,
      );
    },
    /** Link CHƯA chốt của HĐ (chưa thu hồi, chưa ký, chưa từ chối — hết hạn vẫn tính: «Gửi lại» mới tạo mới). */
    hasActive: async (contractId: string): Promise<boolean> => {
      const rows = await tx.execute<{ id: string }>(sql`
        select id from contracts.partner_sign_links
        where tenant_id = ${tenantId}::uuid and contract_id = ${contractId}::uuid
          and revoked_at is null and signed_at is null and declined_at is null limit 1`);
      return rows.length > 0;
    },
    revokeActive: async (contractId: string): Promise<number> =>
      (
        await tx.execute<{ id: string }>(sql`
          update contracts.partner_sign_links set revoked_at = now()
          where tenant_id = ${tenantId}::uuid and contract_id = ${contractId}::uuid
            and revoked_at is null and signed_at is null and declined_at is null returning id`)
      ).length,
    insert: async (l: {
      id: string;
      contractId: string;
      contactId: string;
      hash: string;
      expiresAt: Date;
      by: string;
    }): Promise<void> => {
      await tx.execute(sql`
        insert into contracts.partner_sign_links (id, tenant_id, contract_id, contact_id, token_hash, expires_at, created_by)
        values (${l.id}::uuid, ${tenantId}::uuid, ${l.contractId}::uuid, ${l.contactId}::uuid, ${hex(l.hash)},
          ${l.expiresAt.toISOString()}::timestamptz, ${l.by}::uuid)`);
    },
    markSent: async (linkId: string): Promise<void> => {
      await tx.execute(sql`update contracts.partner_sign_links set sent_at = now()
        where id = ${linkId}::uuid and tenant_id = ${tenantId}::uuid and sent_at is null`);
    },
    /** Link mới nhất của HĐ + tên liên hệ (phiên ký / trang HĐ). Không lộ email, không lộ băm. */
    latest: async (contractId: string): Promise<LinkStatusRow | null> => {
      const [r] = await tx.execute<LinkStatusRow>(sql`
        select case when l.revoked_at is not null then 'revoked' when l.signed_at is not null then 'signed'
            when l.declined_at is not null then 'declined' when l.expires_at <= now() then 'expired' else 'open' end as state,
          l.sent_at, l.opened_at, l.expires_at, l.signed_at, l.declined_at, l.decline_reason, pc.name as contact_name
        from contracts.partner_sign_links l
        left join contracts.partner_contacts pc on pc.id = l.contact_id and pc.tenant_id = l.tenant_id
        where l.tenant_id = ${tenantId}::uuid and l.contract_id = ${contractId}::uuid
        order by l.created_at desc, l.id desc limit 1`);
      return r ?? null;
    },
    /** Tệp ra của MỘT bản chưa huỷ (đối tác không xem bản đã huỷ). */
    versionOut: async (contractId: string, fileId: string, versionId: string) => {
      const [r] = await tx.execute<{ org: string; box_id: string; name: string }>(sql`
        select f.org, f.file_id as box_id, f.name from contracts.sign_versions v
        join contracts.files f on f.id = v.out_file_id and f.tenant_id = v.tenant_id and f.deleted_at is null
        where v.id = ${versionId}::uuid and v.contract_id = ${contractId}::uuid and v.file_id = ${fileId}::uuid
          and v.tenant_id = ${tenantId}::uuid and v.voided_at is null`);
      return r ?? null;
    },
  };
}
