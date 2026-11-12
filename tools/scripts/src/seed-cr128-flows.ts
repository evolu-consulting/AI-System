// CR-128 · L3 · dựng 2 quy trình cho tenant `demo` bằng ĐÚNG đường platform admin làm (API Hub như màn Quy trình gọi):
//   POST /tenants/:tid/company-flows (sơ đồ trống) → PUT /process-defs/:id (vẽ bước) → POST …/company-flows/apply (Áp dụng cho công ty).
//   1) «Duyệt hợp đồng»  : bắt đầu khi `contract.submitted`; Trưởng phòng duyệt; Nếu giá trị > 500 triệu ⇒ Giám đốc duyệt; Kết thúc.
//   2) «Đề nghị mua hàng»: bắt đầu bằng phiếu Yêu cầu (mặt hàng, số lượng, giá trị dự kiến, lý do) → Trưởng phòng duyệt → Kết thúc.
// LẶP LẠI ĐƯỢC: quy trình cùng tên đã có ⇒ ghi đè bước + áp dụng lại (không nhân bản). Cuối cùng tự kiểm (exit ≠ 0 khi sai):
//   2 quy trình đang Bật; «Đề nghị mua hàng» hiện ở `/processes/startable`; gửi duyệt một HĐ thử (SQL nháp → `POST …/submit`) không 409
//   rồi dọn HĐ thử. Chỉ chạy ở máy dev (từ chối APP_ENV=production / DB ngoài localhost) và chỉ tenant `demo`.
//   bun run demo:flows        (= bun --env-file=.env.local tools/scripts/src/seed-cr128-flows.ts [--skip-check])
// Cần admin-api (AUTH_URL, mặc định :3001) + hub-api (HUB_URL, mặc định :4000) đang chạy; mật khẩu lấy từ .env.local
// (SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD cho admin nền tảng; DEMO_OWNER_PW cho user demo) — không in ra.
import { parseArgs } from "node:util";
import postgres from "postgres";
import {
  approve,
  finish,
  norm,
  reviewNew,
  type Stage,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import { bindGroupKeys } from "../../../apps/hub-api/src/modules/processes/public";
import { isLocalDbHost } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";

const TAG = "seed-cr128-flows";
const TENANT = "demo";
const CONTRACT_FLOW = "Duyệt hợp đồng";
const BUY_FLOW = "Đề nghị mua hàng";
const THRESHOLD = 500_000_000;
/** CR-139c · phòng ban là nguồn duy nhất: «Giám đốc duyệt» = trưởng Ban Giám đốc (phòng gốc của `deploy/tenants/demo.yaml`); không còn nhóm trùng phòng ban. */
const DIRECTOR_DEPT = "pb-giam-doc";

// biome-ignore lint/suspicious/noExplicitAny: JSON của API, đọc theo đường dẫn
type Json = Record<string, any>;
type Res = { status: number; json: Json };
type Call = (method: string, path: string, body?: unknown) => Promise<Res>;

const fail = (msg: string): never => {
  throw new Error(msg);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k} trong .env.local`);

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
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };
const must = (r: Res, ok: number[], what: string): Json => {
  if (!ok.includes(r.status)) fail(`${what} → ${r.status} ${JSON.stringify(r.json).slice(0, 240)}`);
  return r.json;
};

// ── bước của 2 quy trình (hình dữ liệu như màn soạn: mã nhóm → id nhóm của công ty bằng `bindGroupKeys`) ──
const ifTotal = (step: number, then: number, otherwise: number): Stage => ({
  key: "re-nhanh",
  name: "Giá trị trên 500 triệu?",
  step,
  instruction: "",
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
  executor: {
    kind: "if",
    when: {
      op: "and",
      conds: [{ from: { kind: "fact", key: "total_value" }, op: "gt", value: THRESHOLD }],
    },
    then_step: then,
    else_step: otherwise,
  },
  output: { filename: "re-nhanh.md", template: "x", required_sections: ["x"], fields: [] },
  after: { kind: "auto", branch: [] },
});

/** CR-139c · «Trưởng phòng duyệt» theo người đề xuất: `approver_mode='starter_head'` (không chọn nhóm; phòng không có trưởng ⇒ lên phòng cha). */
const headApprove = (step: number, to: { reject: number; ret: number }, o: Stage = {}) => {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return approve("truong-phong", "Trưởng phòng duyệt", step, "", to, {
    after: { ...after, approver_mode: "starter_head" },
    ...o,
  });
};
/** CR-139c · «Giám đốc duyệt» = trưởng phòng Ban Giám đốc (chỉ trưởng phòng quyết). */
const directorApprove = (step: number, to: { reject: number; ret: number }) =>
  approve("giam-doc", "Giám đốc duyệt", step, DIRECTOR_DEPT, to, {
    next_step: 3,
    after: { ...reviewNew(DIRECTOR_DEPT), head_only: true, need: "head" },
  });

/** Trưởng phòng duyệt → Nếu > 500 triệu → Giám đốc duyệt → Kết thúc · Đã duyệt (+ Từ chối, Trả lại). */
const contractStages = (): unknown[] => {
  const to = { reject: 4, ret: 5 };
  return norm([
    headApprove(0, to),
    ifTotal(1, 2, 3),
    directorApprove(2, to),
    finish(3, "approved", "Đã duyệt"),
    finish(4, "rejected", "Từ chối"),
    finish(5, "returned", "Trả lại"),
  ]);
};

/** Phiếu Yêu cầu → Trưởng phòng duyệt → Kết thúc (kết quả đầu của app Sổ Hợp Tác để «Áp dụng» không bị khoá). */
const buyStages = (): unknown[] => {
  const to = { reject: 3, ret: 4 };
  const phieu: Stage = {
    key: "phieu-de-nghi-mua-hang",
    name: "Đề nghị mua hàng",
    step: 0,
    node: "core.start-form",
    instruction: "",
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 120,
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
    executor: { kind: "set", values: [] },
    output: { filename: "phieu.md", template: "x", required_sections: ["x"], fields: [] },
    after: { kind: "auto", branch: [] },
    start_form: {
      fields: [
        { key: "mat_hang", label: "Mặt hàng", type: "text", required: true },
        { key: "so_luong", label: "Số lượng", type: "text", required: true },
        { key: "gia_tri_du_kien", label: "Giá trị dự kiến", type: "money", required: true },
        { key: "ly_do", label: "Lý do", type: "longtext", required: false },
      ],
      starters: { kind: "everyone" },
      title_template: "Đề nghị mua {{mat_hang}}",
    },
  };
  return norm([
    phieu,
    headApprove(1, to),
    finish(2, "approved", "Đã duyệt"),
    finish(3, "rejected", "Từ chối"),
    finish(4, "returned", "Trả lại"),
  ]);
};

type Ctx = { hub: Call; tid: string; groups: Map<string, string> };

/** Quy trình công ty theo tên (ghi đè nếu có) → PUT bước → Áp dụng. Trả `flow_id`. */
async function ensureFlow(
  c: Ctx,
  name: string,
  stages: unknown[],
  trigger: unknown,
): Promise<string> {
  const base = `/tenants/${c.tid}/company-flows`;
  const list = must(await c.hub("GET", base), [200], "đọc danh sách quy trình");
  let row = (list.items as Json[]).find((x) => x.name === name);
  if (!row) {
    const made = must(
      await c.hub("POST", base, { name, app: "contracts", from: "blank" }),
      [200, 201],
      `tạo «${name}»`,
    );
    row = (made.items as Json[]).find((x) => x.flow_id === made.flow_id);
  }
  const flowId = String(row?.flow_id ?? fail(`không thấy «${name}» sau khi tạo`));
  const def = must(
    await c.hub("GET", `/process-defs/${flowId}?tenant_id=${c.tid}`),
    [200],
    "đọc def",
  );
  const bound = bindGroupKeys(stages, c.groups, { strip: true });
  if (bound.missing.length) fail(`công ty demo thiếu nhóm: ${bound.missing.join(", ")}`);
  must(
    await c.hub("PUT", `/process-defs/${flowId}?tenant_id=${c.tid}`, {
      key: def.key,
      name: def.name,
      description: def.description ?? "",
      input_hint: def.input_hint ?? "",
      run_group_ids: def.run_group_ids ?? [],
      stages: bound.stages,
      token_budget: def.token_budget ?? null,
      enabled: true,
      sources: def.sources ?? [],
      inputs: def.inputs ?? [],
      trigger,
      app: "contracts",
      version: def.version,
    }),
    [200],
    `lưu bước «${name}»`,
  );
  must(await c.hub("POST", `${base}/apply`, { flow_id: flowId }), [200], `áp dụng «${name}»`);
  return flowId;
}

async function groupIds(admin: Call, tid: string): Promise<Map<string, string>> {
  const j = must(await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`), [200], "đọc nhóm");
  return new Map((j.items as Json[]).map((g) => [String(g.key), String(g.id)]));
}

// ── tự kiểm ──
async function verify(c: Ctx, authUrl: string, hubUrl: string, sql: ReturnType<typeof postgres>) {
  const list = must(await c.hub("GET", `/tenants/${c.tid}/company-flows`), [200], "kiểm danh sách");
  for (const n of [CONTRACT_FLOW, BUY_FLOW]) {
    const r = (list.items as Json[]).find((x) => x.name === n);
    if (!r?.enabled) fail(`«${n}» chưa Bật: ${JSON.stringify(r)}`);
  }
  const pw = env("DEMO_OWNER_PW");
  const editorTok = await login(authUrl, TENANT, "demo-editor", pw);
  const editor = caller(hubUrl, editorTok);
  const start = must(await editor("GET", "/processes/startable"), [200], "startable");
  if (!(start.items as Json[]).some((x) => x.name === BUY_FLOW))
    fail(`«${BUY_FLOW}» không hiện ở /processes/startable của demo-editor`);
  // HĐ thử: nháp (SQL, như seed-cr113) → Gửi duyệt đúng đường người tạo → không 409 → rút + xoá.
  const [u] = await sql<
    { id: string }[]
  >`select u.id from admin.users u where u.tenant_id = ${c.tid}::uuid and u.username = 'demo-editor'`;
  const id = crypto.randomUUID();
  await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, status, extract_state, owner_user_id, created_by, version, fields)
    values (${id}, ${c.tid}, 'contract', '[CR-128] HĐ thử (tự xoá)', 'purchase', 'draft', 'ready', ${u?.id ?? null}, ${u?.id ?? null}, 1,
      ${sql.json({ total_value: 120_000_000 } as never)})`;
  try {
    const sub = await editor("POST", `/pack/contracts/contracts/${id}/submit`, {
      unchanged_reason: "HĐ thử CR-128",
    });
    if (sub.status === 409)
      fail(`gửi duyệt HĐ thử → 409 ${JSON.stringify(sub.json).slice(0, 200)}`);
    must(sub, [200], "gửi duyệt HĐ thử");
    if (sub.json.no_flow) fail("gửi duyệt HĐ thử: không có quy trình khớp (no_flow)");
    // Lượt mở bất đồng bộ (bộ điều phối sự kiện): chờ tới khi thấy lượt, tối đa 20 s.
    let n = 0;
    for (const end = Date.now() + 20_000; Date.now() < end && n < 1; ) {
      const [t] = await sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs
        where pack_key = 'contracts' and pack_record_id = ${id} and status not in ('cancelled','failed','expired')`;
      n = t?.n ?? 0;
      if (n < 1) await new Promise((r) => setTimeout(r, 300));
    }
    if (n < 1) fail("gửi duyệt HĐ thử không mở lượt duyệt");
    console.log(`${TAG}: HĐ thử gửi duyệt OK (${n} lượt)`);
  } finally {
    await editor("POST", `/pack/contracts/contracts/${id}/withdraw`, {
      reason: "dọn HĐ thử CR-128",
    }).catch(() => {});
    await sql`delete from hub.process_runs where pack_key = 'contracts' and pack_record_id = ${id}`.catch(
      () => {},
    );
    await sql`delete from contracts.contracts where id = ${id}`.catch((e) =>
      console.warn(`${TAG}: không xoá được HĐ thử ${id}: ${(e as Error).message}`),
    );
  }
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({ options: { "skip-check": { type: "boolean" } } });
  const url = process.env.DATABASE_URL ?? "";
  const bad = flowSeedGuard({
    appEnv: process.env.APP_ENV,
    urls: [url],
    iKnowProd: false,
    isLocal: isLocalDbHost,
  });
  if (bad) fail(bad);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || `http://localhost:${process.env.HUB_PORT || "4000"}`;
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
    (tenants.items as Json[]).find((t) => t.key === TENANT)?.id ??
      fail(`không có công ty ${TENANT}`),
  );
  const c: Ctx = { hub, tid, groups: await groupIds(admin, tid) };
  await ensureFlow(c, CONTRACT_FLOW, contractStages(), { event: "contract.submitted" });
  console.log(`${TAG}: «${CONTRACT_FLOW}» đã áp dụng`);
  await ensureFlow(c, BUY_FLOW, buyStages(), { event: "contract.submitted" });
  console.log(`${TAG}: «${BUY_FLOW}» đã áp dụng`);
  if (v["skip-check"]) return;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await verify(c, authUrl, hubUrl, sql);
  } finally {
    await sql.end();
  }
  console.log(`${TAG} OK`);
}

main().catch((e) => {
  console.error(`${TAG} lỗi: ${(e as Error).message}`);
  process.exit(1);
});
