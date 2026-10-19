// HD-FR-91…97 · hạ tầng int HD9: như HD1 (`startHd1`: DB sạch X2a, hub-api THẬT in-process + admin-api THẬT, FileBox giả).
// Thêm: dọn bảng `contracts.cks_*` (HD1 `truncateAll` không biết chúng), bộ dữ liệu `world` = `mgmt-app/api/tests/test_cks.py`,
// ngày tương đối theo múi giờ tenant mặc định (Asia/Ho_Chi_Minh, BR-6). Không chứa `it(...)`. Đỏ NGAY nếu thiếu bảng CKS.
import { expect } from "bun:test";
import {
  arrange,
  type CtxN1,
  captureSql,
  getWith,
  type Json,
  jsonWith,
  measure,
  P,
  type Res,
  type Sql,
  startHd1,
  T,
} from "../../HD1/_support/hd1";

export type { CtxN1, Json, Res, Sql };
export { captureSql, getWith, jsonWith, measure, P, startHd1, T };

type Person = (typeof P)[keyof typeof P];

export const KBASE = "/pack/contracts/cks";
export const CKS_TABLES = [
  "cks_price_audit",
  "cks_followups",
  "cks_signed_docs",
  "cks_renewals",
  "cks_certificates",
  "cks_lots",
  "cks_customers",
  "cks_market_prices",
] as const;

export async function hasCks(sql: Sql): Promise<boolean> {
  const regs = CKS_TABLES.map((t) => `to_regclass('contracts.${t}') is not null`).join(" and ");
  const [r] = await sql.unsafe<{ ok: boolean }[]>(`select ${regs} as ok`);
  return r?.ok === true;
}

/** HD1 `arrange` (dọn HĐ, bật quyền) + dọn CKS. Đỏ ngay với lý do rõ nếu migration CKS chưa có. */
export async function arrangeCks(c: CtxN1): Promise<void> {
  expect({ hd9_migration_cks: await hasCks(c.sql) }).toEqual({ hd9_migration_cks: true });
  await c.sql.unsafe(`truncate ${CKS_TABLES.map((t) => `contracts.${t}`).join(", ")}`);
  await arrange(c);
}

/** Hôm nay ± n ngày theo Asia/Ho_Chi_Minh (YYYY-MM-DD) — cùng luật "hôm nay" của server (BR-6). */
export function d(n: number, now = Date.now()): string {
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export const kcall = (c: CtxN1, p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${KBASE}${path}`, body);

/** POST thành công (201/200) hoặc đỏ kèm thân lỗi. */
export async function ok(r: Promise<Res>): Promise<Json> {
  const x = await r;
  expect({
    status: x.status < 300 ? "ok" : x.status,
    body: x.status < 300 ? null : x.json,
  }).toEqual({ status: "ok", body: null });
  return x.json;
}

export type World = { lot: Json; bv: Json; ba: Json; tt: Json };
/** Bộ dữ liệu của `test_cks.py::world`: một lô Viettel 5 chữ ký, Bếp Việt (3, hết hạn sau 9 ngày), Bình An (1, hết hạn
 *  6 ngày trước), Cơ khí Tân Tiến tự mua FPT-CA (hết hạn sau 15 ngày). Người tạo: hoa (editor). */
export async function world(c: CtxN1): Promise<World> {
  const lot = await ok(
    kcall(c, P.hoa, "POST", "/lots", {
      ca: "Viettel-CA",
      qty: 5,
      unit_cost: 1_100_000,
      years: 1,
      bought_at: d(-200),
      label: "2026-03",
      device: "token",
    }),
  );
  const bv = await ok(
    kcall(c, P.hoa, "POST", "/sales", {
      company_name: "Bếp Việt",
      company_tax_id: "0312340001",
      lot_id: lot.id,
      price_each: 1_650_000,
      signed_at: d(-356),
      valid_to: d(9),
      holders: [
        {
          name: "Chữ ký công ty",
          serial: "5401 0B72 33AF 9E10",
          keeper: "Trần Thu Hà",
          device: "token",
        },
        { name: "Lê Văn Tâm", title: "Giám đốc", device: "remote", serial: "5401 0B72 33AF 9E11" },
        {
          name: "Trần Thu Hà",
          title: "Kế toán trưởng",
          device: "remote",
          serial: "5401 0B72 33AF 9E12",
        },
      ],
    }),
  );
  const ba = await ok(
    kcall(c, P.hoa, "POST", "/sales", {
      company_name: "Thực phẩm Sạch Bình An",
      company_tax_id: "0312340002",
      lot_id: lot.id,
      price_each: 1_600_000,
      signed_at: d(-371),
      valid_to: d(-6),
      holders: [{ name: "Chữ ký công ty", device: "token" }],
    }),
  );
  const tt = await ok(
    kcall(c, P.hoa, "POST", "/certificates", {
      company_name: "Cơ khí Tân Tiến",
      company_tax_id: "0312340003",
      ca: "FPT-CA",
      serial: "FPT-1",
      valid_to: d(15),
      device: "token",
    }),
  );
  return { lot, bv, ba, tt };
}

/** Khách theo tên (đỏ rõ nếu không có). */
export async function customerNamed(c: CtxN1, name: string, p: Person = P.lan): Promise<Json> {
  const r = await kcall(c, p, "GET", `/customers?q=${encodeURIComponent(name)}`);
  expect(r.status).toBe(200);
  const row = (r.json.items as Json[]).find((x) => x.name === name);
  expect({ customer: name, found: row !== undefined }).toEqual({ customer: name, found: true });
  const full = await kcall(c, p, "GET", `/customers/${row.company_id}`);
  expect(full.status).toBe(200);
  return full.json;
}

/** Nhật ký giá của tenant (cũ → mới), theo thứ tự ghi. */
export async function audit(sql: Sql, tenant: string = T.acme) {
  return sql<
    {
      entity: string;
      field: string;
      old_value: string | null;
      new_value: string | null;
      actor: string;
    }[]
  >`select entity, field, old_value::text, new_value::text, actor_user_id::text as actor
    from contracts.cks_price_audit where tenant_id = ${tenant} order by id`;
}
