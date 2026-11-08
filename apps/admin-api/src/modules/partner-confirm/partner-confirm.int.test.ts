// CR-125 · UX-S7 (H7) · int (admin-api thật, RLS admin_api): `GET|PUT /admin/tenants/:id/partner-confirm`.
// GET = danh sách điều kiện (admin-api đọc hồ sơ + entitlement, Hub giả bằng Bun.serve trả kênh/flow/nhóm), PUT {on} = bật/tắt tính năng.
// Quyền: PUT CHỈ platform_admin — quản trị công ty (kể cả công ty của mình) ⇒ 403, không cấp được, không audit; GET quản trị chỉ công ty mình (khác ⇒ 404).
// Bật/tắt đi đúng service entitlement (audit grant/revoke, đúng công ty); công ty khác nguyên trạng. Hub không trả lời ⇒ mục Hub "chưa rõ".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb } from "@ai/db";
import { ADMIN_API_URL, makeHashes } from "../../../../../tests/acceptance/M1/_fixtures";
import { loadApp, loadJwt } from "../../../../../tests/acceptance/M1/_modules";
import { createM4Env, type M4Env, TENANT_ID } from "../../../../../tests/acceptance/M4/_ab";

// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;
let env: M4Env;
let hubServer: ReturnType<typeof Bun.serve>;
let hubDown = false;
let app: { fetch: (r: Request) => Promise<Response> };
let appNoHub: { fetch: (r: Request) => Promise<Response> };
const dbs: ReturnType<typeof createDb>[] = [];

const HUB_PART = {
  channel: true,
  receive_template_id: "0c124000-0000-4000-8000-0000000000c2",
  receive_flow: false,
  send_flow: false,
  groups: [{ key: "phong-kinh-doanh", exists: false, members: 0 }],
};

async function build(hubUrl: string | undefined) {
  const jwt = await loadJwt();
  const { createApp } = await loadApp();
  const db = createDb(ADMIN_API_URL, { max: 2 });
  dbs.push(db);
  return createApp(
    { version: "0.0.0", corsOrigins: ["http://localhost:3000"] },
    {
      db,
      keys: await jwt.loadJwtKeys(env.keys.env),
      appEnv: "test",
      dummyHash: (await makeHashes()).pw,
      now: env.clock.now,
      hubUrl,
      // biome-ignore lint/suspicious/noExplicitAny: cùng cách M1 dựng app trong test
    } as any,
    // biome-ignore lint/suspicious/noExplicitAny: cùng cách M1 dựng app trong test
  ) as any;
}

beforeAll(async () => {
  env = await createM4Env();
  hubServer = Bun.serve({
    port: 0,
    fetch: () => (hubDown ? new Response("x", { status: 503 }) : Response.json(HUB_PART)),
  });
  app = await build(`http://localhost:${hubServer.port}`);
  appNoHub = await build(undefined);
}, 60_000);
afterAll(async () => {
  hubServer?.stop(true);
  for (const d of dbs) await d.close();
  await env?.close();
});

const A = TENANT_ID.acme;
const B = TENANT_ID.globex;
const path = (t: string) => `/admin/tenants/${t}/partner-confirm`;
async function call(
  who: [string, string],
  method: string,
  p: string,
  ...[body, target = app]: [body?: unknown, target?: typeof app]
) {
  const token = await env.token(...who);
  const r = await target.fetch(
    new Request(`http://localhost${p}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Json };
}
const platform: [string, string] = ["platform", "admin"];
const tadmin: [string, string] = ["acme", "binh"];
const granted = async (t: string) =>
  (
    await env.owner`select 1 from admin.feature_entitlements en join admin.features f on f.id = en.feature_id
      where f.key = 'contracts-partner-confirm' and en.tenant_id = ${t} and en.revoked_at is null`
  ).length;
const item = (j: Json, k: string) =>
  (j.items as { key: string; state: string; who: string; fix?: string }[]).find((i) => i.key === k);

describe("UX-S7 · Đối tác xác nhận hợp đồng (admin-api)", () => {
  it("platform bật/tắt qua đúng service entitlement: danh sách đổi theo, audit grant/revoke đúng công ty, công ty khác nguyên trạng", async () => {
    await env.owner`delete from admin.feature_entitlements where tenant_id in (${A}, ${B})
      and feature_id in (select id from admin.features where key = 'contracts-partner-confirm')`;
    const [{ n: seq0 } = { n: "0" }] = await env.owner<
      { n: string }[]
    >`select coalesce(max(seq), 0)::text as n from admin.audit_log`;

    const off = await call(platform, "GET", path(A));
    expect(off.status).toBe(200);
    expect(off.json.on).toBe(false);
    expect(item(off.json, "feature")).toMatchObject({
      state: "todo",
      who: "platform",
      fix: "grant-feature",
    });
    expect(item(off.json, "channel")?.state).toBe("ok"); // phần Hub gộp vào
    expect(item(off.json, "receive_flow")).toMatchObject({
      state: "todo",
      fix: "assign-receive-flow",
    });

    const on = await call(platform, "PUT", path(A), { on: true });
    expect(on.status).toBe(200);
    expect(on.json.on).toBe(true);
    expect(item(on.json, "feature")?.state).toBe("ok");
    expect(await granted(A)).toBe(1);
    expect(await granted(B)).toBe(0);
    expect((await call(platform, "PUT", path(A), { on: true })).status).toBe(200); // chạy lại vô hại

    const off2 = await call(platform, "PUT", path(A), { on: false });
    expect(off2.json.on).toBe(false);
    expect(await granted(A)).toBe(0);
    const audit = await env.owner<
      { tenant_id: string; action: string }[]
    >`select tenant_id::text, action from admin.audit_log where seq > ${seq0}::bigint and entity = 'entitlement' order by seq`;
    expect(audit.map((a) => ({ ...a }))).toEqual([
      { tenant_id: A, action: "grant" },
      { tenant_id: A, action: "revoke" },
    ]);
  });
});

describe("UX-S7 · Đối tác xác nhận hợp đồng (admin-api)", () => {
  it("quản trị công ty KHÔNG cấp được: PUT ⇒ 403 (kể cả công ty của mình), không entitlement, không audit, công ty khác cũng không", async () => {
    await env.owner`delete from admin.feature_entitlements where tenant_id in (${A}, ${B})
      and feature_id in (select id from admin.features where key = 'contracts-partner-confirm')`;
    const [{ n: seq0 } = { n: "0" }] = await env.owner<
      { n: string }[]
    >`select coalesce(max(seq), 0)::text as n from admin.audit_log`;
    expect((await call(tadmin, "PUT", path(A), { on: true })).status).toBe(403);
    expect([403, 404]).toContain((await call(tadmin, "PUT", path(B), { on: true })).status);
    expect(await granted(A)).toBe(0);
    expect(await granted(B)).toBe(0);
    const [n] = await env.owner<
      { n: number }[]
    >`select count(*)::int as n from admin.audit_log where seq > ${seq0}::bigint and entity = 'entitlement'`;
    expect(n?.n).toBe(0);
    expect((await call(platform, "PUT", path(A), { on: "yes" })).status).toBe(400);
  });
  it("quản trị công ty XEM được công ty mình (GET 200), công ty khác ⇒ 404", async () => {
    const own = await call(tadmin, "GET", path(A));
    expect(own).toMatchObject({ status: 200 });
    expect((await call(tadmin, "GET", path(B))).status).toBe(404);
  });
  it("Hub không trả lời / không cấu hình ⇒ vẫn 200, mục của Hub 'chưa rõ', chưa sẵn sàng", async () => {
    hubDown = true;
    const a = await call(platform, "GET", path(A));
    hubDown = false;
    const b = await call(platform, "GET", path(A), undefined, appNoHub);
    for (const r of [a, b]) {
      expect(r.status).toBe(200);
      expect(item(r.json, "channel")?.state).toBe("unknown");
      expect(item(r.json, "send_flow")?.state).toBe("unknown");
      expect(r.json.ready_to_receive).toBe(false);
    }
  });
});
