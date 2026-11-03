// pm-ready · hợp đồng mẫu cho CR-113 (tenant `evolu`), tạo bằng ĐƯỜNG THẬT của hub: hàng HĐ + lượt duyệt "kẹt chưa có run" (SQL, như
// `markStalled` ghi) → owner gói bấm "Mở lại quy trình" (POST …/approval/reopen ⇒ engine mở run theo quy trình gán cho tenant) →
// "duyệt thay" bằng POST …/approval của chủ gói. LẶP LẠI ĐƯỢC (id cố định, bước đã làm thì bỏ qua). Cần hub-api + admin-api đang chạy.
//   bun --env-file=.env.local tools/scripts/src/seed-cr113-samples.ts [--tenant evolu] [--owner julian.bui] [--creator thomas.tran]
// Từ chối APP_ENV=production hoặc DB ngoài localhost. Mật khẩu = mật khẩu dev cố định của fixture (`DEMO_PASSWORD`), không phải secret.
// Ba HĐ: (1) chờ ở bước 1 (chủ gói duyệt thay được); (2) bước 1 do Toàn quyền duyệt thay (thẻ "Duyệt thay · Toàn quyền"), đang ở bước 2;
// (3) bước 1 quá hạn (escalate_at lùi về quá khứ) — vòng nhắc của hub (300 s) chuyển cấp về Toàn quyền, thẻ "Quá hạn" + "Đã chuyển cho …".
import { parseArgs } from "node:util";
import postgres, { type Sql } from "postgres";
import { DEMO_PASSWORD } from "../../hub-dev/src/fixture";
import { isLocalDbHost } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";

// biome-ignore lint/suspicious/noExplicitAny: JSON của hub, đọc theo đường dẫn
type Json = Record<string, any>;
export type Call = (
  method: string,
  path: string,
  body?: Json,
) => Promise<{ status: number; json: Json }>;

export const SAMPLES = [
  {
    n: 1,
    key: "pending",
    title: "[CR-113] HĐ chờ duyệt bước 1 (chủ gói duyệt thay được)",
    value: 180_000_000,
  },
  {
    n: 2,
    key: "override",
    title: "[CR-113] HĐ do Toàn quyền duyệt thay bước 1",
    value: 240_000_000,
  },
  {
    n: 3,
    key: "overdue",
    title: "[CR-113] HĐ quá hạn bước 1, chuyển cấp về Toàn quyền",
    value: 320_000_000,
  },
] as const;
export type SampleKey = (typeof SAMPLES)[number]["key"];
const cid = (n: number) => `c1130000-0000-4000-8000-00000000000${n}`;
const aid = (n: number) => `a1130000-0000-4000-8000-00000000000${n}`;
const BASE = "/pack/contracts/contracts";

export type SamplesDeps = {
  sql: Sql;
  tenantId: string;
  creatorId: string;
  /** Gọi hub với tư cách chủ gói (Toàn quyền, ngoài Group của bước 1). */
  ownerCall: Call;
  /** Sau khi đặt hạn bước về quá khứ: test gọi `remindOnce`; script thật để vòng nhắc 300 s của hub làm. */
  afterOverdue?: () => Promise<unknown>;
  waitMs?: number;
};
export type SamplesResult = Record<SampleKey, { id: string; run: string | null }>;

async function until<V>(
  fn: () => Promise<V>,
  ok: (v: V) => boolean,
  ms: number,
  what: string,
): Promise<V> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`seed-cr113: hết ${ms} ms chờ ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function insertRows(d: SamplesDeps, s: (typeof SAMPLES)[number]): Promise<void> {
  const { sql } = d;
  await sql`insert into contracts.contracts
      (id, tenant_id, kind, title, direction, status, owner_user_id, created_by, version, fields)
    values (${cid(s.n)}, ${d.tenantId}, 'contract', ${s.title}, 'purchase', 'needs_review', ${d.creatorId}, ${d.creatorId}, 1,
      ${sql.json({ total_value: s.value } as never)})
    on conflict (id) do nothing`;
  await sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, feedback)
    values (${aid(s.n)}, ${d.tenantId}, ${cid(s.n)}, 'level1', ${d.creatorId}, 'engine', 'FLOW_MISSING')
    on conflict (id) do nothing`;
  await sql`update contracts.contracts set run_id = ${aid(s.n)} where id = ${cid(s.n)} and run_id is null`;
}

const runOf = async (sql: Sql, n: number): Promise<string | null> => {
  const [a] = await sql<
    { r: string | null }[]
  >`select engine_run_id::text as r from contracts.approvals where id = ${aid(n)}`;
  return a?.r ?? null;
};

async function card(d: SamplesDeps, n: number): Promise<Json> {
  return (await d.ownerCall("GET", `${BASE}/${cid(n)}/approval`)).json;
}
const stepOpen = (d: SamplesDeps, n: number, i: number) =>
  until(
    () => card(d, n),
    (c) => c.steps?.[i]?.status === "open",
    d.waitMs ?? 20_000,
    `bước ${i + 1} của HĐ ${n} mở`,
  );

/** Mở run engine (nếu chưa) rồi chờ bước 1 hiện. */
async function open(d: SamplesDeps, n: number): Promise<string> {
  if (!(await runOf(d.sql, n))) {
    const r = await d.ownerCall("POST", `${BASE}/${cid(n)}/approval/reopen`);
    if (r.status !== 200)
      throw new Error(
        `seed-cr113: mở lại quy trình HĐ ${n} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`,
      );
  }
  // bước 1 đã mở (hoặc đã quyết ở lần chạy trước) ⇒ run sẵn sàng
  await until(
    () => card(d, n),
    (c) => (c.steps ?? []).some((x: Json) => x.status !== "pending"),
    d.waitMs ?? 20_000,
    `run HĐ ${n} sẵn sàng`,
  );
  return (await runOf(d.sql, n)) as string;
}

async function overrideStep1(d: SamplesDeps, n: number): Promise<void> {
  const [done] = await d.sql`select 1 as x from contracts.contract_events
    where contract_id = ${cid(n)} and type = 'approval_override' limit 1`;
  if (done) return;
  const r = await d.ownerCall("POST", `${BASE}/${cid(n)}/approval`, { action: "approve" });
  if (r.status !== 200)
    throw new Error(
      `seed-cr113: duyệt thay HĐ ${n} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`,
    );
  await stepOpen(d, n, 1);
}

async function makeOverdue(d: SamplesDeps, run: string): Promise<void> {
  await d.sql`update hub.review_tasks set escalate_at = now() - interval '2 hours'
    where process_run_id = ${run} and status = 'open' and escalated_at is null and escalate_at > now()`;
  await d.afterOverdue?.();
}

export async function seedCr113Samples(d: SamplesDeps): Promise<SamplesResult> {
  const out = {} as SamplesResult;
  for (const s of SAMPLES) {
    await insertRows(d, s);
    const run = await open(d, s.n);
    if (s.key === "override") await overrideStep1(d, s.n);
    if (s.key === "overdue") await makeOverdue(d, run);
    out[s.key] = { id: cid(s.n), run };
  }
  return out;
}

// ── CLI ──
async function login(base: string, tenant: string, username: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_key: tenant, username, password: DEMO_PASSWORD }),
  });
  const j = (await res.json()) as Json;
  if (j.status !== "authenticated")
    throw new Error(`đăng nhập ${tenant}/${username}: ${res.status} ${String(j.status ?? "")}`);
  return String(j.access_token);
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: { tenant: { type: "string" }, owner: { type: "string" }, creator: { type: "string" } },
  });
  const tenant = v.tenant ?? "evolu";
  const url = process.env.DATABASE_URL ?? "";
  const bad = flowSeedGuard({
    appEnv: process.env.APP_ENV,
    urls: [url],
    iKnowProd: false,
    isLocal: isLocalDbHost,
  });
  if (bad) throw new Error(`seed-cr113-samples: ${bad}`);
  const authUrl = process.env.AUTH_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || "http://localhost:4000";
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [t] = await sql<{ id: string }[]>`select id from admin.tenants where key = ${tenant}`;
    const [u] = await sql<
      { id: string }[]
    >`select u.id from admin.users u where u.tenant_id = ${t?.id ?? null} and u.username = ${v.creator ?? "thomas.tran"}`;
    if (!t || !u) throw new Error(`seed-cr113-samples: thiếu tenant ${tenant} hoặc user tạo HĐ`);
    const token = await login(authUrl, tenant, v.owner ?? "julian.bui");
    const ownerCall: Call = async (method, path, body) => {
      const res = await fetch(`${hubUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
    };
    const r = await seedCr113Samples({ sql, tenantId: t.id, creatorId: u.id, ownerCall });
    console.log(`seed-cr113-samples OK ${JSON.stringify(r)}`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`seed-cr113-samples lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
}
