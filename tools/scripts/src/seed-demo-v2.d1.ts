// CR-097 D1 · phần dữ liệu minh hoạ tính năng MỚI cho tenant `demo` (nạp cùng seed-demo-v2, cùng tx, id ổn định ⇒ nạp lại ra đúng
// cùng dữ liệu; chỉ tenant demo vì seedDemo đã chặn khoá khác). Gồm: (1) HĐ khoá + chuỗi phiên bản (c6 v1 bị thay bởi v2) (2) Giao dịch
// (CR-101 DOC-deals: chứng từ `doc_type = 'deal'`, bảng G1 `transactions*` chỉ đọc) — một giao dịch mốc còn mở + một đã giao (thu tiền
// còn mở, không dòng kho) (3) đối tác MỚI · tạm tính (Khách lẻ: 2 việc < min_events) (4) đối tác cờ đỏ (Tân Phát: không giao).
// Luồng duyệt mặc định = suy khi đọc (`approval_flows` trống ⇒ `is_default`) nên không cần dữ liệu.
// HĐ khoá: HĐ `active` của demo đã được trigger K1 khoá khi chèn (locked_at), "Chưa có văn bản" = HĐ không `file_id` (mọi HĐ trừ c1).
// Giao dịch không khoá (K1 bỏ qua `deal`).
import type postgres from "postgres";
import { type Actors, addDays, partnerOf, partyKeyOf, type Row, uid } from "./seed-demo-v2.build";

type Tx = postgres.TransactionSql;

/** HĐ mẫu cho chuỗi phiên bản: c6 (mua băng keo Tân Phát) — mọi mốc đã xong ⇒ cutover không phải huỷ nghĩa vụ nào. */
export const CHAIN = { base: "c6", next: "c6v2", newValue: 800000, newEnd: "2025-03-31" } as const;

export const DEAL_IDS = {
  open: uid("contract", "deal-open"),
  done: uid("contract", "deal-done"),
} as const;

const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });

export type DealSeed = {
  contract: Row;
  item: Row;
  milestones: Row[];
};

/** Hai giao dịch: mua băng keo Tân Phát (giao + trả còn mở) · bán token USB Khách lẻ (đã giao, thu còn mở). Tổng = SL × đơn giá. */
export function dealSeeds(tenant: string, a: Actors, today: string): DealSeed[] {
  const d = (n: number) => addDays(today, n);
  const one = (o: {
    id: string;
    key: "open" | "done";
    deal: "buy" | "sell";
    partner: "tanphat" | "lekhach";
    title: string;
    source: string;
    by: string;
    day: number;
    due: number;
    item: { name: string; unit: string; qty: number; price: number; product: string | null };
  }): DealSeed => {
    const p = partnerOf(o.partner);
    const side = o.deal === "buy" ? "supplier" : "buyer";
    const total = o.item.qty * o.item.price;
    const flow = o.deal === "buy" ? "pay" : "receive";
    const ms = (
      k: string,
      kind: string,
      seq: number,
      due: string,
      done: boolean,
      title: string,
      amount: number | null,
    ) => ({
      id: uid("ms", `deal-${o.key}:${k}`),
      tenant_id: tenant,
      contract_id: o.id,
      party_key: partyKeyOf(o.partner),
      direction: flow,
      kind,
      seq,
      due_date: due,
      amount,
      status: done ? "done" : "open",
      done_at: done ? due : null,
      done_by: done ? o.by : null,
      source: "default",
      title,
    });
    return {
      contract: {
        id: o.id,
        tenant_id: tenant,
        title: o.title,
        direction: o.deal === "buy" ? "purchase" : "sale",
        deal: o.deal,
        source: o.source,
        owner_user_id: o.by,
        created_by: o.by,
        created_at: `${d(o.day)}T08:00:00Z`,
        fields: {
          [`${side}_name`]: fv(p.name),
          [`${side}_tax_id`]: fv(p.tax),
          start_date: fv(d(o.day)),
          total_value: fv(total),
        },
      },
      item: {
        id: uid("contract_item", `deal-${o.key}`),
        tenant_id: tenant,
        contract_id: o.id,
        ord: 0,
        name: o.item.name,
        unit: o.item.unit,
        qty: o.item.qty,
        unit_price: o.item.price,
        product_id: o.item.product ? uid("product", o.item.product) : null,
        component_ids: o.item.product ? [uid("comp", o.item.product)] : null,
      },
      milestones: [
        ms("give", "delivery", 1, d(o.day), o.key === "done", "Giao hàng", null),
        ms(
          "money",
          "payment",
          2,
          d(o.due),
          false,
          o.deal === "buy" ? "Thanh toán" : "Thu tiền",
          total,
        ),
      ],
    };
  };
  return [
    one({
      id: DEAL_IDS.open,
      key: "open",
      deal: "buy",
      partner: "tanphat",
      title: "Giao dịch mua băng keo",
      source: "quote",
      by: a.editor,
      day: -1,
      due: 14,
      item: { name: "Băng keo 5cm", unit: "cuộn", qty: 100, price: 3800, product: "bangkeo" },
    }),
    one({
      id: DEAL_IDS.done,
      key: "done",
      deal: "sell",
      partner: "lekhach",
      title: "Bán lẻ token USB tại quầy",
      source: "invoice",
      by: a.owner,
      day: -6,
      due: 8,
      item: { name: "Token USB bán lẻ", unit: "cái", qty: 2, price: 650000, product: null },
    }),
  ];
}

/** Giao dịch = chứng từ `deal` (như `POST /contracts/deals`): HĐ + dòng + mốc + event `created_deal`; 4 câu theo tập. */
export async function loadDeals(tx: Tx, tenant: string, a: Actors, today: string): Promise<void> {
  const s = dealSeeds(tenant, a, today);
  const j = (rows: Row[]) => JSON.stringify(rows);
  await tx.unsafe(
    `insert into contracts.contracts (id, tenant_id, kind, doc_type, source, title, direction, deal, status, owner_user_id,
       created_by, created_at, updated_at, confirmed_at, confirmed_by, fields)
     select x.id, x.tenant_id, 'contract', 'deal', x.source, x.title, x.direction, x.deal, 'active', x.owner_user_id,
       x.created_by, x.created_at, x.created_at, x.created_at, x.created_by, x.fields
     from jsonb_to_recordset($1::text::jsonb) as x(id uuid, tenant_id uuid, source text, title text, direction text, deal text,
       owner_user_id uuid, created_by uuid, created_at timestamptz, fields jsonb)`,
    [j(s.map((x) => x.contract))],
  );
  await tx.unsafe(
    `insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited,
       product_id, component_ids)
     select x.id, x.tenant_id, x.contract_id, x.ord, x.name, x.unit, x.qty, x.unit_price, true, true, x.product_id,
       (select array_agg(e::uuid) from jsonb_array_elements_text(x.component_ids) e)
     from jsonb_to_recordset($1::text::jsonb) as x(id uuid, tenant_id uuid, contract_id uuid, ord int, name text, unit text,
       qty numeric, unit_price bigint, product_id uuid, component_ids jsonb)`,
    [j(s.map((x) => x.item))],
  );
  await tx.unsafe(
    `insert into contracts.obligations (id, tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, status,
       done_at, done_by, source, title)
     select x.id, x.tenant_id, x.contract_id, x.party_key, x.direction, x.kind, x.seq, x.due_date, x.amount, x.status,
       x.done_at, x.done_by, x.source, x.title
     from jsonb_to_recordset($1::text::jsonb) as x(id uuid, tenant_id uuid, contract_id uuid, party_key text, direction text,
       kind text, seq int, due_date date, amount bigint, status text, done_at date, done_by uuid, source text, title text)`,
    [j(s.flatMap((x) => x.milestones))],
  );
  await tx.unsafe(
    `insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, at, data)
     select x.tenant_id, x.id, 'created_deal', x.created_by, x.created_at, jsonb_build_object('source', x.source)
     from jsonb_to_recordset($1::text::jsonb) as x(id uuid, tenant_id uuid, created_by uuid, created_at timestamptz,
       source text)`,
    [j(s.map((x) => x.contract))],
  );
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
