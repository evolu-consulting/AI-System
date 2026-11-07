// CR-124 · q3 · FLOW4-FR-01/15/17 · SQL bên GỬI (tx gói của tenant A, role contracts_rw). Mỗi hàm MỘT câu văn bản hằng + `tenant_id` tường minh
// (Luật 4c; đường gửi = số câu cố định). Gói KHÔNG đọc hộp thư/danh bạ trực tiếp: đi qua hàm DEFINER `hub.partner_*` (hub 0117–0119).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { PartnerChannel, RouteInfo } from "../domain/partner-send.rules";

export type SendContract = {
  title: string;
  fileId: string | null;
  partnerTax: string | null;
  partnerName: string | null;
  fields: Record<string, unknown>;
};
export type SendRow = {
  mailboxId: string;
  round: number;
  status: string;
  channel: PartnerChannel;
  toKey: string | null;
};

const asObj = (v: unknown): Record<string, unknown> => {
  const x = typeof v === "string" ? JSON.parse(v) : v;
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
};

export function partnerSendRepo(tx: Tx, tid: string) {
  return {
    /** HĐ cần gửi: tiêu đề, tệp, MST/tên đối tác theo hướng HĐ (sale ⇒ bên mua), các trường. */
    async contract(id: string): Promise<SendContract | null> {
      const [r] = await tx.execute<{
        title: string;
        file_id: string | null;
        tax: string | null;
        pname: string | null;
        fields: unknown;
      }>(sql`select c.title, c.file_id::text as file_id,
          nullif(btrim(c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_tax_id') ->> 'value'), '') as tax,
          nullif(btrim(c.fields -> (case when c.direction = 'sale' then 'buyer' else 'supplier' end || '_name') ->> 'value'), '') as pname,
          c.fields
        from contracts.contracts c where c.id = ${id}::uuid and c.tenant_id = ${tid}::uuid`);
      return r
        ? {
            title: r.title,
            fileId: r.file_id,
            partnerTax: r.tax,
            partnerName: r.pname,
            fields: asObj(r.fields),
          }
        : null;
    },
    /** Lần gửi gần nhất của HĐ (mở trước, rồi vòng cao nhất). */
    async latest(id: string): Promise<SendRow | null> {
      const [r] = await tx.execute<{
        mailbox_id: string;
        round: number;
        status: string;
        channel: PartnerChannel;
        to_key: string | null;
      }>(sql`select mailbox_id::text, round, status, channel, to_key from contracts.partner_sends
        where tenant_id = ${tid}::uuid and contract_id = ${id}::uuid
        order by (status = 'open') desc, round desc limit 1`);
      return r
        ? {
            mailboxId: r.mailbox_id,
            round: r.round,
            status: r.status,
            channel: r.channel,
            toKey: r.to_key,
          }
        : null;
    },
    /** Công ty nhận theo MST khớp đúng (chỉ công ty bật "cho phép tìm thấy") + trạng thái nối. */
    async route(tax: string): Promise<RouteInfo | null> {
      const [r] = await tx.execute<{
        to_tenant: string;
        name: string;
        verified: boolean;
        link: string;
      }>(sql`select to_tenant::text, name, verified, link from hub.partner_route(${tax})`);
      return r ? { toTenant: r.to_tenant, name: r.name, verified: r.verified, link: r.link } : null;
    },
    /** Lần đầu tới công ty chưa nối ⇒ gửi lời mời nối (idempotent, hàm DEFINER). */
    async requestLink(toTenant: string): Promise<string> {
      const [r] = await tx.execute<{ s: string }>(
        sql`select hub.partner_link_request(${toTenant}::uuid) as s`,
      );
      return r?.s ?? "pending";
    },
    /** Ghi hộp thư (hàm DEFINER, `from_tenant` = tenant hiện tại). Hạn tính bằng giờ DB. */
    async send(o: {
      toTenant: string | null;
      toEmail: string | null;
      channel: PartnerChannel;
      ref: string;
      payload: Record<string, unknown>;
      fileRef: string | null;
      days: number;
      prevId: string | null;
    }): Promise<string> {
      const [r] = await tx.execute<{
        id: string;
      }>(sql`select hub.partner_send(${tid}::uuid, ${o.toTenant}::uuid,
          ${o.toEmail}, ${o.channel}, ${o.ref}, ${JSON.stringify(o.payload)}::jsonb, ${o.fileRef}, null,
          now() + make_interval(days => ${o.days}::int), ${o.prevId}::uuid)::text as id`);
      if (!r) throw new Error("PARTNER_SEND_FAILED");
      return r.id;
    },
    async record(o: {
      contractId: string;
      mailboxId: string;
      round: number;
      channel: PartnerChannel;
      toKey: string;
      toName: string | null;
      runId: string | null;
      by: string;
    }): Promise<void> {
      await tx.execute(sql`insert into contracts.partner_sends
          (tenant_id, contract_id, mailbox_id, round, channel, to_key, to_name, process_run_id, created_by)
        values (${tid}::uuid, ${o.contractId}::uuid, ${o.mailboxId}::uuid, ${o.round}, ${o.channel}, ${o.toKey},
          ${o.toName}, ${o.runId}::uuid, ${o.by}::uuid)`);
    },
    /** Tên pháp lý/MST/dấu xác minh CÔNG KHAI của chính công ty (hiện ở lịch sử). */
    async self(): Promise<{ name: string; taxCode: string | null; verified: boolean } | null> {
      const [r] = await tx.execute<{ name: string; tax_code: string | null; verified: boolean }>(
        sql`select name, tax_code, verified from hub.partner_self()`,
      );
      return r ? { name: r.name, taxCode: r.tax_code, verified: r.verified } : null;
    },
    /** Đóng lần gửi theo câu trả lời (tenant GỬI). Chạy lại ⇒ 0 hàng. MỘT câu cho cả lô. */
    async closeReplies(
      rows: readonly { mailboxId: string; outcome: string; reason: string | null }[],
    ): Promise<number> {
      if (rows.length === 0) return 0;
      const r = await tx.execute<{ id: string }>(sql`update contracts.partner_sends s
          set status = x.outcome, reason = x.reason, closed_at = now()
        from jsonb_to_recordset(${JSON.stringify(
          rows.map((r) => ({ mailbox_id: r.mailboxId, outcome: r.outcome, reason: r.reason })),
        )}::jsonb) as x(mailbox_id uuid, outcome text, reason text)
        where s.tenant_id = ${tid}::uuid and s.mailbox_id = x.mailbox_id and s.status = 'open' returning s.id`);
      return r.length;
    },
  };
}
export type PartnerSendRepo = ReturnType<typeof partnerSendRepo>;
