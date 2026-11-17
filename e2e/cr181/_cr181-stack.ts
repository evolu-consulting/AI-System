// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-181 · e2e ký trên tài liệu · DỰNG CẤU HÌNH CÔNG TY, chạy MỘT lần sau `_ja-stack.ts` (backend thật + công ty `e2e-<khoá>-<hậu tố>` đã có). Mọi thứ đi ĐƯỜNG THẬT (API):
//   · nhóm «Trưởng phòng duyệt» (e2e-kd-truong) + «Người ký hợp đồng» (giám đốc) → quy trình công ty từ sơ đồ trống: Trưởng phòng duyệt (bằng chứng ý kiến + chữ ký)
//     → Ký `ondoc` (người ký công ty = nhóm giám đốc) → Hoàn tất; áp dụng như «Áp dụng cho công ty»;
//   · `PUT /company/signature-settings` bật `on_doc_enabled` (cách tạo: gõ họ tên — spec không cần vẽ);
//   · công ty `presign` có sẵn chữ ký cho sale/trưởng phòng/giám đốc (các spec không đi qua màn tạo); công ty `journey` thì KHÔNG (sale tạo ở lần đăng nhập đầu).
// Sale (e2e-kd-nv, người tạo) ≠ trưởng phòng (e2e-kd-truong) ≠ giám đốc (e2e-giamdoc) ≠ kế toán (e2e-ketoan, người chỉ xem). Xong ⇒ mở cổng "sẵn sàng" `CR181_READY_PORT`.
import { createRequire } from "node:module";
import { SIGNATURE_SETTINGS_DEFAULT } from "../../packages/contracts/src/signature";
import { apiLogin, createGroupWith, type Session, tenantIdByKey } from "../_kit/api";
import { approve, enableFlowTriggers, esignNode, finish } from "../_kit/flows";
import { API, envOf, HUB, PW, SPEC_TENANT, U } from "../cr127/_cr127-kit";

const READY = Number(process.env.CR181_READY_PORT);
type Json = Record<string, unknown>;
const log = (s: string): void => console.log(`[cr181] ${s}`);
export const CR181 = {
  headGroup: "cr181-truong-phong",
  signGroup: "cr181-nguoi-ky",
  head: "e2e-kd-truong",
  /** Công ty chạy hành trình 3 vai: KHÔNG có chữ ký sẵn. */
  journey: "q5",
} as const;

const hubRequire = createRequire(new URL("../../apps/hub-api/package.json", import.meta.url));
const { createCanvas } = hubRequire("@napi-rs/canvas") as typeof import("@napi-rs/canvas");
/** PNG nét đen nền trong suốt (như chữ ký «Gõ họ tên»), base64 thuần. */
const signaturePng = (): string => {
  const c = createCanvas(240, 100);
  const g = c.getContext("2d");
  g.font = "48px sans-serif";
  g.fillStyle = "#000";
  g.fillText("E2E", 20, 65);
  return c.toBuffer("image/png").toString("base64");
};

const adminOf = (key: string): Promise<Session> =>
  apiLogin({ base: API, tenantKey: envOf(key).tenantKey, username: U.director, password: PW });
const hubAs = (key: string, user: string): Promise<Session> =>
  apiLogin({
    base: API,
    tenantKey: envOf(key).tenantKey,
    username: user,
    password: PW,
    app: "contracts",
  });

async function hubCall(s: Session, method: string, url: string, body?: unknown): Promise<Json> {
  const r = await fetch(`${HUB}${url}`, {
    method,
    headers: { ...s.headers, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (r.status >= 300) throw new Error(`${method} ${url} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as Json) : {};
}

async function platform(): Promise<Session> {
  const e = envOf("x");
  return apiLogin({ base: API, tenantKey: "platform", username: e.adminUser, password: e.adminPw });
}

/** Quy trình công ty từ SƠ ĐỒ TRỐNG: tạo → thay danh sách bước → áp dụng (như `_cr127-stack.ts`). */
async function companyFlow(p: Session, tid: string, name: string, stages: Json[]): Promise<void> {
  const call = (m: string, u: string, b?: unknown) =>
    hubCall({ ...p, headers: { ...p.headers } }, m, u, b);
  const made = await call("POST", `/tenants/${tid}/company-flows`, {
    name,
    app: "contracts",
    from: "blank",
  });
  const flowId = String(made.flow_id);
  const q = `?tenant_id=${tid}`;
  const def = (await call("GET", `/process-defs/${flowId}${q}`)) as Json & { version: number };
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
    inputs: [{ key: "contract_id", label: "Hợp đồng", type: "text", required: true }],
    stages,
    trigger: { event: "contract.submitted" },
    app: "contracts",
    version: def.version,
  });
  await call("POST", `/tenants/${tid}/company-flows/apply`, { flow_id: flowId });
}

async function signCompany(p: Session, key: string, presign: boolean): Promise<void> {
  const e = envOf(key);
  const tid = await tenantIdByKey(API, p, e.tenantKey);
  const adm = await adminOf(key);
  await createGroupWith(API, adm, {
    key: CR181.headGroup,
    name: "Trưởng phòng duyệt",
    usernames: [CR181.head],
  });
  const signId = await createGroupWith(API, adm, {
    key: CR181.signGroup,
    name: "Người ký hợp đồng",
    usernames: [U.director],
  });
  await enableFlowTriggers(e.tenantKey);
  // quản trị công ty (giám đốc) bật ký trên tài liệu; chỉ cách «Gõ họ tên»
  await hubCall(await hubAs(key, U.director), "PUT", "/company/signature-settings", {
    ...SIGNATURE_SETTINGS_DEFAULT,
    methods: ["type"],
    on_doc_enabled: true,
  });
  const head = approve("truong-phong", "Trưởng phòng duyệt", 0, CR181.headGroup, {
    reject: 4,
    ret: 5,
    next: 1,
  });
  head.after = { ...(head.after as object), need: "one", evidence: "opinion_plus" };
  const [send, wait] = esignNode(1).map((s, i) =>
    i === 0
      ? {
          ...s,
          executor: {
            ...(s.executor as object),
            args: {
              contract_id: { from: "input", key: "contract_id" },
              provider: { from: "const", value: "ondoc" },
              company_signers: { from: "const", value: `group:${signId}` },
            },
          },
        }
      : s,
  );
  await companyFlow(p, tid, `Duyệt và ký trên tài liệu ${key}`, [
    head,
    { ...send, name: "Ký hợp đồng" } as Json,
    wait as Json,
    finish("xong", "Đã ký", 3, "approved"),
    finish("tu-choi", "Từ chối", 4, "rejected"),
    finish("tra-lai", "Trả lại", 5, "returned"),
  ]);
  if (presign)
    for (const u of [U.employee, CR181.head, U.director])
      await hubCall(await hubAs(key, u), "POST", "/me/signature", {
        kind: "main",
        method: "type",
        png: signaturePng(),
      });
  log(`${key}: quy trình ký trên tài liệu đã áp dụng (presign=${presign})`);
}

async function main(): Promise<void> {
  const p = await platform();
  await signCompany(p, SPEC_TENANT.j01, true); // contract-page-sign, sign-prep-and-sign, signed-viewer
  await signCompany(p, CR181.journey, false); // journey-3-vai
  // first-login (s2) và signature-settings (s3): công ty để nguyên, spec tự cấu hình
  Bun.serve({ port: READY, fetch: () => new Response("ok") });
  log(`sẵn sàng :${READY}`);
}

await main();
