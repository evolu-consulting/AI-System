// CR-181 · s16 · dữ liệu mẫu UAT «Ký trên tài liệu» trên tenant `demo` của bản test. Chạy qua `deploy/stg-test/seed-demo.sh --sign-only`
// (SAU `--org-only` + `--partner-only`). LẶP LẠI ĐƯỢC, CHỈ THÊM; guard: từ chối production / DB ngoài (stg-test hoặc máy dev).
//   1) bật `on_doc_enabled` của demo (PUT /company/signature-settings bằng quản trị công ty `demo-owner`; đã bật ⇒ bỏ qua; định dạng khác = mặc định);
//   2) quy trình «Duyệt và ký hợp đồng (ký trên tài liệu)» qua đường admin nền tảng (như seed-cr128-flows), xét ĐẦU thứ tự, điều kiện hẹp (phòng Kinh doanh + ≤ 100 triệu);
//   3) HĐ Nháp mẫu của sale demo + 2 PDF (hợp đồng 6 trang, phụ lục 2 trang), đối tác evolu có email. KHÔNG tạo chữ ký sẵn cho ai.
import postgres, { type Sql } from "postgres";
import {
  ANNEX_FILE,
  annexPdf,
  CONTRACT_FILE,
  contractPdf,
  pickSampleTarget,
  planSignSample,
  SIGN_ID_PREFIX,
  SIGN_PARTNER,
  SIGN_SALE,
  SIGN_SIGNER_GROUP,
  SIGN_SIGNER_USER,
  SIGN_TENANT,
  type SignSampleState,
  type SignSampleStep,
  type SignSampleTarget,
  signerNeedsAdd,
  signPartnerKey,
  signSampleFields,
  signSeedGuard,
  signSettingsBody,
  signSettingsNeeded,
} from "./seed-cr181-sign.data";

const TAG = "seed-cr181-sign";
const BASE = "/pack/contracts/contracts";

import { ensureFlows } from "./seed-cr181-sign.flows";
import { type Call, caller, env, fail, type Json, login, must } from "./seed-cr181-sign.http";

/** 1) Bật ký trên tài liệu (quản trị công ty). */
async function enableOnDoc(hubUrl: string, authUrl: string, pw: string): Promise<void> {
  const owner = caller(hubUrl, await login(authUrl, SIGN_TENANT, "demo-owner", pw));
  const cur = must(await owner("GET", "/company/signature-settings"), [200], "đọc thiết lập ký");
  if (!signSettingsNeeded(cur.settings ?? null))
    return void console.log(`${TAG}: ký trên tài liệu đã bật`);
  must(
    await owner("PUT", "/company/signature-settings", signSettingsBody()),
    [200],
    "bật ký trên tài liệu",
  );
  console.log(`${TAG}: đã bật ký trên tài liệu cho ${SIGN_TENANT}`);
}

/** 1b) Giám đốc demo phải thuộc nhóm người ký (UAT: «chưa đến lượt» khi thiếu). Chỉ THÊM; có rồi ⇒ bỏ qua. */
async function ensureSigner(admin: Call, tid: string): Promise<void> {
  const gj = must(
    await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`),
    [200],
    "đọc nhóm",
  );
  const gid = String(
    (gj.items as Json[]).find((g) => g.key === SIGN_SIGNER_GROUP)?.id ??
      fail(`thiếu nhóm ${SIGN_SIGNER_GROUP} (chạy --org-only trước)`),
  );
  const mem = must(
    await admin("GET", `/admin/groups/${gid}/members?limit=200`),
    [200],
    "đọc thành viên",
  );
  if (!signerNeedsAdd((mem.items as Json[]).map((m) => String(m.username))))
    return void console.log(`${TAG}: ${SIGN_SIGNER_USER} đã thuộc nhóm ${SIGN_SIGNER_GROUP}`);
  must(
    await admin("POST", `/admin/groups/${gid}/members`, { usernames: [SIGN_SIGNER_USER] }),
    [200, 201],
    "thêm người ký vào nhóm",
  );
  console.log(`${TAG}: đã thêm ${SIGN_SIGNER_USER} vào nhóm ${SIGN_SIGNER_GROUP}`);
}

const pdfForm = (name: string, bytes: Uint8Array): FormData => {
  const f = new FormData();
  f.append("file", new File([bytes], name, { type: "application/pdf" }));
  return f;
};

/** HĐ mẫu ĐỜI HIỆN TẠI đã có (id theo ngày, tiền tố `SIGN_ID_PREFIX`) + trạng thái, theo id tăng dần. */
async function existingSamples(sql: Sql, tid: string): Promise<{ id: string; status: string }[]> {
  return await sql<{ id: string; status: string }[]>`select id::text as id, status
    from contracts.contracts where tenant_id = ${tid}::uuid and id::text like ${`${SIGN_ID_PREFIX}%`}
    order by id`;
}

/** Trạng thái hiện có của HĐ mẫu `cid` + sổ đối tác (để lập kế hoạch idempotent). Tên tệp ở `contracts.files` (tệp kèm qua `contract_files`, tệp chính qua `contracts.file_id`). */
export async function sampleState(sql: Sql, tid: string, cid: string): Promise<SignSampleState> {
  const [st] = await sql<
    { status: string; file_id: string | null }[]
  >`select status, file_id::text as file_id
    from contracts.contracts where id = ${cid}::uuid and tenant_id = ${tid}::uuid`;
  const names = st
    ? (
        await sql<{ name: string }[]>`select f.name from contracts.files f
          where f.tenant_id = ${tid}::uuid and (
            f.id = ${st.file_id}::uuid
            or exists (select 1 from contracts.contract_files cf
              where cf.contract_id = ${cid}::uuid and cf.file_id = f.id and cf.tenant_id = f.tenant_id))`
      ).map((r) => r.name)
    : [];
  const [facts] = await sql<
    { ok: boolean }[]
  >`select (jsonb_typeof(fields -> 'total_value' -> 'value') = 'number'
      and coalesce(fields -> 'buyer_tax_id' ->> 'value', '') <> '') as ok
    from contracts.contracts where id = ${cid}::uuid and tenant_id = ${tid}::uuid`;
  const [pc] = await sql<{ n: number }[]>`select count(*)::int as n from contracts.partner_contacts
    where tenant_id = ${tid}::uuid and party_key = ${signPartnerKey()} and email is not null and btrim(email) <> ''`;
  return {
    exists: !!st,
    status: st?.status ?? null,
    fileNames: names,
    hasMain: !!st?.file_id,
    hasPartnerContact: (pc?.n ?? 0) > 0,
    hasFacts: !!facts?.ok,
  };
}

type StepCtx = SignSampleTarget & { cid: string; sql: Sql; tid: string; uid: string; sale: Call };
const stepSql: Partial<Record<SignSampleStep, (c: StepCtx) => Promise<void>>> = {
  create: async ({ sql, tid, uid, cid, title }) => {
    const fields = signSampleFields(title);
    await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, status, extract_state, owner_user_id, created_by, version, fields)
      values (${cid}, ${tid}, 'contract', ${title}, 'sale', 'draft', 'ready', ${uid}, ${uid}, 1, ${sql.json(fields as never)})
      on conflict (id) do nothing`;
  },
  // Sửa HĐ Nháp có `fields` sai hình (không có số giá trị / đối tác) ⇒ ghi lại đúng hình trích xuất; chỉ khi còn Nháp.
  fix_fields: async ({ sql, tid, cid, title }) => {
    await sql`update contracts.contracts set fields = ${sql.json(signSampleFields(title) as never)}, updated_at = now()
      where id = ${cid}::uuid and tenant_id = ${tid}::uuid and status = 'draft'`;
  },
  // Tệp hợp đồng vừa tải (tệp kèm) ⇒ thành tệp chính của HĐ (Q14); bỏ liên kết tệp kèm. Chỉ khi HĐ chưa có tệp chính.
  promote_main: async ({ sql, tid, cid }) => {
    await sql`update contracts.contracts set file_id = cf.file_id
      from contracts.contract_files cf join contracts.files f on f.id = cf.file_id and f.tenant_id = cf.tenant_id
      where contracts.contracts.id = ${cid}::uuid and contracts.contracts.tenant_id = ${tid}::uuid
        and contracts.contracts.file_id is null and cf.contract_id = contracts.contracts.id and f.name = ${CONTRACT_FILE}`;
    await sql`delete from contracts.contract_files cf using contracts.contracts c
      where c.id = ${cid}::uuid and c.tenant_id = ${tid}::uuid and cf.contract_id = c.id and cf.file_id = c.file_id`;
  },
  // Bên B của «Tự đặt theo ĐẠI DIỆN BÊN B» = liên hệ đầu tiên CÓ email của đối tác (sổ đối tác), không phải `fields.partner_email`.
  partner_contact: async ({ sql, tid, uid }) => {
    await sql`insert into contracts.partner_contacts (tenant_id, party_key, name, email, created_by)
      values (${tid}::uuid, ${signPartnerKey()}, ${SIGN_PARTNER.name}, ${SIGN_PARTNER.email}, ${uid}::uuid)`;
  },
};

async function uploadSample(sale: Call, cid: string, step: SignSampleStep): Promise<void> {
  const main = step === "file_contract";
  const doc = main ? await contractPdf() : await annexPdf();
  const name = main ? CONTRACT_FILE : ANNEX_FILE;
  must(await sale("POST", `${BASE}/${cid}/files`, pdfForm(name, doc.bytes)), [201], `tải ${name}`);
}

/** 3) HĐ Nháp mẫu + 2 PDF (đúng đường API của sale; HĐ tạo bằng SQL như seed-kind-samples). */
async function ensureSample(sql: Sql, tid: string, hubUrl: string, authUrl: string, pw: string) {
  const target = pickSampleTarget(
    await existingSamples(sql, tid),
    new Date(),
    process.argv.includes("--sign-new"),
  );
  const cid = target.id;
  const steps = planSignSample(await sampleState(sql, tid, cid));
  if (!steps.length) return void console.log(`${TAG}: HĐ mẫu đã có — bỏ qua`);
  const [u] = await sql<{ id: string }[]>`select id from admin.users
    where tenant_id = ${tid}::uuid and username = ${SIGN_SALE}`;
  const uid = u?.id ?? fail(`không có người dùng ${SIGN_SALE} (chạy --org-only trước)`);
  const sale = caller(hubUrl, await login(authUrl, SIGN_TENANT, SIGN_SALE, pw));
  for (const step of steps) {
    const run = stepSql[step];
    if (run) await run({ ...target, cid, sql, tid, uid, sale });
    else await uploadSample(sale, cid, step);
  }
  const after = await sampleState(sql, tid, cid);
  if (!after.hasFacts)
    fail(
      `HĐ mẫu ${cid}: thiếu giá trị số hoặc đối tác trong fields — quy trình ký trên tài liệu sẽ không khớp`,
    );
  console.log(`${TAG}: HĐ mẫu «${target.title}» — ${steps.join(" → ")}`);
}

async function main(): Promise<void> {
  const url = env("DATABASE_URL");
  const bad = signSeedGuard(process.env, url);
  if (bad) fail(`từ chối — ${bad}`);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || `http://localhost:${process.env.HUB_PORT || "4000"}`;
  const pw = env("DEMO_OWNER_PW");
  const tok = await login(
    authUrl,
    "platform",
    env("SEED_ADMIN_USERNAME"),
    env("SEED_ADMIN_PASSWORD"),
  );
  const admin = caller(authUrl, tok);
  const hub = caller(hubUrl, tok);
  const tenants = must(await admin("GET", "/admin/tenants?limit=100"), [200], "đọc công ty");
  const tid = String(
    (tenants.items as Json[]).find((t) => t.key === SIGN_TENANT)?.id ??
      fail("không có công ty demo"),
  );
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await enableOnDoc(hubUrl, authUrl, pw);
    await ensureSigner(admin, tid);
    const gj = must(
      await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`),
      [200],
      "đọc nhóm",
    );
    const groups = new Map((gj.items as Json[]).map((g) => [String(g.key), String(g.id)]));
    const owner = caller(hubUrl, await login(authUrl, SIGN_TENANT, "demo-owner", pw));
    await ensureFlows(hub, owner, sql, tid, groups);
    await ensureSample(sql, tid, hubUrl, authUrl, pw);
  } finally {
    await sql.end();
  }
  console.log(`${TAG} OK`);
}

if (import.meta.main)
  main().catch((e) => {
    console.error(`${TAG} lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
