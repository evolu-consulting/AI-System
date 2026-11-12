// V2-A · hạ tầng int: như HD7 (DB sạch, hub-api THẬT, admin-api THẬT; HĐ dựng bằng owner; `manual` = HĐ chờ xác nhận + `POST /contracts/:id/review` từ CR-097).
// Cờ duyệt (C3) đặt thẳng hàng `approval_settings.approval_enabled` của tenant và TRẢ LẠI sau file (không rò sang HD3). Đỏ NGAY
// nếu thiếu migration 0022. Không chứa `it(...)`.
import { expect } from "bun:test";
import { withFlowEngine } from "../../_support/flow-engine";
import { insContract, setLegacyStatus, unlockContract } from "../../HD1/_support/hd1";
import {
  arrangeHd7,
  type CtxN1,
  call,
  d,
  deal,
  type Json,
  ok,
  P,
  type Res,
  type Sql,
  startHd1,
  T,
} from "../../HD7/_support/hd7";

export type { CtxN1, Json, Res, Sql };
export { call, d, deal, ok, P, startHd1, T };

type Person = (typeof P)[keyof typeof P];

export async function needV2a(sql: Sql): Promise<void> {
  const [r] = await sql<{ cols: number; fn: boolean }[]>`select
    (select count(*)::int from information_schema.columns where table_schema = 'contracts'
      and ((table_name = 'contracts' and column_name in ('deal', 'commission_pct', 'commission_fixed', 'start_date'))
        or (table_name = 'obligations' and column_name in ('title', 'owner', 'fault', 'qty')))) as cols,
    to_regprocedure('contracts.approval_on()') is not null as fn`;
  // CR-127 Z1b: cờ `approval_enabled` + hàm `approval_on()` đã gỡ (0099).
  expect({ v2a_migration_0022: r }).toEqual({ v2a_migration_0022: { cols: 8, fn: false } });
}

export async function arrangeV2a(c: CtxN1): Promise<void> {
  await needV2a(c.sql);
  await arrangeHd7(c);
}

/** CR-127 Z1b: cờ duyệt đã gỡ (HĐ đi qua quy trình khớp, không có công tắc) ⇒ no-op, giữ chữ ký cho test cũ; ca dựa trên "bật duyệt" phải bỏ/viết lại. */
export async function setApproval(_sql: Sql, _tenant: string, _on: boolean | null): Promise<void> {}
export async function restoreApproval(_sql: Sql): Promise<void> {}

export type Manual = {
  deal?: "buy" | "sell" | "referral";
  direction?: "sale" | "purchase";
  title?: string;
  partner_name?: string;
  start_date?: string | null;
  end_date?: string | null;
  total_value?: number | null;
  commission_pct?: number | null;
  commission_fixed?: number | null;
  /** lock-strict: giữ nguyên khoá sau xác nhận (mặc định gỡ khoá để test thao tác mốc). */
  keepLocked?: boolean;
};
/** `POST /contracts/manual` (editor) — thân thô. CR-097: nhập tay đã ngừng ⇒ luôn 410 `MANUAL_CONTRACT_DISABLED`. */
export const manualRaw = (c: CtxN1, b: Manual, p: Person = P.hoa) =>
  call(c, p, "POST", "/contracts/manual", {
    title: "HĐ V2-A",
    partner_name: "Đối tác V2",
    ...b,
  });

const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });
/** CR-097 (qc): HĐ dựng như HĐ tải lên chờ xác nhận (owner, `needs_review`, không tệp) rồi "Lưu" ở màn xác nhận
 *  (`POST /contracts/:id/review` — cùng luật mốc mặc định / hoa hồng / cờ duyệt mà nhập tay dùng). Trả `{id, status, …}`. */
export async function manual(c: CtxN1, b: Manual, p: Person = P.hoa): Promise<Json> {
  const id = crypto.randomUUID();
  const dl = b.deal ?? (b.direction === "purchase" ? "buy" : "sell");
  const party = b.partner_name ?? "Đối tác V2";
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    title: b.title ?? "HĐ V2-A",
    status: "draft",
    owner: p.id,
    createdBy: p.id,
    direction: dl === "buy" ? "purchase" : "sale",
    fields: {
      title: fv(b.title ?? "HĐ V2-A"),
      [dl === "buy" ? "supplier_name" : "buyer_name"]: fv(party),
      start_date: fv(b.start_date ?? null),
      end_date: fv(b.end_date ?? null),
      total_value: fv(b.total_value ?? null),
    },
  } as never);
  const body: Json = { version: 1, deal: dl };
  if (b.commission_pct !== undefined) body.commission_pct = b.commission_pct;
  if (b.commission_fixed !== undefined) body.commission_fixed = b.commission_fixed;
  // CR-127 NF1: "Xác nhận & lưu" = Gửi ⇒ cần quy trình khớp (không có ⇒ 409 NO_APPROVAL_FLOW). Fixture chỉ cần phần LƯU (mốc mặc định,
  // hoa hồng, loại giao dịch) nên đặt tạm bộ tìm quy trình "luôn có" quanh đúng lệnh này, rồi trả lại như cũ.
  const saved = await withFlowEngine(() => ok(call(c, p, "POST", `/contracts/${id}/review`, body)));
  if (!b.keepLocked) {
    // lock-strict: fixture "mở" để test thao tác mốc — CR-127 K4: khoá nội dung theo status (processing/done) ⇒ đưa về draft.
    await unlockContract(c.sql, id);
    await setLegacyStatus(c.sql, id, "draft");
  }
  return saved;
}

export const detail = (c: CtxN1, id: string, p: Person = P.hoa): Promise<Json> =>
  ok(call(c, p, "GET", `/contracts/${id}`));

/** Mốc của HĐ (đọc thẳng DB, mọi trạng thái). */
export async function rowsOf(sql: Sql, contractId: string) {
  return sql<
    {
      id: string;
      kind: string;
      direction: string;
      owner: string;
      title: string | null;
      status: string;
      due_date: string;
      amount: string | null;
      qty: string | null;
      fault: string | null;
    }[]
  >`select id::text, kind, direction, owner, title, status, to_char(due_date, 'YYYY-MM-DD') as due_date,
      amount::text, qty::text, fault
    from contracts.obligations where contract_id = ${contractId} order by seq, created_at`;
}
