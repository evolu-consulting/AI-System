// CR-152 · CR-150 · HĐ mẫu «Nhượng quyền» + «Thỏa thuận hợp tác» trên tenant demo của stg-test (UAT mốc kỳ, duyệt, Điểm uy tín). Chạy qua
// `deploy/stg-test/seed-demo.sh --kinds-only` (chạy SAU `--org-only` + `--partner-only`). Lặp lại được (nhận diện theo tiêu đề); CHỈ stg-test (guard).
// Đường đi: hàng nháp (như seed-demo-org «HĐ mẫu») → PUT kind-terms → tải PDF mẫu → Lưu (review) → Gửi duyệt (người tạo) → HĐ 1: quản trị công ty
// nhận việc + duyệt thay + tải bản đã ký tới DONE (hook sinh mốc kỳ); HĐ 2 dừng ở «đang duyệt».
import postgres, { type Sql } from "postgres";
import { type Api, adminToken, call, type Json } from "../../hub-dev/src/fixture";
import {
  KIND_SAMPLES,
  KIND_SAMPLES_TENANT,
  type KindSample,
  kindSamplesGuard,
  planSample,
  SAMPLE_PDF,
  type SampleState,
  type SampleStep,
  sampleFields,
  sampleId,
} from "./seed-kind-samples.data";

const TAG = "seed-kind-samples";
const BASE = "/pack/contracts/contracts";
const APPROVER = "demo-owner";
const fail = (m: string): never => {
  throw new Error(m);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k}`);
const rows = <T>(r: unknown): T[] => r as T[];

type Ctx = { sql: Sql; tid: string; authUrl: string; hubUrl: string; pw: string };
type Res = { status: number; json: Json };

const tokens = new Map<string, string>();
async function login(c: Ctx, username: string): Promise<string> {
  const hit = tokens.get(username);
  if (hit) return hit;
  const r = await call({ base: c.authUrl }, "POST", "/auth/login", {
    tenant_key: KIND_SAMPLES_TENANT,
    username,
    password: c.pw,
  });
  if (r.status !== "authenticated") fail(`đăng nhập ${username} → ${String(r.status)}`);
  const t = String(r.access_token);
  tokens.set(username, t);
  return t;
}

/** Gọi hub, trả cả mã lỗi (không ném) để bước «duyệt/ký» xử lý theo mã. */
async function hub(
  c: Ctx,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res> {
  const res = await fetch(`${c.hubUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const ok = (r: Res, what: string): Res =>
  r.status >= 200 && r.status < 300
    ? r
    : fail(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);

const pdfForm = (name: string): FormData => {
  const f = new FormData();
  f.append("file", new File([SAMPLE_PDF], name, { type: "application/pdf" }));
  return f;
};

async function stateOf(c: Ctx, s: KindSample): Promise<SampleState> {
  const id = sampleId(s.n);
  const [r] = rows<{ id: string; status: SampleState["status"]; terms: boolean }>(
    await c.sql`select id::text as id, status, kind_terms is not null as terms from contracts.contracts
      where tenant_id = ${c.tid}::uuid and (id = ${id}::uuid or title = ${s.title}) order by (id = ${id}::uuid) desc limit 1`,
  );
  if (!r)
    return { exists: false, status: null, hasKindTerms: false, hasFile: false, hasRun: false };
  const [f] = rows<{ n: number }>(
    await c.sql`select count(*)::int as n from contracts.contract_files where contract_id = ${r.id}::uuid`.catch(
      () => [{ n: 0 }],
    ),
  );
  const [run] = rows<{ x: number }>(
    await c.sql`select 1 as x from hub.process_runs where pack_key = 'contracts' and pack_record_id = ${r.id}::uuid
      and status not in ('cancelled','failed','expired') limit 1`,
  );
  return {
    exists: true,
    status: r.status,
    hasKindTerms: r.terms,
    hasFile: (f?.n ?? 0) > 0,
    hasRun: !!run,
  };
}

async function create(c: Ctx, s: KindSample): Promise<void> {
  const [u] = rows<{ id: string }>(
    await c.sql`select id from admin.users where tenant_id = ${c.tid}::uuid and username = ${s.by}`,
  );
  if (!u) fail(`không có người dùng ${s.by} (chạy --org-only trước)`);
  await c.sql`insert into contracts.contracts
      (id, tenant_id, kind, title, deal, direction, status, extract_state, owner_user_id, created_by, version, fields)
    values (${sampleId(s.n)}, ${c.tid}, 'contract', ${s.title}, ${s.deal}, ${s.direction}, 'draft', 'ready', ${u?.id ?? null}, ${u?.id ?? null}, 1,
      ${c.sql.json({} as never)})
    on conflict (id) do nothing`;
}

/** Người duyệt = quản trị công ty (Toàn quyền): nhận việc → Duyệt (bước Bằng chứng ⇒ ý kiến + tệp mẫu) → bước Ký ⇒ tải bản đã ký, tới DONE. */
async function approveAll(c: Ctx, s: KindSample): Promise<void> {
  const id = sampleId(s.n);
  const tok = await login(c, APPROVER);
  for (let i = 0; i < 12; i++) {
    const [k] = rows<{ status: string }>(
      await c.sql`select status from contracts.contracts where id = ${id}::uuid`,
    );
    if (k?.status === "done") return;
    const [t] = rows<{ task: string; uid: string }>(
      await c.sql`select t.id::text as task, u.id::text as uid
        from hub.process_runs r join hub.review_tasks t on t.process_run_id = r.id and t.status = 'open'
        cross join admin.users u
        where r.pack_key = 'contracts' and r.pack_record_id = ${id}::uuid and u.tenant_id = ${c.tid}::uuid and u.username = ${APPROVER}
        order by r.started_at desc limit 1`,
    );
    if (t) {
      ok(await hub(c, tok, "POST", `/review-tasks/${t.task}/claim`, {}), "nhận việc duyệt");
      const decide = (evidence?: unknown) =>
        hub(c, tok, "POST", `${BASE}/${id}/approval`, {
          action: "approve",
          feedback: "Duyệt (dữ liệu mẫu CR-152)",
          ...(evidence ? { evidence } : {}),
        });
      let r = await decide();
      if (r.status === 422 && (r.json.error as Json | undefined)?.code === "EVIDENCE_REQUIRED") {
        const att = crypto.randomUUID();
        await c.sql`insert into hub.attachments (id, tenant_id, user_id, origin, filename, safe_name, mime, size, sha256, storage_key)
          values (${att}::uuid, ${c.tid}::uuid, ${t.uid}::uuid, 'upload', 'bien-ban-mau.pdf', 'bien-ban-mau.pdf', 'application/pdf', 1,
            ${"0".repeat(64)}, ${`${c.tid}/${att}`})`;
        r = await decide({ note: "Duyệt (dữ liệu mẫu CR-152)", attachment_ids: [att] });
      }
      ok(r, "duyệt");
      continue;
    }
    // không còn việc duyệt mở: bước Ký (tải bản đã ký) hoặc engine đang chuyển bước
    const up = await hub(
      c,
      tok,
      "POST",
      `${BASE}/${id}/signed-upload`,
      pdfForm("hd-da-ky-mau.pdf"),
    );
    if (up.status !== 201 && up.status !== 409) ok(up, "tải bản đã ký");
    // engine chuyển bước bất đồng bộ (sự kiện): chờ có trần, giống seed-cr113-samples
    await new Promise((r) => setTimeout(r, 400));
  }
  const [k] = rows<{ status: string }>(
    await c.sql`select status from contracts.contracts where id = ${id}::uuid`,
  );
  if (k?.status !== "done")
    fail(
      `HĐ «${s.title}» chưa tới DONE (status ${k?.status}) — xem quy trình «Ký hợp đồng» của demo`,
    );
}

async function review(c: Ctx, tok: string, s: KindSample, now: Date): Promise<void> {
  const id = sampleId(s.n);
  const [v] = rows<{ version: number }>(
    await c.sql`select version from contracts.contracts where id = ${id}::uuid`,
  );
  const body = {
    version: v?.version ?? 1,
    deal: s.deal,
    fields: sampleFields(s, now),
    milestones: [],
  };
  ok(await hub(c, tok, "POST", `${BASE}/${id}/review`, body), "lưu (review)");
}

async function submit(c: Ctx, tok: string, s: KindSample): Promise<void> {
  const body = { unchanged_reason: "HĐ mẫu CR-152" };
  const r = ok(await hub(c, tok, "POST", `${BASE}/${sampleId(s.n)}/submit`, body), "gửi duyệt");
  if (r.json.no_flow) fail(`«${s.title}»: không có quy trình khớp (no_flow)`);
}

async function runStep(
  c: Ctx,
  tok: string,
  s: KindSample,
  now: Date,
  step: SampleStep,
): Promise<void> {
  const id = sampleId(s.n);
  if (step === "create") return create(c, s);
  if (step === "kind_terms")
    return void ok(
      await hub(c, tok, "PUT", `${BASE}/${id}/kind-terms`, { terms: s.terms }),
      "kind-terms",
    );
  if (step === "file")
    return void ok(
      await hub(c, tok, "POST", `${BASE}/${id}/files`, pdfForm("hd-mau.pdf")),
      "tải PDF mẫu",
    );
  if (step === "review") return review(c, tok, s, now);
  if (step === "submit") return submit(c, tok, s);
  return approveAll(c, s);
}

async function runSample(c: Ctx, s: KindSample, now: Date): Promise<void> {
  const steps = planSample(s, await stateOf(c, s));
  if (!steps.length) return void console.log(`${TAG}: «${s.title}» đã có — bỏ qua`);
  const tok = await login(c, s.by);
  for (const step of steps) await runStep(c, tok, s, now, step);
  console.log(`${TAG}: «${s.title}» — ${steps.join(" → ")}`);
}

async function main(): Promise<void> {
  const url = env("DATABASE_URL");
  const bad = kindSamplesGuard(process.env, url);
  if (bad) fail(`từ chối — ${bad}`);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || "http://localhost:4000";
  const api: Api = { base: authUrl, token: await adminToken(authUrl) };
  const list = await call(api, "GET", `/admin/tenants?q=${KIND_SAMPLES_TENANT}&limit=50`);
  const tid = String(
    ((list.items as Json[]) ?? []).find((t) => t.key === KIND_SAMPLES_TENANT)?.id ??
      fail("không có công ty demo"),
  );
  const sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const c: Ctx = { sql, tid, authUrl, hubUrl, pw: env("DEMO_OWNER_PW") };
    const now = new Date();
    for (const s of KIND_SAMPLES) await runSample(c, s, now);
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
