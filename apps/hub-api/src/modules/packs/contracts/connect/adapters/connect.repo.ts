// CR-161 · lát 5 · SQL của kết nối hai công ty. Mỗi hàm MỘT câu gọi hàm DEFINER hub 0145 (role `contracts_rw`, GUC `app.tenant_id`/`app.user_id`
// do `withPackScope` đặt). Thời điểm trả về dạng ISO UTC (`to_char`, giữ micro giây để con trỏ keyset không lệch). Lô jsonb: `::text::jsonb`
// (postgres.js mã hoá `::jsonb` thành chuỗi JSON ⇒ «lô phải là mảng»).
import type {
  ConnectCompany,
  ConnectCompanyPage,
  ConnectInviteBy,
  ConnectLink,
  ConnectListing,
  ConnectStatus,
} from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { CcBell, CcOwner, ConnectRepo } from "../application/connect.ports";
import type { Cursor } from "../domain/connect.codec";
import { isContractsLink } from "../domain/connect.codec";

const ISO = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

export function connectRepo(tx: Tx, tid: string): ConnectRepo {
  return {
    /** R2 · một câu (`hub.cc_search`), ≤ 20 dòng, kèm trạng thái R7. */
    async search(q: string): Promise<ConnectCompany[]> {
      const rows = await tx.execute<{
        tenant_id: string;
        legal_name: string;
        tax_code: string | null;
        verified: boolean;
        status: ConnectStatus;
      }>(
        sql`select tenant_id::text, legal_name, tax_code, verified, status from hub.cc_search(${q})`,
      );
      return rows.map((r) => ({ ...r, tax_code: r.tax_code ?? "" }));
    },
    /** R3 · trả `ConnectStatus` (nhìn từ bên mời). Người mời phải là người Toàn quyền (DB kiểm lại, 42501). */
    async invite(to: string, note: string | null, userId: string, userName: string) {
      const [r] = await tx.execute<{ s: ConnectStatus }>(
        sql`select hub.cc_invite(${to}::uuid, ${note}, ${userId}::uuid, ${userName}) as s`,
      );
      return (r?.s ?? "none") as ConnectStatus;
    },
    /** R4 · chỉ bên nhận (tenant hiện tại). Thay thân của hàm cũ, hai chiều khi là lời mời kết nối. */
    async accept(from: string): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(
        sql`select hub.partner_link_accept(${from}::uuid) as ok`,
      );
      return r?.ok === true;
    },
    /** R5 + BR-191-10 · từ chối = chặn có sẵn + ghi lý do (≤ 300, DB kiểm). */
    async decline(from: string, reason: string | null): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(
        sql`select hub.cc_decline(${from}::uuid, ${reason}) as ok`,
      );
      return r?.ok === true;
    },
    /** BR-191-10 · thu hồi lời mời đã gửi. */
    async withdraw(to: string): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(sql`select hub.cc_withdraw(${to}::uuid) as ok`);
      return r?.ok === true;
    },
    /** BR-191-11 · DB là nguồn quyết định (cùng hàm `cc_invite` dùng). */
    async canInvite(userId: string): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(
        sql`select hub.cc_can_invite(${userId}::uuid) as ok`,
      );
      return r?.ok === true;
    },
    async inviteBy(): Promise<ConnectInviteBy> {
      const [r] = await tx.execute<{ by: ConnectInviteBy }>(
        sql`select invite_by as by from contracts.connect_settings where tenant_id = ${tid}::uuid`,
      );
      return r?.by ?? "admin";
    },
    async listing(): Promise<ConnectListing> {
      const [r] = await tx.execute<{ listed: boolean; has_profile: boolean }>(
        sql`select listed, has_profile from hub.cc_listing()`,
      );
      return { listed: r?.listed === true, has_profile: r?.has_profile === true };
    },
    async setListed(listed: boolean, actor: string): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(
        sql`select hub.cc_set_listed(${listed}, ${actor}::uuid) as ok`,
      );
      return r?.ok === true;
    },
    /** Audit cấp công ty (cùng tx với đổi cờ; ghi lỗi ⇒ rollback). */
    async auditListed(actor: string, listed: boolean): Promise<void> {
      const st = (v: boolean) => JSON.stringify({ kind: "cc_listed", directory_listed: v });
      await tx.execute(sql`insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
        values (${tid}::uuid, ${actor}::uuid, ${st(!listed)}::text::jsonb, ${st(listed)}::text::jsonb)`);
    },
    async setInviteBy(by: ConnectInviteBy, actor: string): Promise<void> {
      await tx.execute(sql`insert into contracts.connect_settings (tenant_id, invite_by, updated_by)
        values (${tid}::uuid, ${by}, ${actor}::uuid)
        on conflict (tenant_id) do update set invite_by = excluded.invite_by, updated_by = excluded.updated_by, updated_at = now()`);
    },
    async company(id: string): Promise<ConnectCompanyPage | null> {
      const [r] = await tx.execute<{
        tenant_id: string;
        legal_name: string;
        tax_code: string | null;
        verified: boolean;
        address: string | null;
        cover: string | null;
        status: ConnectStatus;
      }>(
        sql`select tenant_id::text, legal_name, tax_code, verified, address, cover, status from hub.cc_company_page(${id}::uuid)`,
      );
      return r ? { ...r, tax_code: r.tax_code ?? "" } : null;
    },
    /** R6 · xoá hai dòng chưa chặn; chưa connected ⇒ CC409 CONNECT_NOT_CONNECTED. */
    async disconnect(other: string): Promise<boolean> {
      const [r] = await tx.execute<{ ok: boolean }>(
        sql`select hub.cc_disconnect(${other}::uuid) as ok`,
      );
      return r?.ok === true;
    },
    async connected(other: string): Promise<boolean> {
      const [r] = await tx.execute<{ c: boolean }>(
        sql`select hub.cc_connected(${tid}::uuid, ${other}::uuid) as c`,
      );
      return r?.c === true;
    },
    /** Danh sách (một câu, keyset `(since, tenant_id)` DESC; CR-169: không còn `unread` — tin chưa đọc nằm ở Tin nhắn). Xin `limit` dòng (route xin limit+1). */
    async links(status: string | null, cur: Cursor | null, limit: number): Promise<ConnectLink[]> {
      const rows = await tx.execute<{
        tenant_id: string;
        legal_name: string | null;
        tax_code: string | null;
        verified: boolean;
        status: ConnectStatus;
        note: string | null;
        invited_by_name: string | null;
        since: string;
      }>(sql`select tenant_id::text, legal_name, tax_code, verified, status, note, invited_by_name,
          to_char(since at time zone 'UTC', ${ISO}) as since
        from hub.cc_links(${status}, ${cur?.t ?? null}::timestamptz, ${cur?.id ?? null}::uuid, ${limit}::int)`);
      return rows.map((r) => ({
        ...r,
        legal_name: r.legal_name ?? "",
        tax_code: r.tax_code ?? "",
      }));
    },
    /** Người Toàn quyền của các công ty (≤ 100) đang liên quan tới tenant hiện tại — nguồn người nhận `cc.link`. Một câu. */
    owners(tenants: readonly string[]): Promise<CcOwner[]> {
      return tx.execute<CcOwner>(sql`select tenant_id::text, user_id::text
        from hub.cc_owner_users(array(select x::uuid from jsonb_array_elements_text(${JSON.stringify(tenants)}::text::jsonb) x))`);
    },
    /** Chuông cho công ty khác (≤ 500, một câu). Link phải dạng `/contracts/...`, không thì ném — không bao giờ gửi link lạ. */
    async notify(batch: readonly CcBell[]): Promise<number> {
      if (batch.some((b) => !isContractsLink(b.link)))
        throw new Error("cc_notify: link ngoài /contracts");
      const [r] = await tx.execute<{ n: number }>(
        sql`select hub.cc_notify(${JSON.stringify(batch)}::text::jsonb) as n`,
      );
      return Number(r?.n ?? 0);
    },
    /** Audit «ngắt kết nối» (R6): DB không biết người thao tác và `hub.audit_log` không nhận action này ⇒ nhật ký cấp công ty của gói
     *  (`contracts.approval_settings_audit`, chỉ thêm). Cùng tx với ngắt: ghi lỗi ⇒ rollback. */
    async auditDisconnect(actor: string, other: string): Promise<void> {
      const st = (status: string) =>
        JSON.stringify({ kind: "cc_link", other_tenant: other, status });
      await tx.execute(sql`insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
        values (${tid}::uuid, ${actor}::uuid, ${st("connected")}::text::jsonb, ${st("none")}::text::jsonb)`);
    },
  };
}
