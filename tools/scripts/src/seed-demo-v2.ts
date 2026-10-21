// V2-O · intake C8: nạp lại bộ mẫu v2 (theo mockup NITI) cho tenant `demo` — LẶP LẠI ĐƯỢC (xoá dữ liệu gói contracts của demo rồi nạp lại,
// id ổn định). CHỈ tenant có khoá đúng `demo`; mọi khoá khác (nhất là `nitigroup`) bị TỪ CHỐI trước khi chạm DB. Cần DATABASE_URL của
// chủ migration (siêu người dùng: tắt trigger/FK khi xoá, bỏ RLS). Mặc định chạy thử (chỉ đếm); `--apply` mới ghi.
//   bun tools/scripts/src/seed-demo-v2.ts --tenant demo [--apply]
// Người dùng lấy theo email của deploy/tenants/demo.yaml (demo-owner / demo-editor @example.invalid). KHÔNG chạy trên máy chủ trong lát V2-O.
import postgres from "postgres";
import {
  type Actors,
  contractRows,
  itemRows,
  milestoneItemRows,
  obligationRows,
  type Row,
  shiftOf,
  uid,
} from "./seed-demo-v2.build";
import {
  companyRows,
  jobRows,
  lockRows,
  manualRoleRows,
  noteRows,
  priceRows,
  productRows,
  ratingRows,
} from "./seed-demo-v2.build-people";
import { COLS } from "./seed-demo-v2.cols";
import { OWN } from "./seed-demo-v2.specs";
import { type StockPlan, stockPlan } from "./seed-demo-v2.stock";

export const DEMO_KEY = "demo";
export const DEMO_EMAILS = {
  owner: "demo-owner@example.invalid",
  editor: "demo-editor@example.invalid",
} as const;

/** Chặn cứng: chỉ đúng `demo`. */
export function assertDemo(key: string | undefined): asserts key is typeof DEMO_KEY {
  if (key !== DEMO_KEY)
    throw new Error(
      `seed-demo-v2: chỉ nạp cho tenant "${DEMO_KEY}" — từ chối "${key ?? ""}" (không đụng tenant khác, nhất là nitigroup)`,
    );
}

type Tx = postgres.TransactionSql;
type Ctx = { tx: Tx; tenant: string; a: Actors; today: string; shift: number; stock: StockPlan };

/** Chèn theo tập: một câu mỗi bảng (jsonb_to_recordset), cột theo `COLS`. */
async function ins(tx: Tx, table: string, rows: readonly Row[], tail = ""): Promise<void> {
  const cols = COLS[table] ?? [];
  if (rows.length === 0 || cols.length === 0) return;
  const name = (c: (typeof cols)[number]) =>
    typeof c === "string" ? (c.split(" ")[0] ?? c) : c[0];
  const def = cols.map((c) => (typeof c === "string" ? c : `${c[0]} ${c[1]}`)).join(", ");
  const exprs = cols.map((c) => (typeof c === "string" ? `x.${name(c)}` : (c[2] ?? `x.${c[0]}`)));
  await tx.unsafe(
    `insert into contracts.${table} (${cols.map(name).join(", ")}) select ${exprs.join(", ")} from jsonb_to_recordset($1::text::jsonb) as x(${def}) ${tail}`,
    [JSON.stringify(rows)],
  );
}

/** Bảng dữ liệu (có `tenant_id`) của gói contracts bị xoá khỏi tenant demo trước khi nạp lại; KHÔNG xoá cài đặt (approval/visibility/score_configs…). */
export const WIPE = [
  "contract_events",
  "contract_reminders",
  "contract_schedule",
  "contract_items",
  "milestone_items",
  "obligations",
  "approvals",
  "followups",
  "sourcing_choices",
  "partner_event_voids",
  "partner_events",
  "partner_roles",
  "partner_notes",
  "score_ratings",
  "score_locks",
  "score_lock_runs",
  "service_customers",
  "product_supplier_prices",
  "product_rules",
  "stock_moves",
  "stock_lots",
  "product_components",
  "products",
  "price_quotes",
  "market_observations",
  "companies",
  "contract_delete_log",
  "legacy_records",
  "cks_price_audit",
  "cks_followups",
  "cks_signed_docs",
  "cks_renewals",
  "cks_certificates",
  "cks_lots",
  "cks_customers",
  "cks_market_prices",
  "contracts",
] as const;

async function wipe(tx: Tx, tenant: string): Promise<void> {
  for (const t of WIPE)
    await tx.unsafe(`delete from contracts.${t} where tenant_id = $1`, [tenant]);
}

async function loadCatalog({ tx, tenant, a, shift, stock }: Ctx): Promise<void> {
  const cat = productRows(tenant, stock, a);
  await ins(tx, "companies", companyRows(tenant));
  await ins(tx, "products", cat.products);
  // Tồn/BQ ghi sau cùng, kèm dòng sổ khớp (trigger bảo vệ): chèn thành phần với số 0 trước.
  await ins(
    tx,
    "product_components",
    cat.comps.map((c) => ({ ...c, on_hand: 0, stock_value: 0, avg_cost: 0, last_move_id: null })),
  );
  await ins(tx, "product_rules", cat.rules);
  await ins(tx, "product_supplier_prices", priceRows(tenant, a, shift));
}

async function loadContracts({ tx, tenant, a, shift, stock }: Ctx): Promise<void> {
  await ins(tx, "contracts", contractRows(a, tenant, shift));
  await ins(tx, "contract_items", itemRows(tenant));
  await ins(tx, "obligations", obligationRows(a, tenant, shift));
  await ins(tx, "milestone_items", milestoneItemRows(a, tenant));
  await ins(tx, "stock_lots", stock.lots);
  await ins(tx, "stock_moves", stock.moves);
  const moved = productRows(tenant, stock, a).comps.filter((c) => c.last_move_id);
  await tx.unsafe(
    `update contracts.product_components c set on_hand = x.on_hand, stock_value = x.stock_value, avg_cost = x.avg_cost, last_move_id = x.last_move_id
     from jsonb_to_recordset($1::text::jsonb) as x(id uuid, on_hand numeric, stock_value bigint, avg_cost bigint, last_move_id uuid)
     where c.id = x.id and c.tenant_id = $2`,
    [JSON.stringify(moved), tenant],
  );
}

async function loadPeople({ tx, tenant, a, today, shift }: Ctx): Promise<void> {
  await ins(tx, "partner_roles", manualRoleRows(tenant, a), "on conflict do nothing");
  await ins(tx, "partner_events", jobRows(tenant, a, shift));
  await ins(tx, "score_ratings", ratingRows(tenant, a, shift));
  await ins(tx, "partner_notes", noteRows(tenant, a, shift));
  const { locks, runs } = lockRows(tenant, today);
  await ins(tx, "score_locks", locks);
  await ins(tx, "score_lock_runs", runs);
}

/** Tên pháp nhân của mình (Cài đặt công ty) — để HĐ tự nhận Mua/Bán. Luôn ghi đè tên giả của demo (không bao giờ tên thật của khách). */
async function loadCompany(tx: Tx, tenant: string): Promise<void> {
  await tx`insert into contracts.company_settings (tenant_id, company_name, app_name, own_names, own_tax_ids)
    values (${tenant}, ${OWN.name}, 'Sổ Hợp Tác', ${[OWN.name]}::text[], ${[OWN.tax]}::text[])
    on conflict (tenant_id) do update set company_name = excluded.company_name, own_names = excluded.own_names, own_tax_ids = excluded.own_tax_ids`;
}

const RENEWED = [
  ["c7a", "c7"],
  ["c9a", "c9"],
] as const;
/** Gia hạn: HĐ năm trước ⇒ dòng "khách đang dùng" của HĐ gia hạn có renewals = 1 (trigger đồng bộ chạy theo thứ tự HĐ bất kỳ). */
async function fixRenewals(tx: Tx, tenant: string): Promise<void> {
  await tx.unsafe("set constraints all immediate");
  for (const [prev, next] of RENEWED)
    await tx`update contracts.service_customers s set renewals = greatest(s.renewals, 1),
        prev_contract_id = coalesce(s.prev_contract_id, ${uid("contract", prev)})
      where s.tenant_id = ${tenant} and s.contract_id = ${uid("contract", next)}`;
}

/** Tệp gốc mẫu của HĐ c1 (đã nằm trong FileBox của org `t_<tenant>`); vắng ⇒ demo không có HĐ nào có tệp gốc. */
export type DemoFile = {
  fileId: string;
  versionId: string | null;
  name: string;
  mime: string;
  size: number;
};
export const DEMO_FILE_NAME = "hop-dong-mau-NCCA.pdf";
const FILE_CONTRACT = "c1";

/** PDF một trang tối thiểu (chữ "DEMO", không phải hợp đồng thật) — đủ để khung xem PDF hiện được. */
export function demoPdf(): Uint8Array {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 63 >>\nstream\nBT /F1 18 Tf 20 70 Td (DEMO - Hop dong mau, du lieu gia) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const off: number[] = [];
  objs.forEach((o, i) => {
    off.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** Đẩy PDF mẫu lên FileBox (chỉ khi có `SEED_FILEBOX_URL` + `SEED_FILEBOX_TOKEN`; org = `t_<tenant>`). Không có ⇒ bỏ qua (seed vẫn chạy). */
export async function uploadDemoFile(tenantId: string): Promise<DemoFile | undefined> {
  const base = process.env.SEED_FILEBOX_URL;
  const token = process.env.SEED_FILEBOX_TOKEN;
  if (!base || !token) {
    console.log(
      "seed-demo-v2: bỏ qua tệp gốc mẫu (đặt SEED_FILEBOX_URL + SEED_FILEBOX_TOKEN để nạp PDF mẫu cho HĐ c1)",
    );
    return undefined;
  }
  const bytes = demoPdf();
  const res = await fetch(
    `${base.replace(/\/$/, "")}/files?org=${encodeURIComponent(`t_${tenantId}`)}&name=${encodeURIComponent(DEMO_FILE_NAME)}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/pdf" },
      body: bytes,
    },
  );
  if (!res.ok) throw new Error(`seed-demo-v2: FileBox từ chối tệp mẫu (${res.status})`);
  const j = (await res.json()) as { file_id?: string; version_id?: string };
  if (!j.file_id) throw new Error("seed-demo-v2: FileBox không trả file_id");
  return {
    fileId: j.file_id,
    versionId: j.version_id ?? null,
    name: DEMO_FILE_NAME,
    mime: "application/pdf",
    size: bytes.length,
  };
}

/** Gắn tệp gốc mẫu vào HĐ c1 (bản ghi `contracts.files` + `contracts.file_id`). */
async function attachFile(tx: Tx, tenant: string, owner: string, f: DemoFile): Promise<void> {
  await tx`delete from contracts.files where tenant_id = ${tenant} and name = ${f.name}`;
  const [row] = await tx<
    { id: string }[]
  >`insert into contracts.files (tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
    values (${tenant}, ${`t_${tenant}`}, ${f.fileId}, ${f.versionId}, ${f.name}, ${f.mime}, ${f.size}, ${owner}) returning id`;
  await tx`update contracts.contracts set file_id = ${row?.id ?? null} where tenant_id = ${tenant} and id = ${uid("contract", FILE_CONTRACT)}`;
}

export type SeedIds = { tenantId: string; tenantKey: string; owner: string; editor: string };

/** Nạp lại bộ mẫu cho tenant `demo` trong MỘT tx. Từ chối khoá khác `demo` (kiểm cả trong DB). */
export async function seedDemo(
  sql: postgres.Sql,
  ids: SeedIds,
  today: string,
  file?: DemoFile,
): Promise<Record<string, number>> {
  assertDemo(ids.tenantKey);
  const a: Actors = { owner: ids.owner, editor: ids.editor };
  const stock = stockPlan(a, ids.tenantId, today);
  return sql.begin(async (tx) => {
    const [t] = await tx<
      { key: string }[]
    >`select key from admin.tenants where id = ${ids.tenantId}`;
    assertDemo(t?.key);
    await tx`select set_config('app.tenant_id', ${ids.tenantId}, true), set_config('app.user_id', ${a.owner}, true)`;
    await tx.unsafe("set local session_replication_role = replica");
    await wipe(tx, ids.tenantId);
    await tx.unsafe("set local session_replication_role = origin");
    const ctx: Ctx = { tx, tenant: ids.tenantId, a, today, shift: shiftOf(today), stock };
    await loadCompany(tx, ids.tenantId);
    await loadCatalog(ctx);
    await loadContracts(ctx);
    await loadPeople(ctx);
    if (file) await attachFile(tx, ids.tenantId, a.owner, file);
    await fixRenewals(tx, ids.tenantId);
    return counts(tx, ids.tenantId);
  });
}

async function counts(tx: Tx, t: string): Promise<Record<string, number>> {
  const [r] = await tx<Record<string, number>[]>`select
    (select count(*)::int from contracts.contracts where tenant_id = ${t}) as contracts,
    (select count(*)::int from contracts.obligations where tenant_id = ${t}) as milestones,
    (select count(*)::int from contracts.partner_roles where tenant_id = ${t}) as partner_roles,
    (select count(*)::int from contracts.products where tenant_id = ${t}) as products,
    (select count(*)::int from contracts.product_supplier_prices where tenant_id = ${t}) as supplier_prices,
    (select count(*)::int from contracts.service_customers where tenant_id = ${t}) as service_customers,
    (select count(*)::int from contracts.stock_moves where tenant_id = ${t}) as stock_moves`;
  return r as Record<string, number>;
}

async function resolve(sql: postgres.Sql): Promise<SeedIds> {
  const [t] = await sql<
    { id: string; key: string }[]
  >`select id, key from admin.tenants where key = ${DEMO_KEY}`;
  if (!t) throw new Error(`seed-demo-v2: không có tenant "${DEMO_KEY}"`);
  const us = await sql<
    { id: string; email: string }[]
  >`select id, email from admin.users where tenant_id = ${t.id} and email = any(${Object.values(DEMO_EMAILS)}::text[])`;
  const id = (e: string) => us.find((u) => u.email === e)?.id;
  const owner = id(DEMO_EMAILS.owner);
  if (!owner)
    throw new Error(`seed-demo-v2: thiếu người dùng ${DEMO_EMAILS.owner} trong tenant demo`);
  return { tenantId: t.id, tenantKey: t.key, owner, editor: id(DEMO_EMAILS.editor) ?? owner };
}

async function main(argv: readonly string[]): Promise<void> {
  const flag = argv.indexOf("--tenant");
  assertDemo(flag >= 0 ? argv[flag + 1] : undefined);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("seed-demo-v2: cần DATABASE_URL (chủ migration)");
  const sql = postgres(url, { max: 1 });
  try {
    const [r] = await sql<
      { su: boolean }[]
    >`select rolsuper as su from pg_roles where rolname = current_user`;
    if (!r?.su) throw new Error("seed-demo-v2: cần vai siêu người dùng (chủ migration)");
    const ids = await resolve(sql);
    if (!argv.includes("--apply")) {
      console.log(
        `seed-demo-v2: chạy thử — sẽ xoá + nạp lại gói contracts của tenant "${ids.tenantKey}" (${ids.tenantId}); thêm --apply để ghi`,
      );
      return;
    }
    console.log(
      "seed-demo-v2: đã nạp",
      await seedDemo(
        sql,
        ids,
        new Date().toISOString().slice(0, 10),
        await uploadDemoFile(ids.tenantId),
      ),
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
