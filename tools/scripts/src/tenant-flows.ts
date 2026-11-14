// CR-159 · dựng sẵn quy trình cho evolu / nitigroup / preschool (dữ liệu: tenant-flows.data.ts; người: deploy/tenants/<key>.yaml).
// Đi đúng API mà admin nền tảng dùng (admin-api để tra công ty/nhóm/người, hub-api để soạn + áp dụng quy trình). Chạy lại an toàn (xem core).
//   bun --env-file=.env.local tools/scripts/src/tenant-flows.ts [--dry-run] [--tenant evolu|nitigroup|preschool] [--i-know-prod]
// Cần: người đã có ở công ty (chạy tenant-onboard trước), admin-api (AUTH_URL, mặc định :3001) + hub-api (HUB_URL, mặc định :4000),
// SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD (admin nền tảng; không in ra). DB ngoài localhost/test hay APP_ENV=production ⇒ bắt buộc --i-know-prod.
import { parseArgs } from "node:util";
import { seedDbHost } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";
import { applyTenantFlows, type Call, type Json, must, type Res } from "./tenant-flows.core";
import { emailsOf, FLOW_NAMES, flowsFor, TENANT_KEYS, type TenantKey } from "./tenant-flows.data";

const TAG = "tenant-flows";
const fail = (msg: string): never => {
  throw new Error(msg);
};
const env = (k: string): string => process.env[k] || fail(`thiếu ${k}`);

async function login(authUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${authUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_key: "platform", username, password }),
  });
  const j = (await res.json()) as Json;
  if (j.status !== "authenticated") fail(`đăng nhập admin nền tảng → ${res.status}`);
  return String(j.access_token);
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

async function runTenant(admin: Call, hub: Call, key: TenantKey, dryRun: boolean): Promise<void> {
  const tenants = must(await admin("GET", "/admin/tenants?limit=100"), [200], "đọc công ty");
  const tid = (tenants.items as Json[]).find((t) => t.key === key)?.id;
  if (!tid) {
    if (dryRun) return console.log(`${TAG}: ${key} — công ty chưa có (bỏ qua khi dry-run)`);
    fail(`không có công ty ${key} (chạy tenant-onboard trước)`);
  }
  const g = must(await admin("GET", `/admin/groups?tenant_id=${tid}&limit=200`), [200], "đọc nhóm");
  const groups = new Map((g.items as Json[]).map((x) => [String(x.key), String(x.id)]));
  const u = must(await admin("GET", `/admin/users?tenant_id=${tid}&limit=200`), [200], "đọc người");
  const byEmail = new Map<string, string>();
  for (const x of u.items as Json[])
    for (const k of [x.email, x.username])
      if (typeof k === "string") byEmail.set(k.toLowerCase(), String(x.id));
  const miss = emailsOf(key).filter((e) => !byEmail.has(e.toLowerCase()));
  if (miss.length) {
    const msg = `${key}: thiếu người ${miss.join(", ")} (chạy tenant-onboard trước)`;
    if (dryRun) return console.log(`${TAG}: ${msg} (bỏ qua khi dry-run)`);
    fail(msg);
  }
  const defs = flowsFor(key, (e) => byEmail.get(e.toLowerCase()) as string);
  const rep = await applyTenantFlows({ hub, tid: String(tid), groups }, defs, {
    dryRun,
    buyName: FLOW_NAMES.buy,
    sendName: FLOW_NAMES.send,
  });
  for (const r of rep)
    console.log(`${TAG}: ${key} — «${r.name}» ${dryRun ? "sẽ" : "đã"} ${r.action}`);
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      "dry-run": { type: "boolean" },
      tenant: { type: "string" },
      "i-know-prod": { type: "boolean" },
    },
  });
  const keys = v.tenant
    ? [TENANT_KEYS.find((k) => k === v.tenant) ?? fail(`--tenant phải là ${TENANT_KEYS.join("|")}`)]
    : [...TENANT_KEYS];
  const bad = flowSeedGuard({
    appEnv: process.env.APP_ENV,
    urls: [process.env.DATABASE_URL ?? ""],
    iKnowProd: v["i-know-prod"] === true,
    isLocal: seedDbHost(),
  });
  if (bad) fail(bad);
  const authUrl = process.env.AUTH_URL || process.env.ADMIN_API_URL || "http://localhost:3001";
  const hubUrl = process.env.HUB_URL || `http://localhost:${process.env.HUB_PORT || "4000"}`;
  const tok = await login(authUrl, env("SEED_ADMIN_USERNAME"), env("SEED_ADMIN_PASSWORD"));
  const [admin, hub] = [caller(authUrl, tok), caller(hubUrl, tok)];
  for (const k of keys) await runTenant(admin, hub, k, v["dry-run"] === true);
  console.log(`${TAG} OK`);
}

if (import.meta.main)
  main().catch((e) => {
    console.error(`${TAG} lỗi: ${(e as Error).message}`);
    process.exit(1);
  });
