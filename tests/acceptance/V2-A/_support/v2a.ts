// V2-A · hạ tầng int: như HD7 (DB sạch, hub-api THẬT, admin-api THẬT; HĐ dựng bằng owner; `manual` = HĐ chờ xác nhận + `POST /contracts/:id/review` từ CR-097).
// Cờ duyệt (C3) đặt thẳng hàng `approval_settings.approval_enabled` của tenant và TRẢ LẠI sau file (không rò sang HD3). Đỏ NGAY
// nếu thiếu migration 0022. Không chứa `it(...)`.
import { expect } from "bun:test";
import { insContract, unlockContract } from "../../HD1/_support/hd1";
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
        or (table_name = 'obligations' and column_name in ('title', 'owner', 'fault', 'qty'))
        or (table_name = 'approval_settings' and column_name = 'approval_enabled'))) as cols,
    to_regprocedure('contracts.approval_on()') is not null as fn`;
  expect({ v2a_migration_0022: r }).toEqual({ v2a_migration_0022: { cols: 9, fn: true } });
}

export async function arrangeV2a(c: CtxN1): Promise<void> {
  await needV2a(c.sql);
  await arrangeHd7(c);
}

const touched = new Set<string>();
/** Bật/tắt duyệt của tenant (null = mặc định theo tenant). Ghi nhớ để `restoreApproval` gỡ. */
export async function setApproval(sql: Sql, tenant: string, on: boolean | null): Promise<void> {
  const [had] = await sql<
    { n: number }[]
  >`select count(*)::int as n from contracts.approval_settings
    where tenant_id = ${tenant}`;
  if (!had?.n) touched.add(tenant);
  await sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${tenant}, ${on})
    on conflict (tenant_id) do update set approval_enabled = excluded.approval_enabled`;
}
export async function restoreApproval(sql: Sql): Promise<void> {
  await sql`update contracts.approval_settings set approval_enabled = null`;
  for (const t of touched)
    await sql`delete from contracts.approval_settings where tenant_id = ${t}`;
  touched.clear();
}

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
    status: "needs_review",
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
  const saved = await ok(call(c, p, "POST", `/contracts/${id}/review`, body));
  if (!b.keepLocked) await unlockContract(c.sql, id); // lock-strict: fixture "mở" để test thao tác mốc
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
