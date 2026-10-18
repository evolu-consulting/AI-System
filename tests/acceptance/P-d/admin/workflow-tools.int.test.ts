// AC-A15 · ADM-FR-73 · TT-R01…R03 · test-plan-d2 §3.4 PD2-I40…I47 (I47: T15b) (plan-contract §6, plan-d2 §6): công tắc tool theo tenant qua
// admin-api THẬT (harness M4: RLS admin_api, audit, NOTIFY). Chưa có 0012 ⇒ mọi ca đỏ NGAY ở `needSwitch` ("chưa có tính năng").
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  auditMark,
  audits,
  createM4Env,
  type Listener,
  type M4Env,
  TENANT_ID,
  track,
} from "../../M4/_ab";

// biome-ignore lint/suspicious/noExplicitAny: JSON / hàng DB
type Obj = Record<string, any>;
let env: M4Env;
let lis: Listener;
let hasSwitch = false;
const A = TENANT_ID.acme;
let W = { id: "", key: "" };

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
  const [r] = await env.owner<
    { ok: boolean }[]
  >`select to_regclass('admin.tenant_workflow_tools') is not null as ok`;
  hasSwitch = r?.ok === true;
}, 60_000);
afterAll(async () => {
  await env?.close();
});

/** Thiếu bảng 0012 ⇒ đỏ ngay, lý do rõ; có ⇒ chọn workflow catalog đầu tiên theo `key`. */
async function needSwitch(): Promise<void> {
  if (!hasSwitch)
    throw new Error("chưa có tính năng: công tắc tool admin.tenant_workflow_tools (T18a)");
  const [w] = await env.owner<
    { id: string; key: string }[]
  >`select id, key from admin.workflows order by key limit 1`;
  if (!w) throw new Error("fixture: admin.workflows rỗng trong harness M4");
  W = w;
  await env.owner`delete from admin.tenant_workflow_tools where tenant_id = ${A}`;
  await env.token("platform", "admin");
}
const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const path = (wf = W.id) => `/admin/tenants/${A}/workflow-tools/${wf}`;

describe("AC-A15 · ADM-FR-73 · bật/tắt tool cho tenant", () => {
  it("AC-A15 · PD2-I40 · GET ⇒ mọi workflow catalog sắp theo key, on:false, granted_at/by null", async () => {
    await needSwitch();
    const r = await admin("GET", `/admin/tenants/${A}/workflow-tools`);
    expect(r.status).toBe(200);
    const items = r.json?.items as Obj[];
    expect(items.map((i) => i.key)).toEqual([...items.map((i) => i.key)].sort());
    expect(items.find((i) => i.workflow_id === W.id)).toMatchObject({
      key: W.key,
      on: false,
      granted_at: null,
      granted_by: null,
    });
  });
  it("AC-A15 · PD2-I41…I42 · PUT ⇒ on:true, audit grant before/after {on}, NOTIFY workflow; PUT lần 2 ⇒ 0 audit, 0 NOTIFY", async () => {
    await needSwitch();
    const mark = await auditMark(env.owner);
    const t = await track(env, lis, () => admin("PUT", path(), {}));
    expect({ status: t.res.status, on: t.res.json?.on }).toEqual({ status: 200, on: true });
    const rows = await audits(env, mark);
    expect(
      rows.map((r) => ({
        a: r.action,
        e: r.entity,
        id: r.entity_id,
        b: (r.before as Obj)?.on,
        f: (r.after as Obj)?.on,
      })),
    ).toEqual([{ a: "grant", e: "workflow", id: W.id, b: false, f: true }]);
    expect(
      t.msgs.map((m) => ({ entity: m.payload.entity, tenant_id: m.payload.tenant_id })),
    ).toEqual([{ entity: "workflow", tenant_id: A }]);
    const mark2 = await auditMark(env.owner);
    const t2 = await track(env, lis, () => admin("PUT", path(), {}));
    expect({
      status: t2.res.status,
      audits: (await audits(env, mark2)).length,
      msgs: t2.msgs.length,
    }).toEqual({
      status: 200,
      audits: 0,
      msgs: 0,
    });
  });
  it("AC-A15 · PD2-I43 · DELETE ⇒ on:false + audit revoke; PUT lại ⇒ revoked_at NULL + audit grant", async () => {
    await needSwitch();
    await admin("PUT", path(), {});
    const mark = await auditMark(env.owner);
    const d = await admin("DELETE", path());
    expect({ status: d.status, on: d.json?.on }).toEqual({ status: 200, on: false });
    await admin("PUT", path(), {});
    const [row] = await env.owner<Obj[]>`select revoked_at from admin.tenant_workflow_tools
      where tenant_id = ${A} and workflow_id = ${W.id}`;
    expect(row?.revoked_at).toBeNull();
    expect((await audits(env, mark)).map((r) => r.action)).toEqual(["revoke", "grant"]);
  });
  it("AC-A15 · PD2-I48 · DELETE: revoked_at đặt; DELETE lần 2 ⇒ 200 không đổi (0 audit, revoked_at giữ); PUT lại ⇒ granted_by mới", async () => {
    await needSwitch();
    await admin("PUT", path(), {});
    expect((await admin("DELETE", path())).status).toBe(200);
    const [r1] = await env.owner<Obj[]>`select revoked_at from admin.tenant_workflow_tools
      where tenant_id = ${A} and workflow_id = ${W.id}`;
    expect(r1?.revoked_at).not.toBeNull();
    const mark = await auditMark(env.owner);
    const d2 = await admin("DELETE", path());
    expect({
      status: d2.status,
      on: d2.json?.on,
      audits: (await audits(env, mark)).length,
    }).toEqual({
      status: 200,
      on: false,
      audits: 0,
    });
    const [r2] = await env.owner<Obj[]>`select revoked_at from admin.tenant_workflow_tools
      where tenant_id = ${A} and workflow_id = ${W.id}`;
    expect(new Date(r2?.revoked_at).getTime()).toBe(new Date(r1?.revoked_at).getTime());
    const back = await admin("PUT", path(), {});
    expect({ status: back.status, on: back.json?.on }).toEqual({ status: 200, on: true });
    const [r3] = await env.owner<
      Obj[]
    >`select granted_by, revoked_at from admin.tenant_workflow_tools
      where tenant_id = ${A} and workflow_id = ${W.id}`;
    expect(r3?.revoked_at).toBeNull();
    expect(r3?.granted_by).not.toBeNull();
  });
  it("AC-A15 · PD2-I44…I45 · tenant_admin ⇒ 403; workflow không tồn tại ⇒ 404; body thừa trường ⇒ 400", async () => {
    await needSwitch();
    await env.token("acme", "binh");
    expect((await env.by("acme", "binh")("PUT", path(), {})).status).toBe(403);
    expect((await admin("PUT", path("a5d20000-0000-4000-8000-00000000ffff"), {})).status).toBe(404);
    expect((await admin("PUT", path(), { on: true })).status).toBe(400);
  });
  it("AC-A15 · PD2-I45 · tenant không tồn tại ⇒ 404 NOT_FOUND (GET/PUT/DELETE)", async () => {
    await needSwitch();
    const ghost = "a5d20000-0000-4000-8000-00000000fffe";
    const base = `/admin/tenants/${ghost}/workflow-tools`;
    const rs = [
      await admin("GET", base),
      await admin("PUT", `${base}/${W.id}`, {}),
      await admin("DELETE", `${base}/${W.id}`),
    ];
    expect(rs.map((r) => [r.status, r.json?.error?.code])).toEqual([
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
    ]);
  });
  it("AC-A15 · PD2-I46 · RLS: hub_ro SELECT được; admin_rw scope tenant globex không thấy hàng acme", async () => {
    await needSwitch();
    await admin("PUT", path(), {});
    const beta = await env.owner.begin(async (tx) => {
      await tx`set local role admin_rw`;
      await tx`select set_config('app.scope', 'tenant', true), set_config('app.tenant_id', ${TENANT_ID.globex}, true)`;
      return tx<Obj[]>`select * from admin.tenant_workflow_tools where tenant_id = ${A}`;
    });
    expect(beta.length).toBe(0);
    const ro = await env.owner.begin(async (tx) => {
      await tx`set local role hub_ro`;
      return tx<Obj[]>`select * from admin.tenant_workflow_tools where tenant_id = ${A}`;
    });
    expect(ro.length).toBe(1);
    await expect(
      env.owner.begin(async (tx) => {
        await tx`set local role hub_ro`;
        await tx`insert into admin.tenant_workflow_tools (workflow_id, tenant_id) values (${W.id}, ${TENANT_ID.globex})`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("AC-A15 · PD2-I47 · DB 0012 tenant_workflow_tools (T15b)", () => {
  const W2 = "a5d20000-0000-4000-8000-000000000147";
  const U2 = "a5d20000-0000-4000-8000-000000000148";
  const code = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { code?: string }) => e.code ?? String(e),
    );
  it("AC-A15 · PD2-I47 · PK trùng ⇒ 23505; xoá workflow ⇒ cascade; xoá user granted_by ⇒ NULL; index tenant_active có", async () => {
    await needSwitch();
    await env.owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id,
        input_schema, output_field, enabled, side_effect)
      select ${W2}, 'pd2-i47', name, description, app_type, base_url, secret_id, input_schema, output_field,
        enabled, side_effect from admin.workflows where id = ${W.id}`;
    await env.owner`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role,
        locale, active, locked_by_tenant, must_change_password)
      select ${U2}, tenant_id, 'pd2i47', 'pd2i47@example.test', 'x', 'PD2 I47', role, locale, true, false, false
      from admin.users where tenant_id = ${A} limit 1`;
    const ins = (wf: string) =>
      env.owner`insert into admin.tenant_workflow_tools (workflow_id, tenant_id, granted_at, granted_by)
        values (${wf}, ${A}, now(), ${U2})`;
    await ins(W.id);
    await ins(W2);
    expect(await code(ins(W.id))).toBe("23505");
    await env.owner`delete from admin.users where id = ${U2}`;
    const [g] = await env.owner<Obj[]>`select granted_by from admin.tenant_workflow_tools
      where tenant_id = ${A} and workflow_id = ${W.id}`;
    expect(g?.granted_by ?? "vắng hàng").toBeNull();
    await env.owner`delete from admin.workflows where id = ${W2}`;
    const [n] = await env.owner<Obj[]>`select count(*)::int as n from admin.tenant_workflow_tools
      where workflow_id = ${W2}`;
    expect(n?.n).toBe(0);
    const [ix] = await env.owner<
      Obj[]
    >`select to_regclass('admin.tenant_workflow_tools_tenant_active_idx')
      is not null as ok`;
    expect(ix?.ok).toBe(true);
  });
});
