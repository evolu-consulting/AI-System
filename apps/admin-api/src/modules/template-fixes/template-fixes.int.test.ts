// CR-125 · c5b · int (admin-api thật, RLS admin_api): `POST /admin/tenants/:id/template-fixes/{enable-feature,create-group}`.
// Quyền: chỉ platform_admin (tenant_admin ⇒ 403, kể cả công ty của chính mình). Cách ly: chỉ đúng công ty trong đường dẫn đổi, công ty khác
// nguyên trạng. Audit: có dòng grant/create đúng công ty. Hẹp: bật tính năng CHỈ khi mẫu (flow_id) đang thiếu đúng tính năng đó (Hub trả
// readiness — ở đây là Hub giả bằng Bun.serve); tính năng không liên quan ⇒ 422. Dùng đúng service entitlement/group (cùng audit + khoá).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb } from "@ai/db";
import { ADMIN_API_URL, makeHashes } from "../../../../../tests/acceptance/M1/_fixtures";
import { loadApp, loadJwt } from "../../../../../tests/acceptance/M1/_modules";
import { createM4Env, type M4Env, TENANT_ID } from "../../../../../tests/acceptance/M4/_ab";

let env: M4Env;
let hubServer: ReturnType<typeof Bun.serve>;
let missing: string[] = []; // khoá tính năng mà Hub giả báo "mẫu đang thiếu"
let hubApp: { fetch: (r: Request) => Promise<Response> };
let hubDb: ReturnType<typeof createDb>;

beforeAll(async () => {
  env = await createM4Env();
  hubServer = Bun.serve({
    port: 0,
    fetch: () =>
      Response.json({
        ready: missing.length === 0,
        missing: {
          features: missing.map((key) => ({ key, stage: "Bước" })),
          tools: [],
          groups: [],
          order: [],
        },
      }),
  });
  const jwt = await loadJwt();
  const { createApp } = await loadApp();
  hubDb = createDb(ADMIN_API_URL, { max: 2 });
  hubApp = createApp(
    { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
    {
      db: hubDb,
      keys: await jwt.loadJwtKeys(env.keys.env),
      appEnv: "test",
      dummyHash: (await makeHashes()).pw,
      now: env.clock.now,
      hub: { url: `http://localhost:${hubServer.port}`, token: "t" },
      // biome-ignore lint/suspicious/noExplicitAny: cùng cách M1 dựng app trong test
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: cùng cách M1 dựng app trong test
  ) as any;
}, 60_000);
afterAll(async () => {
  hubServer?.stop(true);
  await hubDb?.close();
  await env?.close();
});

const platform = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const A = TENANT_ID.acme;
const B = TENANT_ID.globex;
const fix = (t: string, what: string) => `/admin/tenants/${t}/template-fixes/${what}`;
/** Gọi app CÓ Hub giả bằng token platform. */
async function withHub(path: string, body: unknown) {
  const token = await env.token("platform", "admin");
  const r = await hubApp.fetch(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

describe("c5b · sửa nhanh cho mẫu Thư viện (platform_admin)", () => {
  it("enable-feature: chỉ bật tính năng mẫu đang thiếu; bật cho đúng công ty A (audit grant), B nguyên trạng; chạy lại vô hại", async () => {
    const feats = await env.owner<
      { id: string; key: string }[]
    >`select id::text as id, key from admin.features where key <> 'core' order by key limit 2`;
    const [f, other] = feats;
    if (!f || !other) throw new Error("fixture: cần ≥ 2 feature");
    await env.owner`delete from admin.feature_entitlements where feature_id in (${f.id}::uuid, ${other.id}::uuid) and tenant_id in (${A}, ${B})`;
    const flow = crypto.randomUUID();
    const [{ n: seq0 } = { n: "0" }] = await env.owner<
      { n: string }[]
    >`select coalesce(max(seq), 0)::text as n from admin.audit_log`;
    const has = (feat: string, t: string) =>
      env.owner`select 1 from admin.feature_entitlements where feature_id = ${feat}::uuid and tenant_id = ${t} and revoked_at is null`;

    // Hub báo mẫu thiếu `f`: bật `other` (không liên quan / có phí) ⇒ 422, không ghi gì
    missing = [f.key];
    const bad = await withHub(fix(A, "enable-feature"), { flow_id: flow, feature_key: other.key });
    expect(bad.status).toBe(422);
    expect((await has(other.id, A)).length).toBe(0);

    const r = await withHub(fix(A, "enable-feature"), { flow_id: flow, feature_key: f.key });
    expect(r.status).toBe(200);
    expect((await has(f.id, A)).length).toBe(1);
    expect((await has(f.id, B)).length).toBe(0); // cách ly công ty
    const audit = await env.owner<
      { tenant_id: string; action: string; entity: string }[]
    >`select tenant_id::text, action, entity from admin.audit_log where seq > ${seq0}::bigint and entity = 'entitlement'`;
    expect(audit.map((a) => ({ ...a }))).toEqual([
      { tenant_id: A, action: "grant", entity: "entitlement" },
    ]);

    expect(
      (await withHub(fix(A, "enable-feature"), { flow_id: flow, feature_key: f.key })).status,
    ).toBe(200);
    // mẫu không thiếu gì (đã dùng được) ⇒ không bật được gì
    missing = [];
    expect(
      (await withHub(fix(A, "enable-feature"), { flow_id: flow, feature_key: f.key })).status,
    ).toBe(422);
    // thiếu flow_id ⇒ 400; không cấu hình Hub ⇒ 503 (không bật mù)
    expect((await withHub(fix(A, "enable-feature"), { feature_key: f.key })).status).toBe(400);
    expect(
      (await platform("POST", fix(A, "enable-feature"), { flow_id: flow, feature_key: f.key }))
        .status,
    ).toBe(503);
  });

  it("create-group: tạo nhóm gợi ý ở đúng công ty A (audit create), trùng mã 409, mã sai 400, B không có", async () => {
    const key = "nhom-goi-y-c5b";
    await env.owner`delete from admin.groups where key = ${key}`;
    const r = await platform("POST", fix(A, "create-group"), { group_key: key });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ key, tenant_id: A, name: { vi: "Nhom goi y c5b" } });
    const rows = await env.owner<
      { tenant_id: string }[]
    >`select tenant_id::text from admin.groups where key = ${key}`;
    expect(rows.map((x) => ({ ...x }))).toEqual([{ tenant_id: A }]);
    expect((await platform("POST", fix(A, "create-group"), { group_key: key })).status).toBe(409);
    expect(
      (await platform("POST", fix(A, "create-group"), { group_key: "Sai Dạng!" })).status,
    ).toBe(400);
    const [a] = await env.owner<
      { n: number }[]
    >`select count(*)::int as n from admin.audit_log where entity = 'group' and action = 'create' and entity_name = ${key} and tenant_id = ${A}`;
    expect(a?.n).toBe(1);
  });

  it("vai khác platform_admin (tenant_admin, kể cả công ty của mình) ⇒ bị từ chối, không đổi dữ liệu", async () => {
    const tadmin = env.by("acme", "binh");
    const [before] = await env.owner<{ n: number }[]>`select count(*)::int as n from admin.groups`;
    expect((await tadmin("POST", fix(A, "create-group"), { group_key: "tu-y-tao" })).status).toBe(
      403,
    );
    // công ty khác: từ chối (403) hoặc không lộ tồn tại (404) — đều không được ghi
    expect([403, 404]).toContain(
      (await tadmin("POST", fix(B, "create-group"), { group_key: "tu-y-tao" })).status,
    );
    expect(
      (
        await tadmin("POST", fix(A, "enable-feature"), {
          flow_id: crypto.randomUUID(),
          feature_key: "x",
        })
      ).status,
    ).toBe(403);
    const [after] = await env.owner<{ n: number }[]>`select count(*)::int as n from admin.groups`;
    expect(after?.n).toBe(before?.n);
  });
});
