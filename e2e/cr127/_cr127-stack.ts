// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-127 · e2e hành trình · DỰNG CẤU HÌNH CÔNG TY cho các spec, chạy MỘT lần sau `_ja-stack.ts` (backend thật + công ty `e2e-<khoá>-<hậu tố>` đã có,
// chưa gán gì). Mọi thứ đi ĐƯỜNG PLATFORM/KHÁCH làm (API, D5): hồ sơ công ty + tính năng `contracts-partner-confirm` (entitlement) + «cho phép tìm thấy»,
// nhóm, và QUY TRÌNH CÔNG TY tạo từ SƠ ĐỒ TRỐNG (CR-127: không còn mẫu `hd-*`, không tự gán mặc định): admin nền tảng gọi
// `POST /tenants/:id/company-flows {from:"blank"}` → `PUT /process-defs/:id?tenant_id` (thêm bước) → `POST …/company-flows/apply` (như «Áp dụng cho công ty»).
// Chỉ phần đường sản phẩm chưa làm bằng API (bật FLOW_TRIGGERS, dòng đối tác trong sổ) dùng `_kit` (SQL owner của DB test) như `cr124-q6`.
// Dữ liệu HĐ do chính spec tạo bằng UI. j01 (soạn bằng UI) và j14 (chưa có quy trình) KHÔNG được dựng quy trình ở đây. Xong ⇒ mở cổng "sẵn sàng" `CR127_READY_PORT`.
import {
  apiLogin,
  createGroupWith,
  featureIdByKey,
  grantFeature,
  type Session,
  setCompanyProfile,
  setDirectoryListed,
  tenantIdByKey,
} from "../_kit/api";
import { approve, enableFlowTriggers, finish, partnerSendNode } from "../_kit/flows";
import { seedPartner } from "../journey-approval/_partner-pick";
import { API, envOf, GROUP, HUB, PW, SFX, SPEC_TENANT, TAX, U } from "./_cr127-kit";

const READY = Number(process.env.CR127_READY_PORT);
type Pair = readonly [keyof typeof TAX, keyof typeof TAX];
type Json = Record<string, unknown>;
const log = (s: string): void => console.log(`[cr127] ${s}`);

async function platform(): Promise<Session> {
  const e = envOf("x");
  return apiLogin({ base: API, tenantKey: "platform", username: e.adminUser, password: e.adminPw });
}
const adminOf = (key: string): Promise<Session> =>
  apiLogin({ base: API, tenantKey: envOf(key).tenantKey, username: U.director, password: PW });

const CONTRACT_INPUT = [{ key: "contract_id", label: "Hợp đồng", type: "text", required: true }];

/** Quy trình công ty từ SƠ ĐỒ TRỐNG: tạo (Nháp) → thay danh sách bước + «Bắt đầu khi» → áp dụng. Trả id quy trình. */
async function companyFlow(
  p: Session,
  tid: string,
  o: { name: string; stages: Json[]; event?: string; inputs?: Json[] },
): Promise<string> {
  const h = { authorization: `Bearer ${p.token}`, "content-type": "application/json" };
  const call = async (method: string, url: string, body?: unknown): Promise<Json> => {
    const r = await fetch(`${HUB}${url}`, {
      method,
      headers: h,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 300)}`);
    return text ? (JSON.parse(text) as Json) : {};
  };
  const made = await call("POST", `/tenants/${tid}/company-flows`, {
    name: o.name,
    app: "contracts",
    from: "blank",
  });
  const flowId = String(made.flow_id);
  const q = `?tenant_id=${tid}`;
  const def = (await call("GET", `/process-defs/${flowId}${q}`)) as Json & {
    version: number;
    trigger?: { event?: string };
  };
  const keep: Json = {};
  for (const k of [
    "key",
    "name",
    "description",
    "input_hint",
    "run_group_ids",
    "token_budget",
    "enabled",
    "sources",
    "ttl_days",
  ])
    if (def[k] !== undefined) keep[k] = def[k];
  await call("PUT", `/process-defs/${flowId}${q}`, {
    ...keep,
    inputs: o.inputs ?? [],
    stages: o.stages,
    trigger: { event: o.event ?? def.trigger?.event ?? "contract.submitted" },
    app: "contracts",
    version: def.version,
  });
  await call("POST", `/tenants/${tid}/company-flows/apply`, { flow_id: flowId });
  return flowId;
}

/**
 * Công ty có quy trình duyệt một bước, tạo từ sơ đồ trống + áp dụng. `one`/`all`: nhóm Kế toán gồm A = trưởng phòng Kế toán, B = trưởng phòng Kinh doanh.
 * `head`: bước giao cho TRƯỞNG PHÒNG Kế toán (A, `head_only`) — việc đích danh nên áp được uỷ quyền (việc nhóm `one` thì không, spec §5.2).
 */
async function approvalCompany(
  p: Session,
  key: string,
  need: "one" | "all" | "head",
): Promise<void> {
  const e = envOf(key);
  const id = await tenantIdByKey(API, p, e.tenantKey);
  await createGroupWith(API, await adminOf(key), {
    key: GROUP.accounting,
    name: "Kế toán",
    usernames: [U.accounting, "e2e-kd-truong"],
  });
  await enableFlowTriggers(e.tenantKey);
  const step = approve(
    "ke-toan",
    "Kế toán duyệt",
    0,
    need === "head" ? "pb-ke-toan" : GROUP.accounting,
    {
      reject: 2,
      ret: 3,
    },
  ) as Record<string, unknown>;
  step.after = {
    ...(step.after as object),
    need,
    ...(need === "head" ? { head_only: true } : {}),
    // «Cần tất cả»: mỗi người duyệt phải ghi ý kiến (E4 · `after.evidence`) — j11 kiểm ô «Ghi ý kiến» khi bấm Duyệt
    ...(need === "all" ? { evidence: "opinion" } : {}),
  };
  await companyFlow(p, id, {
    name: `Duyệt hợp đồng (${need === "all" ? "cần tất cả" : need === "head" ? "trưởng phòng" : "một người"}) ${key}`,
    inputs: CONTRACT_INPUT,
    stages: [
      step,
      finish("xong", "Hoàn tất", 1, "approved"),
      finish("tu-choi", "Từ chối", 2, "rejected"),
      finish("tra-lai", "Trả lại", 3, "returned"),
    ],
  });
  log(`${key}: quy trình duyệt (${need}) đã áp dụng`);
}

/** Công ty có MỘT bước «Giám đốc duyệt» (nhóm Ban Giám đốc `pb-giam-doc`, `e2e-giamdoc` duyệt) ⇒ HĐ đi hết đường duyệt tới DONE (j04/j05/j06/j10). */
async function directorCompany(p: Session, key: string): Promise<void> {
  const e = envOf(key);
  const id = await tenantIdByKey(API, p, e.tenantKey);
  await enableFlowTriggers(e.tenantKey);
  await companyFlow(p, id, {
    name: `Giám đốc duyệt ${key}`,
    inputs: CONTRACT_INPUT,
    stages: [
      approve("giam-doc", "Giám đốc duyệt", 0, "pb-giam-doc", { reject: 2, ret: 3 }),
      finish("xong", "Hoàn tất", 1, "approved"),
      finish("tu-choi", "Từ chối", 2, "rejected"),
      finish("tra-lai", "Trả lại", 3, "returned"),
    ],
  });
  log(`${key}: quy trình Giám đốc duyệt đã áp dụng`);
}

/** Cặp liên công ty A → B (như `cr124-q6`): hồ sơ + tính năng + tìm thấy; A có quy trình Duyệt → Gửi đối tác; B có quy trình nhận khi `recv`. */
async function partnerPair(
  p: Session,
  [a, b]: Pair,
  o: { recv: boolean; sign: boolean },
): Promise<void> {
  const [ea, eb] = [envOf(a), envOf(b)];
  const [idA, idB] = [
    await tenantIdByKey(API, p, ea.tenantKey),
    await tenantIdByKey(API, p, eb.tenantKey),
  ];
  await setCompanyProfile(API, p, idA, {
    legal_name: `Công ty Gửi ${a} ${SFX}`,
    tax_code: TAX[a],
    address: "1 Phố Gửi, Hà Nội",
  });
  await setCompanyProfile(API, p, idB, {
    legal_name: `Công ty Nhận ${b} ${SFX}`,
    tax_code: TAX[b],
    address: "2 Phố Nhận, Hà Nội",
  });
  const fid = await featureIdByKey(API, p, "contracts-partner-confirm");
  await grantFeature(API, p, fid, idA);
  await grantFeature(API, p, fid, idB);
  const bAdmin = await adminOf(b);
  await setDirectoryListed(API, bAdmin, idB, true);
  const members = [U.director, U.accounting];
  for (const [key, name] of [
    ["phong-kinh-doanh", "Phòng Kinh doanh"],
    ["ke-toan", "Kế toán"],
    ["giam-doc", "Giám đốc"],
  ] as const)
    await createGroupWith(API, bAdmin, { key, name, usernames: members });
  if (o.sign) {
    const signers = await createGroupWith(API, bAdmin, {
      key: GROUP.signers,
      name: "Người ký HĐ",
      usernames: members,
    });
    const url = `${HUB}/pack/contracts/partner/settings`;
    const bContracts = await apiLogin({
      base: API,
      tenantKey: eb.tenantKey,
      username: U.director,
      password: PW,
      app: "contracts",
    });
    const cur = (await (await fetch(url, { headers: bContracts.headers })).json()) as Record<
      string,
      unknown
    >;
    const put = await fetch(url, {
      method: "PUT",
      headers: { ...bContracts.headers, "content-type": "application/json" },
      body: JSON.stringify({ ...cur, signer_group_id: signers }),
    });
    if (put.status >= 300)
      throw new Error(`đặt nhóm Người ký HĐ: ${put.status} ${(await put.text()).slice(0, 200)}`);
  }
  if (o.recv) {
    await enableFlowTriggers(eb.tenantKey);
    await companyFlow(p, idB, {
      name: `Nhận HĐ đối tác ${b}`,
      event: "contract.received",
      stages: [
        approve("nhan", "Giám đốc nhận duyệt", 0, "pb-giam-doc", { reject: 2, ret: 3 }),
        finish("dong-y", "Đồng ý", 1, "confirmed"),
        finish("tu-choi", "Từ chối", 2, "declined"),
        finish("tra-lai", "Trả lại", 3, "returned"),
      ],
    });
  }
  await seedPartner(ea.tenantKey, TAX[b], `Công ty Nhận ${b} ${SFX}`, "e2e-ketoan"); // G3: kế toán thêm đối tác (người chọn = giám đốc)
  await enableFlowTriggers(ea.tenantKey);
  await companyFlow(p, idA, {
    name: `Gửi đối tác ${a} ${SFX}`,
    inputs: CONTRACT_INPUT,
    stages: [
      approve("giam-doc", "Giám đốc duyệt", 0, "pb-giam-doc", { reject: 5, ret: 6 }),
      ...partnerSendNode(
        1,
        {
          assignee_group: "pb-giam-doc",
          send_fields: "total_value",
          reply_days: 7,
          message: "Xin quý công ty xác nhận hợp đồng",
          ...(o.sign ? { sign_together: true, sign_reason: "Cần ký gấp trong tuần" } : {}),
        },
        { returned: 6, declined: 5, expired: 5 },
      ),
      finish("da-xac-nhan", "Đã xác nhận", 4, "approved"),
      finish("tu-choi", "Đối tác từ chối", 5, "rejected"),
      finish("tra-lai", "Trả lại sửa", 6, "returned"),
    ],
  });
  log(`${a} → ${b}: liên kết đối tác dựng xong (nhận=${o.recv}, ký cùng lúc=${o.sign})`);
}

/** Bật Ký số cho công ty (như «Cài đặt › Quy trình duyệt»): quản trị công ty gọi `PUT /pack/contracts/esign/settings`. Chưa bật ⇒ bước Ký số không chọn được người ký, không lưu được. */
async function enableEsign(key: string): Promise<void> {
  const e = envOf(key);
  const s = await apiLogin({
    base: API,
    tenantKey: e.tenantKey,
    username: U.director,
    password: PW,
    app: "contracts",
  });
  const r = await fetch(`${HUB}/pack/contracts/esign/settings`, {
    method: "PUT",
    headers: { ...s.headers, "content-type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  if (r.status >= 300)
    throw new Error(`bật ký số ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

async function main(): Promise<void> {
  const p = await platform();
  await approvalCompany(p, SPEC_TENANT.j03, "head");
  await approvalCompany(p, SPEC_TENANT.j11, "one");
  await approvalCompany(p, SPEC_TENANT.j11All, "all");
  for (const k of [SPEC_TENANT.j04, SPEC_TENANT.j05, SPEC_TENANT.j06, SPEC_TENANT.j10])
    await directorCompany(p, k);
  // j01 (soạn bằng UI) và j14 (chưa có quy trình): chỉ bật cờ chạy theo sự kiện, KHÔNG tạo/gán quy trình
  await enableFlowTriggers(envOf(SPEC_TENANT.j01).tenantKey);
  await enableEsign(SPEC_TENANT.j01);
  await enableFlowTriggers(envOf(SPEC_TENANT.j14).tenantKey);
  await partnerPair(p, SPEC_TENANT.j07, { recv: true, sign: false });
  await partnerPair(p, SPEC_TENANT.j08, { recv: true, sign: true });
  await partnerPair(p, SPEC_TENANT.j13, { recv: false, sign: false });
  Bun.serve({ port: READY, fetch: () => new Response("ok") });
  log(`sẵn sàng :${READY}`);
}

await main();
