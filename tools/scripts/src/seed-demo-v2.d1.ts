// CR-097 D1 · phần dữ liệu minh hoạ tính năng MỚI cho tenant `demo` (nạp cùng seed-demo-v2, cùng tx, id ổn định ⇒ nạp lại ra đúng
// cùng dữ liệu; chỉ tenant demo vì seedDemo đã chặn khoá khác). Gồm: (1) HĐ khoá + chuỗi phiên bản (c6 v1 bị thay bởi v2) (2) Giao dịch
// nháp + đã ghi sổ (nghĩa vụ lẻ, không dòng kho) (3) đối tác MỚI · tạm tính (Khách lẻ: 2 việc < min_events) (4) đối tác cờ đỏ
// (Tân Phát: không giao). Luồng duyệt mặc định = suy khi đọc (`approval_flows` trống ⇒ `is_default`) nên không cần dữ liệu.
// HĐ khoá: HĐ `active` của demo đã được trigger K1 khoá khi chèn (locked_at), "Chưa có văn bản" = HĐ không `file_id` (mọi HĐ trừ c1).
import type postgres from "postgres";
import { type Actors, addDays, partnerOf, partyKeyOf, type Row, uid } from "./seed-demo-v2.build";

type Tx = postgres.TransactionSql;

/** HĐ mẫu cho chuỗi phiên bản: c6 (mua băng keo Tân Phát) — mọi mốc đã xong ⇒ cutover không phải huỷ nghĩa vụ nào. */
export const CHAIN = { base: "c6", next: "c6v2", newValue: 800000, newEnd: "2025-03-31" } as const;

const T_DRAFT = "tx-draft";
const T_POSTED = "tx-posted";
export const TX_IDS = { draft: uid("tx", T_DRAFT), posted: uid("tx", T_POSTED) } as const;

const tanphat = () => partnerOf("tanphat");
const khach = () => partnerOf("lekhach");

export function txRows(tenant: string, a: Actors, today: string): Row[] {
  const d = (n: number) => addDays(today, n);
  const at = (n: number) => `${d(n)}T08:00:00Z`;
  return [
    {
      id: TX_IDS.draft,
      tenant_id: tenant,
      deal: "buy",
      status: "draft",
      rev: 0,
      occurred_on: d(-1),
      due_on: d(14),
      partner_name: tanphat().name,
      partner_tax_id: tanphat().tax,
      product_group: "goods",
      note: "Nháp: đặt thêm băng keo, chưa ghi sổ",
      total: 380000,
      created_by: a.editor,
      created_at: at(-1),
      posted_at: null,
      posted_by: null,
    },
    {
      id: TX_IDS.posted,
      tenant_id: tenant,
      deal: "sell",
      status: "posted",
      rev: 0,
      occurred_on: d(-6),
      due_on: d(8),
      partner_name: khach().name,
      partner_tax_id: khach().tax,
      product_group: "service",
      note: "Bán lẻ token USB tại quầy",
      total: 1300000,
      created_by: a.owner,
      created_at: at(-6),
      posted_at: at(-6),
      posted_by: a.owner,
    },
  ];
}

export function txLineRows(tenant: string): Row[] {
  return [
    {
      id: uid("txline", "draft-0"),
      tenant_id: tenant,
      transaction_id: TX_IDS.draft,
      rev: 0,
      ord: 0,
      name: "Băng keo 5cm",
      product_id: uid("product", "bangkeo"),
      component_ids: [uid("comp", "bangkeo")],
      unit: "cuộn",
      qty: 100,
      unit_price: 3800,
      amount: 380000,
    },
    {
      id: uid("txline", "posted-0"),
      tenant_id: tenant,
      transaction_id: TX_IDS.posted,
      rev: 0,
      ord: 0,
      name: "Token USB bán lẻ",
      product_id: null,
      component_ids: null,
      unit: "cái",
      qty: 2,
      unit_price: 650000,
      amount: 1300000,
    },
  ];
}

export function txEventRows(tenant: string, a: Actors, today: string): Row[] {
  const at = (n: number) => `${addDays(today, n)}T08:00:00Z`;
  const ev = (tx: string, type: string, by: string, n: number): Row => ({
    tenant_id: tenant,
    transaction_id: tx,
    type,
    actor_user_id: by,
    reason: null,
    data: {},
    at: at(n),
  });
  return [
    ev(TX_IDS.draft, "created", a.editor, -1),
    ev(TX_IDS.posted, "created", a.owner, -6),
    ev(TX_IDS.posted, "posted", a.owner, -6),
  ];
}

/** Sổ đối tác: Khách lẻ có 2 khoản thu (< min_events 3 ⇒ "MỚI · tạm tính"); Tân Phát bị báo "không giao" (cờ đỏ, có lý do). */
export function d1EventRows(tenant: string, a: Actors, today: string): Row[] {
  const base = {
    tenant_id: tenant,
    source: "action",
    contract_id: null,
    grp: null,
    job_type: null,
  };
  const recv = (n: number): Row => ({
    ...base,
    party_key: partyKeyOf("lekhach"),
    role: "customer",
    type: "received",
    at: addDays(today, n),
    by_user: a.owner,
    note: null,
  });
  return [
    recv(-20),
    recv(-8),
    {
      ...base,
      party_key: partyKeyOf("tanphat"),
      role: "supplier",
      type: "no_delivery",
      at: addDays(today, -4),
      by_user: a.owner,
      note: "Không giao thùng phi lô 2 dù đã chốt hạn, không liên lạc được",
    },
  ];
}

/** Nghĩa vụ thu của giao dịch đã ghi sổ (không có HĐ): một đợt `payment`, bán ⇒ thu (D4 GD-transactions). */
export async function loadTxObligation(tx: Tx, tenant: string, today: string): Promise<void> {
  await tx`insert into contracts.obligations (id, tenant_id, transaction_id, party_key, direction, kind, seq, due_date,
      amount, status, source, title)
    select ${uid("ms", "tx-posted:pay")}, t.tenant_id, t.id, t.party_key, 'receive', 'payment', t.rev + 1,
      ${addDays(today, 8)}::date, t.total, 'open', 'manual', 'Thu tiền bán lẻ token USB'
    from contracts.transactions t where t.tenant_id = ${tenant} and t.id = ${TX_IDS.posted}`;
}

/**
 * Chuỗi phiên bản: v2 của `CHAIN.base` (khoá sẵn, tiếp quản chủ phụ trách), v1 đánh dấu bị thay. Chèn bản sao từ v1 bằng một câu
 * (đổi tổng + ngày hết hạn trong `fields`). Cutover KHÔNG phải chạy trigger: v1 không còn mốc mở (xem `CHAIN`).
 */
export async function loadVersionChain(tx: Tx, tenant: string, today: string): Promise<void> {
  const v1 = uid("contract", CHAIN.base);
  const v2 = uid("contract", CHAIN.next);
  const at = `${addDays(today, -10)}T08:00:00Z`;
  await tx`insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, status, owner_user_id, created_by,
      created_at, confirmed_at, confirmed_by, fields, commission_pct, ai_read, root_id, version_no, supersedes_id)
    select ${v2}, tenant_id, kind, title || ' (bản cập nhật)', direction, deal, 'active', owner_user_id, created_by,
      ${at}::timestamptz, ${at}::timestamptz, confirmed_by,
      jsonb_set(jsonb_set(fields, '{total_value,value}', to_jsonb(${CHAIN.newValue}::bigint)),
        '{end_date,value}', to_jsonb(${CHAIN.newEnd}::text)),
      commission_pct, ai_read, root_id, 2, id
    from contracts.contracts where tenant_id = ${tenant} and id = ${v1}`;
  // Bản bị thay chỉ đọc (trigger K2 chặn sửa) ⇒ đánh dấu ở chế độ replica như bước xoá của seed.
  await tx.unsafe("set local session_replication_role = replica");
  await tx`update contracts.contracts set superseded_at = ${at}::timestamptz, superseded_by = ${v2}
    where tenant_id = ${tenant} and id = ${v1}`;
  await tx.unsafe("set local session_replication_role = origin");
}

/** Bảng của D1 cần xoá khi nạp lại (con trước cha không quan trọng: seed xoá ở chế độ replica). */
export const D1_WIPE = ["transaction_events", "transaction_lines", "transactions"] as const;
