// pm-ready · hợp đồng mẫu cho CR-113 (tenant `evolu`), tạo bằng ĐƯỜNG THẬT của hub: hàng HĐ + (CR-127) HĐ DRAFT (SQL) → người tạo
// `POST …/submit` (engine mở run theo quy trình gán cho tenant) → "duyệt thay" bằng `POST /review-tasks/:id/decision` của chủ gói (Toàn quyền). LẶP LẠI ĐƯỢC (id cố định, bước đã làm thì bỏ qua). Cần hub-api + admin-api đang chạy.
//   bun --env-file=.env.local tools/scripts/src/seed-cr113-samples.ts [--tenant evolu] [--owner julian.bui] [--creator thomas.tran]
// Từ chối APP_ENV=production hoặc DB ngoài localhost. Mật khẩu = mật khẩu dev cố định của fixture (`DEMO_PASSWORD`), không phải secret.
// Công ty chưa có quy trình duyệt (CR-127 Z4: không còn mẫu) ⇒ chỉ HĐ nháp. Ba HĐ: (1) chờ ở bước 1 (chủ gói duyệt thay được); (2) bước 1 do Toàn quyền duyệt thay (thẻ "Duyệt thay · Toàn quyền"), đang ở bước 2;
// (3) bước 1 quá hạn (escalate_at lùi về quá khứ) — vòng nhắc của hub (300 s) chuyển cấp về Toàn quyền, thẻ "Quá hạn" + "Đã chuyển cho …".
import { parseArgs } from "node:util";
import postgres, { type Sql } from "postgres";
import {
  FLOW_TEMPLATE_APP,
  FLOW_TEMPLATE_EVENT,
  FLOW_TEMPLATES,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import { bindGroupKeys, groupKeysOf } from "../../../apps/hub-api/src/modules/processes/public";
import {
  PURCHASE_SIGNER_GROUP,
  withEsignSigner,
} from "../../../apps/hub-api/src/modules/seed/seed.cr125-config";
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
const BASE = "/pack/contracts/contracts";

export type SamplesDeps = {
  sql: Sql;
  tenantId: string;
  creatorId: string;
  /** Gọi hub với tư cách chủ gói (Toàn quyền, ngoài Group của bước 1). */
  ownerCall: Call;
  /** Gọi hub với tư cách người tạo HĐ (Gửi duyệt chỉ người tạo/phụ trách); vắng ⇒ dùng `ownerCall`. */
  creatorCall?: Call;
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
  // CR-127 · HĐ mẫu vào ở DRAFT (đọc xong, đủ điều kiện Gửi); trạng thái chỉ đổi qua `POST …/submit` của hub.
  await sql`insert into contracts.contracts
      (id, tenant_id, kind, title, direction, status, extract_state, owner_user_id, created_by, version, fields)
    values (${cid(s.n)}, ${d.tenantId}, 'contract', ${s.title}, 'purchase', 'draft', 'ready', ${d.creatorId}, ${d.creatorId}, 1,
      ${sql.json({ total_value: s.value } as never)})
    on conflict (id) do nothing`;
}

/** Run engine của HĐ (lượt gửi mới nhất) + việc đang mở của nó; chưa có ⇒ null. */
async function openTask(sql: Sql, n: number) {
  const [t] = await sql<{ run: string; task: string; idx: number }[]>`
    select r.id::text as run, t.id::text as task, s.stage_idx as idx
    from hub.process_runs r join hub.review_tasks t on t.process_run_id = r.id and t.status = 'open'
    join hub.stage_runs s on s.id = t.stage_run_id
    where r.pack_key = 'contracts' and r.pack_record_id = ${cid(n)}
    order by r.started_at desc, s.stage_idx limit 1`;
  return t ?? null;
}
/** Có lượt CÒN SỐNG (lượt đã huỷ/lỗi — vd hub 0135 gỡ quy trình kiểu cũ — không tính ⇒ gửi lại được). */
const SAMPLE_FLOW_KEY = "hd-duyet-2-cap";
const hasRun = async (sql: Sql, n: number) => {
  const [r] = await sql`select 1 as x from hub.process_runs
    where pack_key = 'contracts' and pack_record_id = ${cid(n)} and status not in ('cancelled', 'failed', 'expired') limit 1`;
  return !!r;
};

/** CR-127 · Z4: không còn mẫu Thư viện — công ty tự tạo quy trình. Công ty chưa có quy trình Bật cho `contract.submitted` ⇒ chỉ tạo HĐ nháp, không Gửi duyệt. */
const hasSubmitFlow = async (d: SamplesDeps): Promise<boolean> => {
  const [r] =
    await d.sql`select 1 as x from hub.company_flows cf join hub.process_defs f on f.id = cf.flow_id
    where cf.tenant_id = ${d.tenantId}::uuid and cf.enabled and f.deleted_at is null and f.trigger_event = 'contract.submitted' limit 1`;
  return !!r;
};

/**
 * CR-127 · D7 · công ty phải có quy trình duyệt «Gửi duyệt» chạy được thì mới có lượt (Z3c: không còn mẫu Thư viện, hub trả `NO_APPROVAL_FLOW`).
 * Chưa có ⇒ tạo cho công ty bản «Duyệt 2 cấp» (cùng bước với mẫu trong code) + dòng công ty Bật + cờ `flow_triggers` — đúng hình dữ liệu của
 * `POST /tenants/:tid/company-flows` rồi Áp dụng. Chỉ chạy ở máy dev/test (script từ chối DB ngoài localhost).
 */
async function ensureApprovalFlow(d: SamplesDeps): Promise<void> {
  const [have] =
    await d.sql`select 1 as x from hub.company_flows cf join hub.process_defs f on f.id = cf.flow_id
    where cf.tenant_id = ${d.tenantId}::uuid and cf.enabled and f.deleted_at is null and f.trigger_event = 'contract.submitted'
      and f.key = ${SAMPLE_FLOW_KEY} limit 1`;
  if (have) return;
  const tpl = FLOW_TEMPLATES[0];
  if (!tpl) throw new Error("seed-cr113: thiếu mẫu Duyệt 2 cấp");
  const trigger = { event: FLOW_TEMPLATE_EVENT };
  // Như «Áp dụng» của admin: mã nhóm → id nhóm của công ty, người ký = nhóm Giám đốc, rồi XUẤT BẢN (bản 1) — màn Cài đặt/`eventFlowOf` chỉ đọc bản xuất bản.
  const keys = groupKeysOf(tpl.stages());
  const groups = await d.sql<
    { id: string; key: string }[]
  >`select id::text as id, key from admin.groups
    where tenant_id = ${d.tenantId}::uuid and key = any(${[...keys, PURCHASE_SIGNER_GROUP]}::text[])`;
  const ids = new Map(groups.map((g) => [g.key, g.id]));
  const bound = bindGroupKeys(tpl.stages(), ids, { strip: true }).stages;
  const signer = ids.get(PURCHASE_SIGNER_GROUP);
  const stages = signer ? withEsignSigner(bound, signer) : bound;
  const [def] = await d.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, run_group_ids, stages, enabled, app,
      trigger, created_by, updated_by, published_version)
    values (${d.tenantId}::uuid, ${SAMPLE_FLOW_KEY}, ${tpl.name}, '{}'::uuid[], ${d.sql.json(stages as never)}, true, ${FLOW_TEMPLATE_APP},
      ${d.sql.json(trigger)}, ${d.creatorId}::uuid, ${d.creatorId}::uuid, 1)
    on conflict (tenant_id, key) where deleted_at is null and tenant_id is not null do update set updated_at = now() returning id::text as id`;
  await d.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body, note)
    select d.id, 1, d.name, d.stages, d.slot_body, 'seed CR-113 (dữ liệu mẫu)' from hub.process_defs d where d.id = ${def?.id as string}::uuid
    on conflict (def_id, rel_version) do nothing`;
  await d.sql`insert into hub.company_flows (tenant_id, flow_id, enabled, position, updated_by)
    values (${d.tenantId}::uuid, ${def?.id as string}::uuid, true, 0, ${d.creatorId}::uuid)
    on conflict (tenant_id, flow_id) do update set enabled = true, off_reason = null`;
  await d.sql`insert into hub.tenant_flow_settings (tenant_id, flow_triggers) values (${d.tenantId}::uuid, true)
    on conflict (tenant_id) do update set flow_triggers = true`;
}

/** HĐ còn `processing` mà KHÔNG có lượt sống (lượt cũ bị huỷ — vd hub 0135) ⇒ Rút về rồi Gửi lại (khoá sự kiện theo lần gửi — FIX-Z3,
 *  không cần xoá sự kiện cũ). Chỉ chạy ở máy dev (script từ chối DB ngoài localhost). */
async function unstick(d: SamplesDeps, n: number): Promise<void> {
  const [c] = await d.sql<
    { status: string }[]
  >`select status from contracts.contracts where id = ${cid(n)}`;
  if (c?.status !== "processing") return;
  const r = await (d.creatorCall ?? d.ownerCall)("POST", `${BASE}/${cid(n)}/withdraw`, {
    reason: "Gửi lại sau khi gỡ quy trình duyệt kiểu cũ (dữ liệu mẫu CR-113)",
  });
  if (r.status !== 200)
    throw new Error(
      `seed-cr113: rút HĐ ${n} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`,
    );
}

/** Gửi duyệt (người tạo) nếu chưa có lượt; rồi chờ việc của bước đầu mở. */
async function submit(d: SamplesDeps, n: number): Promise<boolean> {
  if (!(await hasRun(d.sql, n))) {
    await unstick(d, n);
    const [cur] = await d.sql<
      { status: string }[]
    >`select status from contracts.contracts where id = ${cid(n)}`;
    if (cur?.status !== "draft") return false; // đã đi thẳng «done» (không có quy trình khớp) ở lần chạy trước
    const r = await (d.creatorCall ?? d.ownerCall)("POST", `${BASE}/${cid(n)}/submit`, {
      unchanged_reason: "Gửi lại sau khi gỡ quy trình duyệt kiểu cũ (dữ liệu mẫu CR-113)",
    });
    if (r.status !== 200)
      throw new Error(
        `seed-cr113: gửi duyệt HĐ ${n} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`,
      );
    if (r.json.no_flow) {
      console.warn(
        `seed-cr113: HĐ ${n} không có quy trình khớp ⇒ Gửi duyệt đi thẳng «Đã duyệt» (không có lượt duyệt)`,
      );
      return false;
    }
  }
  await until(
    () => openTask(d.sql, n),
    (t) => t !== null,
    d.waitMs ?? 20_000,
    `việc duyệt của HĐ ${n} mở`,
  );
  return true;
}

/**
 * Một tệp mẫu (hàng `hub.attachments`) của CHÍNH người ghi bằng chứng `userId` — `hub.record_evidence` (hub 0140, SEC 2026-11-12) chỉ nhận
 * tệp do người ghi tải lên; không đọc nội dung.
 */
async function sampleFile(d: SamplesDeps, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  await d.sql`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
    values (${id}::uuid, ${d.tenantId}::uuid, ${userId}::uuid, 'upload', 'bien-ban-mau.pdf', 'bien-ban-mau.pdf', 'application/pdf', 1,
      ${"0".repeat(64)}, ${`${d.tenantId}/${id}`})`;
  return id;
}

/**
 * Toàn quyền duyệt thay bước 1 như người dùng thật: CR-127 «Nhận việc trước Duyệt» ⇒ owner Nhận việc (Toàn quyền nhận được — FIX-OV),
 * rồi Duyệt qua route thẻ HĐ (ghi "duyệt thay" `approval_override` ⇒ huy hiệu); đã sang bước sau thì bỏ qua.
 */
async function overrideStep1(d: SamplesDeps, n: number): Promise<void> {
  const t = await openTask(d.sql, n);
  if (!t || t.idx > 0) return;
  const c = await d.ownerCall("POST", `/review-tasks/${t.task}/claim`, {});
  if (c.status !== 200)
    throw new Error(
      `seed-cr113: nhận việc HĐ ${n} → ${c.status} ${JSON.stringify(c.json).slice(0, 160)}`,
    );
  const decide = (evidence?: unknown) =>
    d.ownerCall("POST", `${BASE}/${cid(n)}/approval`, {
      action: "approve",
      feedback: "Duyệt thay (dữ liệu mẫu CR-113)",
      ...(evidence ? { evidence } : {}),
    });
  let r = await decide();
  // Bước Duyệt đòi Bằng chứng (ý kiến + tệp/chữ ký, E4): seed gửi đủ — ý kiến + một tệp mẫu của chính người duyệt thay.
  if (r.status === 422 && r.json.error?.code === "EVIDENCE_REQUIRED")
    r = await decide({
      note: "Duyệt thay (dữ liệu mẫu CR-113)",
      // người duyệt thay = người vừa Nhận việc (`claim.by.id`) ⇒ tệp phải của người đó
      attachment_ids: [await sampleFile(d, c.json.claim?.by?.id ?? d.creatorId)],
    });
  if (r.status !== 200)
    throw new Error(
      `seed-cr113: duyệt thay HĐ ${n} → ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`,
    );
  await until(
    () => openTask(d.sql, n),
    (x) => x !== null && x.idx > 0,
    d.waitMs ?? 20_000,
    `bước 2 của HĐ ${n} mở`,
  );
}

async function makeOverdue(d: SamplesDeps, run: string): Promise<void> {
  await d.sql`update hub.review_tasks set escalate_at = now() - interval '2 hours'
    where process_run_id = ${run} and status = 'open' and escalated_at is null and escalate_at > now()`;
  await d.afterOverdue?.();
}

/**
 * CR-127 · Gửi duyệt chỉ người tạo/phụ trách HĐ (`submit.usecase`) ⇒ `ownerCall` (quản trị công ty) bị 403 trên HĐ do `creatorId` tạo.
 * Caller không đưa `creatorCall` (stack e2e) ⇒ tự đăng nhập người tạo (mật khẩu dev cố định): đăng nhập ở `AUTH_URL` (vắng: cổng
 * `PM_API_PORT` của stack e2e, rồi localhost:3001), hub ở `HUB_URL` (vắng: `HUB_PORT`, rồi localhost:4000).
 */
async function withCreatorCall(d: SamplesDeps): Promise<SamplesDeps> {
  if (d.creatorCall) return d;
  const [u] = await d.sql<{ username: string; key: string }[]>`select u.username, t.key
    from admin.users u join admin.tenants t on t.id = u.tenant_id where u.id = ${d.creatorId} and u.tenant_id = ${d.tenantId}`;
  if (!u) return d;
  const env = process.env;
  const authUrl =
    env.AUTH_URL ||
    (env.PM_API_PORT ? `http://localhost:${env.PM_API_PORT}` : "http://localhost:3001");
  const hubUrl = env.HUB_URL || `http://localhost:${env.HUB_PORT || "4000"}`;
  const token = await login(authUrl, u.key, u.username);
  const creatorCall: Call = async (method, path, body) => {
    const res = await fetch(`${hubUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };
  return { ...d, creatorCall };
}

export async function seedCr113Samples(d0: SamplesDeps): Promise<SamplesResult> {
  const d = await withCreatorCall(d0);
  await ensureApprovalFlow(d);
  const out = {} as SamplesResult;
  const flowed = await hasSubmitFlow(d);
  if (!flowed)
    console.warn(
      "seed-cr113: công ty chưa có quy trình Bật cho «Gửi duyệt» — chỉ tạo HĐ nháp (soạn quy trình ở Quy trình rồi chạy lại để có lượt duyệt)",
    );
  for (const s of SAMPLES) {
    await insertRows(d, s);
    if (!flowed) {
      out[s.key] = { id: cid(s.n), run: null };
      continue;
    }
    if (!(await submit(d, s.n))) {
      out[s.key] = { id: cid(s.n), run: null };
      continue;
    }
    const run = (await openTask(d.sql, s.n))?.run ?? "";
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
    const callWith =
      (token: string): Call =>
      async (method, path, body) => {
        const res = await fetch(`${hubUrl}${path}`, {
          method,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
      };
    const creatorToken = await login(authUrl, tenant, v.creator ?? "thomas.tran");
    const r = await seedCr113Samples({
      sql,
      tenantId: t.id,
      creatorId: u.id,
      ownerCall: callWith(token),
      creatorCall: callWith(creatorToken),
    });
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
