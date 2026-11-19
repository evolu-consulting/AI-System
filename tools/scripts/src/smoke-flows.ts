// CR-159 · bài kiểm hành trình (deploy/smoke/smoke-journey.ps1): dựng quy trình «Duyệt hợp đồng gửi đi» + «Nhận hợp đồng từ đối tác» cho 2 công ty TẠM
// smoke-a / smoke-b (yaml ở deploy/smoke/tenants) bằng ĐÚNG bộ của preschool (`flowsFor`, cùng hình 1 gốc + 1 phòng; người phụ trách nhận HĐ = giám đốc).
// Chỉ nhận khoá smoke-a|smoke-b (chốt chặn cứng: không bao giờ đụng evolu/nitigroup/preschool). Không in mật khẩu.
//   bun --env-file=... tools/scripts/src/smoke-flows.ts actor            # in uuid platform admin (cho --actor của tenant-onboard)
//   bun --env-file=... tools/scripts/src/smoke-flows.ts flows smoke-a    # đọc người từ admin-api rồi áp dụng quy trình
//   bun --env-file=... tools/scripts/src/smoke-flows.ts directory smoke-a # in «DIRECTORY smoke-a on|off» (mặc định của công ty mới) rồi bật Danh bạ như quản trị công ty (cần SMOKE_PW)
// Cần: SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD, AUTH_URL (admin-api), HUB_URL (hub-api).
import { join } from "node:path";
import { applyTenantFlows, type Call, type Json, must, type Res } from "./tenant-flows.core";
import { flowsFor, WHO } from "./tenant-flows.data";
import { readOrg } from "./tenant-flows.org";

const fail = (m: string): never => {
  throw new Error(m);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k}`);
const SMOKE_KEY = /^smoke-[ab]$/;

async function login(base: string): Promise<{ token: string; sub: string }> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_key: "platform",
      username: env("SEED_ADMIN_USERNAME"),
      password: env("SEED_ADMIN_PASSWORD"),
    }),
  });
  const j = (await res.json()) as Json;
  if (j.status !== "authenticated") fail(`đăng nhập admin nền tảng → ${res.status}`);
  const token = String(j.access_token);
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
  return { token, sub: String(payload.sub) };
}
const caller =
  (base: string, token: string): Call =>
  async (method, path, body): Promise<Res> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as Json };
  };

async function flows(key: string, authUrl: string, hubUrl: string, token: string): Promise<void> {
  if (!SMOKE_KEY.test(key)) fail(`chỉ nhận smoke-a|smoke-b, không nhận «${key}»`);
  const [admin, hub] = [caller(authUrl, token), caller(hubUrl, token)];
  const tenants = must(await admin("GET", "/admin/tenants?limit=100"), [200], "đọc công ty");
  const tid = (tenants.items as Json[]).find((t) => t.key === key)?.id;
  if (!tid) fail(`không có công ty ${key} (chạy tenant-onboard trước)`);
  const g = must(await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`), [200], "đọc nhóm");
  const groups = new Map((g.items as Json[]).map((x) => [String(x.key), String(x.id)]));
  const u = must(await admin("GET", `/admin/users?tenant_id=${tid}&limit=200`), [200], "đọc người");
  const byEmail = new Map<string, string>();
  for (const x of u.items as Json[])
    for (const k of [x.email, x.username])
      if (typeof k === "string") byEmail.set(k.toLowerCase(), String(x.id));
  const org = readOrg(key, join(import.meta.dir, "../../../deploy/smoke/tenants"));
  const gd = byEmail.get(String(org.rootHead)) ?? fail(`thiếu giám đốc ${org.rootHead}`);
  // «preschool» = công ty có người phụ trách là cấp cao nhất: ánh xạ email của preschool sang giám đốc của công ty tạm.
  const uid = (e: string): string =>
    e === WHO.preschool.dung ? gd : (byEmail.get(e.toLowerCase()) ?? fail(`thiếu người ${e}`));
  const defs = flowsFor("preschool", uid, org);
  const rep = await applyTenantFlows({ hub, tid: String(tid), groups }, defs, { dryRun: false });
  for (const r of rep) console.log(`smoke-flows: ${key} — «${r.name}» đã ${r.action}`);
}

/** Danh bạ công ty mặc định (công ty mới tạo) rồi bật như quản trị công ty làm tay (PUT /pack/contracts/connect/listing, CR-191) để hành trình đi tiếp. */
async function directory(
  key: string,
  authUrl: string,
  hubUrl: string,
  token: string,
): Promise<void> {
  if (!SMOKE_KEY.test(key)) fail(`chỉ nhận smoke-a|smoke-b, không nhận «${key}»`);
  const admin = caller(authUrl, token);
  const tenants = must(await admin("GET", "/admin/tenants?limit=100"), [200], "đọc công ty");
  const tid = String(
    (tenants.items as Json[]).find((t) => t.key === key)?.id ?? fail(`không có ${key}`),
  );
  const prof = must(await admin("GET", `/admin/tenants/${tid}/profile`), [200], "đọc hồ sơ");
  console.log(`DIRECTORY ${key} ${prof.directory_listed === true ? "on" : "off"}`);
  const res = await fetch(`${authUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App": "contracts" },
    body: JSON.stringify({ tenant_key: key, username: `${key}-gd`, password: env("SMOKE_PW") }),
  });
  const j = (await res.json()) as Json;
  if (j.status !== "authenticated") fail(`đăng nhập ${key}-gd → ${res.status}`);
  must(
    await caller(hubUrl, String(j.access_token))("PUT", "/pack/contracts/connect/listing", {
      listed: true,
    }),
    [200],
    "bật Danh bạ",
  );
}

async function main(): Promise<void> {
  const [cmd, key] = process.argv.slice(2);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || `http://localhost:${process.env.HUB_PORT || "4000"}`;
  const { token, sub } = await login(authUrl);
  if (cmd === "actor") return console.log(sub);
  if (cmd === "flows") return flows(key ?? "", authUrl, hubUrl, token);
  if (cmd === "directory") return directory(key ?? "", authUrl, hubUrl, token);
  fail("dùng: actor | flows | directory smoke-a|smoke-b");
}
if (import.meta.main)
  main().catch((e) => {
    console.error(`smoke-flows lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
