// CR-161 · Kết nối sẵn hai công ty (vd Evolu ↔ NitiGroup) ngay sau khi dựng — không phải mời/đồng ý tay.
// Đi ĐÚNG đường hàm CR-161 (hub 0145), không INSERT thẳng `hub.partner_links` (G1):
//   A: `hub.cc_invite(B, …, người Toàn quyền của A)` → B: `hub.partner_link_accept(A)` (người Toàn quyền của B trong `app.user_id`).
// Điều kiện: cả hai công ty đang hoạt động, đã bật Danh bạ (`directory_listed`), mỗi công ty có người Toàn quyền (nhóm contracts-admin).
// Lặp lại an toàn: đã kết nối ⇒ `already`, không ghi gì. Chuông «muốn kết nối / đã đồng ý» phát như thường (đường chung, không nhánh riêng).
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/tenant-connect.ts --a evolu --b nitigroup [--dry-run] [--i-know-prod]
// Cần DATABASE_URL của chủ migration. DB ngoài localhost/test hoặc APP_ENV=production ⇒ ghi thật phải có `--i-know-prod`.
import postgres from "postgres";
import { isLocalDbHost } from "./seed-community-demo.guard";

type Sql = postgres.Sql;
export type ConnectResult = "connected" | "already" | "would-connect";
export type Side = { id: string; key: string; owner: { id: string; name: string } };

/** Thuần: ghi thật vào DB không phải máy dev/test (hoặc APP_ENV=production) thì bắt buộc `--i-know-prod`. */
export function needsProdFlag(dbUrl: string, env: Record<string, string | undefined>): boolean {
  return env.APP_ENV === "production" || !isLocalDbHost(dbUrl);
}

/** Tra công ty + người Toàn quyền (nhỏ nhất theo id, ổn định giữa các lần chạy) cho cả hai khoá bằng đúng 2 câu SQL. */
async function resolve(sql: Sql, keys: [string, string]): Promise<[Side, Side]> {
  const ts = await sql<{ id: string; key: string; active: boolean; listed: boolean }[]>`
    select id, key, active, directory_listed as listed from admin.tenants where key = any(${keys})`;
  const out: Side[] = [];
  for (const key of keys) {
    const t = ts.find((x) => x.key === key);
    if (!t) throw new Error(`tenant-connect: không có công ty «${key}» (chạy onboard-all trước)`);
    if (!t.active) throw new Error(`tenant-connect: công ty «${key}» đã ngưng hoạt động`);
    if (!t.listed)
      throw new Error(
        `tenant-connect: công ty «${key}» chưa bật Danh bạ (cần đủ tên pháp lý + mã số thuế)`,
      );
    out.push({ id: t.id, key, owner: { id: "", name: "" } });
  }
  const ids = out.map((s) => s.id);
  const owners = await sql<{ tenant_id: string; user_id: string; name: string }[]>`
    select distinct on (o.tenant_id) o.tenant_id, o.user_id, coalesce(u.display_name, u.username) as name
      from hub.cc_owners_raw(${ids}::uuid[]) o join admin.users u on u.id = o.user_id
     order by o.tenant_id, o.user_id`;
  for (const s of out) {
    const w = owners.find((x) => x.tenant_id === s.id);
    if (!w)
      throw new Error(
        `tenant-connect: công ty «${s.key}» chưa có người Toàn quyền (nhóm contracts-admin)`,
      );
    s.owner = { id: w.user_id, name: w.name };
  }
  return [out[0] as Side, out[1] as Side];
}

const asTenant = (tx: postgres.TransactionSql, s: Side) =>
  tx`select set_config('app.tenant_id', ${s.id}, true), set_config('app.user_id', ${s.owner.id}, true)`;

/** Kết nối A↔B. Không đụng công ty nào khác. `dryRun` chỉ kiểm điều kiện + trạng thái. */
export async function run(
  sql: Sql,
  aKey: string,
  bKey: string,
  dryRun = false,
): Promise<ConnectResult> {
  if (aKey === bKey) throw new Error("tenant-connect: hai công ty phải khác nhau");
  const [a, b] = await resolve(sql, [aKey, bKey]);
  const done = async () =>
    (await sql<{ c: boolean }[]>`select hub.cc_connected_raw(${a.id}::uuid, ${b.id}::uuid) as c`)[0]
      ?.c === true;
  if (await done()) return "already";
  if (dryRun) return "would-connect";
  await sql.begin(async (tx) => {
    await asTenant(tx, a);
    const [r] = await tx<{ s: string }[]>`
      select hub.cc_invite(${b.id}::uuid, null, ${a.owner.id}::uuid, ${a.owner.name}) as s`;
    if (r?.s === "connected") return; // B đã mời A trước ⇒ cc_invite tự đồng ý
    await asTenant(tx, b);
    await tx`select hub.partner_link_accept(${a.id}::uuid)`;
  });
  if (!(await done()))
    throw new Error(`tenant-connect: ${aKey} ↔ ${bKey} chưa kết nối sau khi chạy`);
  return "connected";
}

function arg(argv: readonly string[], name: string): string {
  const i = argv.indexOf(name);
  const v = argv[i + 1];
  if (i < 0 || !v || v.startsWith("--")) throw new Error(`tenant-connect: cần ${name} <key>`);
  return v;
}

async function main(argv: readonly string[]): Promise<void> {
  const [a, b] = [arg(argv, "--a"), arg(argv, "--b")];
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("tenant-connect: cần DATABASE_URL (chủ migration)");
  const dry = argv.includes("--dry-run");
  if (!dry && needsProdFlag(url, process.env) && !argv.includes("--i-know-prod"))
    throw new Error("tenant-connect: DB không phải máy dev/test — thêm --i-know-prod để ghi thật");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    console.log(`tenant-connect[${a} ↔ ${b}]: ${await run(sql, a, b, dry)}`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
