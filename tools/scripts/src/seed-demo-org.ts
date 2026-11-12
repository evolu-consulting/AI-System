// CR-139c · dựng lại tenant `demo` thành công ty mẫu có cấu trúc doanh nghiệp thật (dữ liệu dev/demo; chưa có khách thật ⇒ được dọn/tạo lại).
//   bun run demo:org        (= bun --env-file=.env.local tools/scripts/src/seed-demo-org.ts)
// Các bước (đều đi ĐƯỜNG THẬT của sản phẩm, lặp lại được):
//   1 người dùng (admin-api, mật khẩu dev chung = DEMO_OWNER_PW) · 2 phòng ban + trưởng phòng (use case tenant-onboard từ deploy/tenants/demo.yaml)
//   3 nhóm gói (Toàn quyền/Nhân viên/Chỉ xem) + nhóm vai (Người ký HĐ…) · 4 quy trình duyệt (seed-cr128-flows) ·
//   5 dọn: bản quy trình/HĐ trỏ nhóm trùng phòng ban, gỡ các nhóm đó · 6 HĐ mẫu do người ở các phòng khác nhau GỬI (hub) + kiểm ai nhận việc.
// Từ chối APP_ENV=production / DB ngoài localhost. Cần admin-api (AUTH_URL :3001) + hub-api (HUB_URL :4000) đang chạy; mật khẩu lấy từ .env.local.
import { createDb, hashPassword } from "@ai/db";
import postgres, { type Sql } from "postgres";
import { parseSpec } from "../../../apps/admin-api/src/modules/tenant-onboard/adapters/onboard.schema";
import type { OnboardSpec } from "../../../apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules";
import { onboardTenant } from "../../../apps/admin-api/src/modules/tenant-onboard/tenant-onboard.run";
import { SKIP_TEMPLATE_GROUPS } from "../../../apps/hub-api/src/modules/seed/seed.cr125-members";
import { type Api, adminToken, call, type Json } from "../../hub-dev/src/fixture";
import { isLocalDbHost } from "./seed-community-demo.guard";
import {
  DEMO_PEOPLE,
  DEMO_TENANT_KEY,
  diffMembers,
  emailOf,
  planGroups,
  ROLE_GROUPS,
  SAMPLES,
  type Sample,
  sampleId,
} from "./seed-demo-org.data";
import { flowSeedGuard } from "./seed-flow-showcase.build";

const TAG = "demo:org";
const BASE = "/pack/contracts/contracts";
const DROPPED: readonly string[] = SKIP_TEMPLATE_GROUPS[DEMO_TENANT_KEY] ?? [];
/** Quy trình do `seed-cr128-flows` dựng lại (không xoá). */
const KEEP_FLOWS = ["duyet-hop-dong", "de-nghi-mua-hang", "flow-showcase"];

const fail = (m: string): never => {
  throw new Error(m);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k} trong .env.local`);
const rows = <T>(r: unknown): T[] => r as T[];

type Ctx = {
  api: Api;
  hub: Api;
  tid: string;
  sql: Sql;
  pw: string;
  authUrl: string;
  hubUrl: string;
};

// ── 1. người dùng ──
/** Tạo user thiếu qua admin-api; mật khẩu dev chung đặt bằng MỘT câu SQL (chỉ máy dev — script đã chặn production) để không tốn lượt đăng nhập (trần IP 30/10 phút). */
async function ensurePeople(c: Ctx): Promise<void> {
  for (const p of DEMO_PEOPLE) {
    const list = await call(
      c.api,
      "GET",
      `/admin/users?tenant_id=${c.tid}&q=${p.username}&limit=50`,
    );
    const u = (list.items as Json[]).find((x) => x.username === p.username);
    if (!u)
      await call(c.api, "POST", `/admin/users?tenant_id=${c.tid}`, {
        username: p.username,
        display_name: p.name,
        role: "member",
        locale: "vi",
        email: emailOf(p.username),
      });
    else if (u.display_name !== p.name)
      await call(c.api, "PATCH", `/admin/users/${String(u.id)}`, {
        version: u.version,
        display_name: p.name,
      });
  }
  const others = DEMO_PEOPLE.filter((p) => p.username !== "demo-owner").map((p) => p.username);
  const hash = await hashPassword(c.pw);
  await c.sql`update admin.users set password_hash = ${hash}, must_change_password = false, locale = 'vi', updated_at = now()
    where tenant_id = ${c.tid}::uuid and username = any(${others}::text[])`;
}

// ── 2. phòng ban + trưởng phòng ──
async function loadSpec(): Promise<OnboardSpec> {
  const p = parseSpec(await Bun.file("deploy/tenants/demo.yaml").text());
  return p.ok ? p.spec : fail(`demo.yaml không hợp lệ: ${JSON.stringify(p.issues)}`);
}

async function onboard(c: Ctx, spec: OnboardSpec): Promise<void> {
  const [a] = rows<{ id: string }>(
    await c.sql`select id from admin.users where role = 'platform_admin' and username = ${env("SEED_ADMIN_USERNAME")}`,
  );
  const db = createDb(env("ADMIN_API_DATABASE_URL"), { max: 2 });
  try {
    const r = await onboardTenant(db, spec, a?.id ?? fail("không thấy platform admin"));
    if (r.members.pending_emails.length)
      fail(`email chưa có user: ${r.members.pending_emails.join(", ")}`);
    console.log(
      `${TAG}: phòng ban ${r.departments.total} (đổi ${r.departments.changed}), trưởng phòng đặt ${r.members.heads_set}, thành viên thêm ${r.members.added}`,
    );
  } finally {
    await db.close();
  }
}

// ── 3. nhóm gói + nhóm vai: thành viên đúng sơ đồ (người đứng sai phòng/nhóm bị bớt) ──
async function reconcileGroups(c: Ctx, spec: OnboardSpec): Promise<void> {
  const depts = new Set([spec.root.key, ...spec.departments.map((d) => d.key)]);
  const groups = async () =>
    new Map(
      (
        (await call(c.api, "GET", `/admin/groups?tenant_id=${c.tid}&limit=200`)).items as Json[]
      ).map((g) => [String(g.key), String(g.id)]),
    );
  let ids = await groups();
  for (const r of ROLE_GROUPS)
    if (!ids.has(r.key)) {
      await call(c.api, "POST", `/admin/groups?tenant_id=${c.tid}`, {
        key: r.key,
        name: { vi: r.vi },
      });
      ids = await groups();
    }
  const managed = new Set(DEMO_PEOPLE.map((p) => p.username));
  let added = 0;
  let removed = 0;
  // người quản lý phải rời mọi nhóm gói/phòng ban không thuộc sơ đồ: duyệt cả phòng ban lẫn nhóm gói
  for (const g of planGroups(spec)) {
    const gid =
      ids.get(g.key) ?? fail(`thiếu nhóm ${g.key}${depts.has(g.key) ? " (chạy onboard)" : ""}`);
    const mem = await call(c.api, "GET", `/admin/groups/${gid}/members?limit=200`);
    const cur = new Set((mem.items as Json[]).map((m) => String(m.username)));
    const d = diffMembers(cur, g.want, managed);
    if (d.add.length) {
      const res = await call(c.api, "POST", `/admin/groups/${gid}/members`, { usernames: d.add });
      added += (res.added as unknown[] | undefined)?.length ?? 0;
    }
    for (const u of d.remove) {
      const m = (mem.items as Json[]).find((x) => x.username === u);
      await call(c.api, "DELETE", `/admin/groups/${gid}/members/${String(m?.user_id)}`);
      removed++;
    }
  }
  console.log(`${TAG}: nhóm — thêm ${added} thành viên, bớt ${removed}`);
}

// ── 4. quy trình duyệt (starter_head) ──
async function flows(): Promise<void> {
  const p = Bun.spawn(["bun", "tools/scripts/src/seed-cr128-flows.ts", "--skip-check"], {
    env: process.env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await p.exited) !== 0) fail("seed-cr128-flows lỗi (xem log phía trên)");
}

// ── 5. dọn: HĐ đang duyệt / bản quy trình trỏ nhóm trùng phòng ban, rồi gỡ nhóm ──
const tokens = new Map<string, Api>();
async function login(c: Ctx, username: string): Promise<Api> {
  const hit = tokens.get(username);
  if (hit) return hit;
  const r = await call({ base: c.authUrl }, "POST", "/auth/login", {
    tenant_key: DEMO_TENANT_KEY,
    username,
    password: c.pw,
  });
  if (r.status !== "authenticated") fail(`đăng nhập ${username} → ${String(r.status)}`);
  const api = { base: c.hubUrl, token: String(r.access_token) };
  tokens.set(username, api);
  return api;
}

async function cleanup(c: Ctx): Promise<void> {
  const g = await call(c.api, "GET", `/admin/groups?tenant_id=${c.tid}&limit=200`);
  const dead = (g.items as Json[]).filter((x) => DROPPED.includes(String(x.key)));
  if (!dead.length) return;
  const ids = dead.map((x) => String(x.id));
  // HĐ đang duyệt theo quy trình cũ (nhiệm vụ giao nhóm sắp gỡ) ⇒ người tạo Rút về; bản quy trình công ty còn trỏ nhóm ⇒ xoá (dữ liệu demo tạo lại được).
  const stuck = rows<{ id: string; username: string }>(
    await c.sql`select distinct k.id::text as id, u.username from contracts.contracts k
      join hub.process_runs r on r.pack_key = 'contracts' and r.pack_record_id = k.id and r.tenant_id = k.tenant_id
      join admin.users u on u.id = k.owner_user_id
      where k.tenant_id = ${c.tid}::uuid and k.status = 'processing' and r.status not in ('cancelled','failed','expired','done')
        and exists (select 1 from unnest(${ids}::text[]) x where r.snapshot::text like '%' || x || '%')`,
  );
  for (const s of stuck) {
    const owner = await login(c, s.username);
    await call(owner, "POST", `${BASE}/${s.id}/withdraw`, {
      reason: "Dọn dữ liệu demo (CR-139c): quy trình cũ trỏ nhóm đã gỡ",
    });
  }
  const defs = rows<{ id: string; version: number; key: string }>(
    await c.sql`select id::text as id, version, key from hub.process_defs
      where tenant_id = ${c.tid}::uuid and deleted_at is null and key <> all(${KEEP_FLOWS}::text[])
        and exists (select 1 from unnest(${ids}::text[]) x where stages::text like '%' || x || '%')`,
  );
  for (const d of defs) {
    await call(c.hub, "DELETE", `/process-defs/${d.id}?tenant_id=${c.tid}&version=${d.version}`);
  }
  for (const x of dead) await call(c.api, "DELETE", `/admin/groups/${String(x.id)}`);
  console.log(
    `${TAG}: gỡ ${dead.length} nhóm trùng phòng ban (${dead.map((x) => x.key).join(", ")}); rút ${stuck.length} HĐ, xoá ${defs.length} bản quy trình cũ`,
  );
}

// ── 6. HĐ mẫu do người các phòng GỬI (đúng đường hub) ──
const hasRun = async (c: Ctx, id: string): Promise<boolean> =>
  (
    await c.sql`select 1 from hub.process_runs where pack_key = 'contracts' and pack_record_id = ${id}::uuid
      and status not in ('cancelled','failed','expired') limit 1`
  ).length > 0;

async function submitSample(c: Ctx, s: Sample): Promise<void> {
  const id = sampleId(s.n);
  const [u] = rows<{ id: string }>(
    await c.sql`select id from admin.users where tenant_id = ${c.tid}::uuid and username = ${s.by}`,
  );
  await c.sql`insert into contracts.contracts
      (id, tenant_id, kind, title, direction, status, extract_state, owner_user_id, created_by, version, fields)
    values (${id}, ${c.tid}, 'contract', ${s.title}, ${s.direction}, 'draft', 'ready', ${u?.id ?? null}, ${u?.id ?? null}, 1,
      ${c.sql.json({ total_value: s.value } as never)})
    on conflict (id) do nothing`;
  if (await hasRun(c, id)) return;
  const [cur] = rows<{ status: string }>(
    await c.sql`select status from contracts.contracts where id = ${id}`,
  );
  const sender = await login(c, s.by);
  if (cur?.status === "processing")
    await call(sender, "POST", `${BASE}/${id}/withdraw`, {
      reason: "Gửi lại (dữ liệu mẫu demo:org)",
    });
  const r = await call(sender, "POST", `${BASE}/${id}/submit`, {
    unchanged_reason: "HĐ mẫu demo:org",
  });
  if (r.no_flow) fail(`HĐ mẫu ${s.n}: không có quy trình khớp (no_flow)`);
}

/** Việc duyệt đang mở của HĐ mẫu + người được giao có THẤY việc đó ở `/me/review-tasks` (như họ thấy trên màn hình) không. */
async function taskState(c: Ctx, s: Sample): Promise<{ open: number; approverSees: boolean }> {
  const [run] = rows<{ id: string; open: number }>(
    await c.sql`select r.id::text as id, (select count(*)::int from hub.review_tasks t where t.process_run_id = r.id and t.status = 'open') as open
      from hub.process_runs r where r.pack_key = 'contracts' and r.pack_record_id = ${sampleId(s.n)}::uuid
        and r.status not in ('cancelled','failed','expired') order by r.started_at desc limit 1`,
  );
  if (!run || run.open === 0) return { open: 0, approverSees: false };
  const mine = await call(
    await login(c, s.firstApprover),
    "GET",
    "/me/review-tasks?status=open&limit=100",
  );
  const hit = (mine.items as Json[]).some(
    (i) => (i.process_run as Json | undefined)?.id === run.id,
  );
  return { open: run.open, approverSees: hit };
}

async function samples(c: Ctx): Promise<void> {
  for (const s of SAMPLES) await submitSample(c, s);
  // chờ bộ điều phối mở việc (tối đa 30 s, thoát ngay khi thấy) rồi kiểm ai nhận việc
  for (const s of SAMPLES) {
    let st = { open: 0, approverSees: false };
    for (const end = Date.now() + 30_000; Date.now() < end; ) {
      st = await taskState(c, s);
      if (st.open > 0) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const ok = st.open === 1 && st.approverSees;
    console.log(
      `${TAG}: HĐ ${s.n} (${s.by} gửi ${s.value / 1e6} triệu) ⇒ ${st.open} việc duyệt, ${s.firstApprover} ${st.approverSees ? "thấy" : "KHÔNG thấy"}`,
    );
    if (!ok) fail(`HĐ mẫu ${s.n}: việc duyệt không về ${s.firstApprover}`);
  }
}

async function main(): Promise<void> {
  const url = env("DATABASE_URL");
  const bad = flowSeedGuard({
    appEnv: process.env.APP_ENV,
    urls: [url],
    iKnowProd: false,
    isLocal: isLocalDbHost,
  });
  if (bad) fail(`từ chối — ${bad}`);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || `http://localhost:${process.env.HUB_PORT || "4000"}`;
  const token = await adminToken(authUrl);
  const api: Api = { base: authUrl, token };
  const list = await call(api, "GET", `/admin/tenants?q=${DEMO_TENANT_KEY}&limit=50`);
  const tid = String(
    (list.items as Json[]).find((t) => t.key === DEMO_TENANT_KEY)?.id ??
      fail(
        "không có công ty demo — chạy scripts/dev-up.ps1 -SeedDemo (hoặc seed-community-demo --dev-fixture) trước",
      ),
  );
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  const c: Ctx = {
    api,
    hub: { base: hubUrl, token },
    tid,
    sql,
    pw: env("DEMO_OWNER_PW"),
    authUrl,
    hubUrl,
  };
  try {
    await ensurePeople(c);
    const spec = await loadSpec();
    await onboard(c, spec);
    await reconcileGroups(c, spec);
    await flows();
    await cleanup(c);
    await samples(c);
    console.log(`${TAG} OK`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main().catch((e) => {
    console.error(`${TAG} lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
