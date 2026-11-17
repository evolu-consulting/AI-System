// CR-181 · s16 · dữ liệu mẫu UAT «Ký trên tài liệu» trên tenant `demo` của bản test. Chạy qua `deploy/stg-test/seed-demo.sh --sign-only`
// (SAU `--org-only` + `--partner-only`). LẶP LẠI ĐƯỢC, CHỈ THÊM; guard: từ chối production / DB ngoài (stg-test hoặc máy dev).
//   1) bật `on_doc_enabled` của demo (PUT /company/signature-settings bằng quản trị công ty `demo-owner`; đã bật ⇒ bỏ qua; định dạng khác = mặc định);
//   2) quy trình «Duyệt và ký hợp đồng (ký trên tài liệu)» qua đường admin nền tảng (như seed-cr128-flows), xét ĐẦU thứ tự, điều kiện hẹp (phòng Kinh doanh + ≤ 100 triệu);
//   3) HĐ Nháp mẫu của sale demo + 2 PDF (hợp đồng 6 trang, phụ lục 2 trang), đối tác evolu có email. KHÔNG tạo chữ ký sẵn cho ai.
import postgres, { type Sql } from "postgres";
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import {
  ANNEX_FILE,
  annexPdf,
  CONTRACT_FILE,
  contractPdf,
  pickSampleTarget,
  planSignSample,
  SIGN_CONTRACT_ID,
  SIGN_CONTRACT_VALUE,
  SIGN_FLOW_NAME,
  SIGN_PARTNER,
  SIGN_SALE,
  SIGN_SELF,
  SIGN_SIGNER_GROUP,
  SIGN_SIGNER_USER,
  SIGN_TENANT,
  type SignSampleState,
  type SignSampleStep,
  type SignSampleTarget,
  signerNeedsAdd,
  signFlowOrder,
  signFlowStages,
  signFlowTrigger,
  signPartnerKey,
  signSeedGuard,
  signSettingsBody,
  signSettingsNeeded,
  withOnDocSigner,
} from "./seed-cr181-sign.data";
import { seedInputs } from "./seed-demo-partner.data";

const TAG = "seed-cr181-sign";
const BASE = "/pack/contracts/contracts";
// biome-ignore lint/suspicious/noExplicitAny: JSON của API, đọc theo đường dẫn
type Json = Record<string, any>;
type Res = { status: number; json: Json };
type Call = (method: string, path: string, body?: unknown) => Promise<Res>;

const fail = (m: string): never => {
  throw new Error(m);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k}`);
const must = (r: Res, ok: number[], what: string): Json =>
  ok.includes(r.status)
    ? r.json
    : fail(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 240)}`);

async function login(authUrl: string, tenant: string, username: string, password: string) {
  const res = await fetch(`${authUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_key: tenant, username, password }),
  });
  const j = (await res.json()) as Json;
  if (j.status !== "authenticated") fail(`đăng nhập ${tenant}/${username} → ${res.status}`);
  return String(j.access_token);
}
const caller =
  (base: string, token: string): Call =>
  async (method, path, body) => {
    const form = body instanceof FormData;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(form ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };

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

/** 2) Quy trình theo tên (có ⇒ ghi đè bước, không nhân bản) → PUT → Áp dụng → đưa lên đầu thứ tự. */
async function ensureFlow(hub: Call, admin: Call, tid: string): Promise<void> {
  const base = `/tenants/${tid}/company-flows`;
  const items = (r: Res): Json[] => (r.json.items as Json[]) ?? [];
  const list = must(await hub("GET", base), [200], "đọc quy trình");
  let row = items({ status: 200, json: list }).find((x) => x.name === SIGN_FLOW_NAME);
  if (!row) {
    const made = must(
      await hub("POST", base, { name: SIGN_FLOW_NAME, app: "contracts", from: "blank" }),
      [200, 201],
      "tạo quy trình",
    );
    row = (made.items as Json[]).find((x) => x.flow_id === made.flow_id);
  }
  const flowId = String(row?.flow_id ?? fail("không thấy quy trình sau khi tạo"));
  const gj = must(
    await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`),
    [200],
    "đọc nhóm",
  );
  const groups = new Map((gj.items as Json[]).map((g) => [String(g.key), String(g.id)]));
  const signer =
    groups.get(SIGN_SIGNER_GROUP) ??
    fail(`thiếu nhóm ${SIGN_SIGNER_GROUP} (chạy --org-only trước)`);
  const def = must(await hub("GET", `/process-defs/${flowId}?tenant_id=${tid}`), [200], "đọc def");
  const bound = bindGroupKeys(withOnDocSigner(signFlowStages(), signer), groups, { strip: true });
  if (bound.missing.length) fail(`thiếu nhóm: ${bound.missing.join(", ")}`);
  const inputs = seedInputs(def.inputs);
  must(
    await hub("PUT", `/process-defs/${flowId}?tenant_id=${tid}`, {
      key: def.key,
      name: def.name,
      description: def.description ?? "",
      input_hint: def.input_hint ?? "",
      run_group_ids: def.run_group_ids ?? [],
      stages: bound.stages,
      token_budget: def.token_budget ?? null,
      enabled: true,
      sources: def.sources ?? [],
      inputs,
      trigger: signFlowTrigger(),
      app: "contracts",
      version: def.version,
    }),
    [200],
    "lưu bước quy trình",
  );
  must(await hub("POST", `${base}/apply`, { flow_id: flowId }), [200], "áp dụng quy trình");
  const after = items({ status: 200, json: must(await hub("GET", base), [200], "đọc lại") });
  const mine = String(
    after.find((x) => x.name === SIGN_FLOW_NAME)?.id ?? fail("thiếu quy trình sau áp dụng"),
  );
  const order = signFlowOrder(
    after.map((x) => String(x.id)),
    mine,
  );
  must(await hub("PUT", `${base}/order`, { ids: order }), [200, 204], "đặt thứ tự");
  console.log(`${TAG}: quy trình «${SIGN_FLOW_NAME}» đã áp dụng, đứng đầu thứ tự`);
}

const pdfForm = (name: string, bytes: Uint8Array): FormData => {
  const f = new FormData();
  f.append("file", new File([bytes], name, { type: "application/pdf" }));
  return f;
};

/** HĐ mẫu đã có (id gốc hoặc id theo ngày, `c1810000-0000-4000-8000-16…`) + trạng thái, theo id tăng dần. */
async function existingSamples(sql: Sql, tid: string): Promise<{ id: string; status: string }[]> {
  return await sql<{ id: string; status: string }[]>`select id::text as id, status
    from contracts.contracts where tenant_id = ${tid}::uuid and (id = ${SIGN_CONTRACT_ID}::uuid or id::text like 'c1810000-0000-4000-8000-16%')
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
  const [pc] = await sql<{ n: number }[]>`select count(*)::int as n from contracts.partner_contacts
    where tenant_id = ${tid}::uuid and party_key = ${signPartnerKey()} and email is not null and btrim(email) <> ''`;
  return {
    exists: !!st,
    status: st?.status ?? null,
    fileNames: names,
    hasMain: !!st?.file_id,
    hasPartnerContact: (pc?.n ?? 0) > 0,
  };
}

type StepCtx = SignSampleTarget & { cid: string; sql: Sql; tid: string; uid: string; sale: Call };
const stepSql: Partial<Record<SignSampleStep, (c: StepCtx) => Promise<void>>> = {
  create: async ({ sql, tid, uid, cid, title }) => {
    const fields = {
      title,
      supplier_name: SIGN_SELF.name,
      supplier_tax_id: SIGN_SELF.tax,
      buyer_name: SIGN_PARTNER.name,
      buyer_tax_id: SIGN_PARTNER.tax,
      partner_email: SIGN_PARTNER.email,
      total_value: SIGN_CONTRACT_VALUE,
    };
    await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, status, extract_state, owner_user_id, created_by, version, fields)
      values (${cid}, ${tid}, 'contract', ${title}, 'sale', 'draft', 'ready', ${uid}, ${uid}, 1, ${sql.json(fields as never)})
      on conflict (id) do nothing`;
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
  const target = pickSampleTarget(await existingSamples(sql, tid), new Date());
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
    await ensureFlow(hub, admin, tid);
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
