// ADM-FR-52 · M4-R13 · Q7, Q8, Q9 · POST /admin/audit/:id/restore (test-plan RS1–RS10; M4-AC07, M4-AC08).
// Dữ liệu: owner đặt /dich version 42; admin PATCH description "B" (→ v43, dòng audit E43). Xanh ở T2b.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  audits,
  createM4Env,
  expectErr4,
  ID,
  ID3,
  ID4,
  type Listener,
  type M4Env,
  parse4,
  putQuota,
  qi,
  quotaPath,
  resetNow,
  TENANT_ID,
  tenantVer,
  track,
  USER_ID,
  verOf,
} from "./_ab";

let env: M4Env;
let lis: Listener;
let M = "0";
let E43 = "";
const A = TENANT_ID.acme;
const CMD = ID.command;
const KT = ID3.group.acmeKeToan;

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
  await env.owner`update admin.commands set version = 42 where id = ${CMD.dich}`;
  M = await auditMark(env.owner);
  const r = await admin("PATCH", `/admin/commands/${CMD.dich}`, {
    version: 42,
    description: { vi: "B" },
  });
  expect(r.status).toBe(200);
  E43 = await lastId("command", "update", CMD.dich);
});

const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const restore = (id: string, body: unknown = {}) =>
  admin("POST", `/admin/audit/${id}/restore`, body);
async function lastId(entity: string, action: string, entityId?: string): Promise<string> {
  const [r] = await env.owner<{ id: string }[]>`select id from admin.audit_log
    where seq > ${M}::bigint and entity = ${entity} and action = ${action}
      and (${entityId ?? null}::uuid is null or entity_id = ${entityId ?? null}::uuid)
    order by seq desc limit 1`;
  expect([entity, action, Boolean(r?.id)]).toEqual([entity, action, true]);
  return r?.id as string;
}
const cmdRow = async (id: string) =>
  (await env.owner`select name, description, version from admin.commands where id = ${id}`)[0];
const rowJson = async (id: string) =>
  (await env.owner`select row_to_json(a)::text as j from admin.audit_log a where id = ${id}`)[0]?.j;

describe("ADM-FR-52 · khôi phục command", () => {
  it("ADM-FR-52 · M4-AC08 · RS1 · restore E43 → 200 {command, version 44}; nội dung = trước; 1 audit restore (restored_from, restored_version 43, snapshot); 1 NOTIFY; E43 không đổi", async () => {
    const before = await cmdRow(CMD.dich);
    const e43 = await rowJson(E43);
    const desc0 = (await env.owner`select before from admin.audit_log where id = ${E43}`)[0]?.before
      ?.description;
    const mark = await auditMark(env.owner);
    const t = await track(env, lis, () => restore(E43));
    expect(t.res.status).toBe(200);
    expect(t.res.json).toMatchObject({ entity: "command", entity_id: CMD.dich, version: 44 });
    expect(typeof t.res.json.audit_id).toBe("string");
    const after = await cmdRow(CMD.dich);
    expect([after?.version, after?.description]).toEqual([44, desc0]);
    expect(before?.description).toEqual({ vi: "B" });
    const rows = await audits(env, mark);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "restore",
      entity: "command",
      entity_id: CMD.dich,
      snapshot: true,
      entity_version: 44,
    });
    expect(rows[0]?.summary).toMatchObject({ restored_from: E43, restored_version: 43 });
    expect(t.msgs.map((m) => m.payload.entity)).toEqual(["command"]);
    expect(await rowJson(E43)).toBe(e43);
  });

  it("ADM-FR-52 · M4-R13 · RS2 · sau PATCH (v44), restore E43 → 409 VERSION_CONFLICT, current parse CommandSchema; 0 audit", async () => {
    expect(
      (
        await admin("PATCH", `/admin/commands/${CMD.dich}`, {
          version: 43,
          description: { vi: "C" },
        })
      ).status,
    ).toBe(200);
    const mark = await auditMark(env.owner);
    const d = expectErr4(await restore(E43), "VERSION_CONFLICT");
    expect(parse4("CommandSchema", d.current).version).toBe(44);
    expect(await audits(env, mark)).toHaveLength(0);
  });

  it("ADM-FR-52 · M4-R13 · M4-AC08 · RS3 · đổi tên dich→dich2 (Er); tạo command mới 'dich'; restore Er → 409 NAME_TAKEN {command, dich}", async () => {
    expect(
      (await admin("PATCH", `/admin/commands/${CMD.dich}`, { version: 43, name: "dich2" })).status,
    ).toBe(200);
    const er = await lastId("command", "update", CMD.dich);
    const created = await admin("POST", "/admin/commands", {
      name: "dich",
      description: { vi: "Mới" },
      workflow_id: ID.workflow.reportTax,
      output: { field: "text", render: "text" },
    });
    expect(created.status).toBe(201);
    const d = expectErr4(await restore(er), "NAME_TAKEN");
    expect(d).toEqual({ entity: "command", name: "dich" });
  });

  it("ADM-FR-52 · M4-R13 · RS4 · DELETE tom-tat → restore → cùng id, version = before + 1; lần 2 → 409 NOT_RESTORABLE", async () => {
    const v = await verOf(env, "commands", CMD.tomTat);
    expect((await admin("DELETE", `/admin/commands/${CMD.tomTat}`)).status).toBeLessThan(300);
    const ed = await lastId("command", "delete", CMD.tomTat);
    const res = await restore(ed);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ entity: "command", entity_id: CMD.tomTat, version: v + 1 });
    expect((await cmdRow(CMD.tomTat))?.version).toBe(v + 1);
    expectErr4(await restore(ed), "NOT_RESTORABLE");
  });

  it("ADM-FR-52 · M4-R13 · RS5 · DELETE command rồi DELETE workflow của nó → restore command → 409 RESTORE_REF_MISSING missing [{workflow, id}]", async () => {
    const wf = await admin("POST", "/admin/workflows", {
      key: "rs5-wf",
      name: "RS5",
      description: "d".repeat(30),
      app_type: "workflow",
      base_url: "https://x.example.com",
      secret_id: ID.secret.old,
    });
    expect(wf.status).toBe(201);
    const wfId = wf.json.id as string;
    const c = await admin("POST", "/admin/commands", {
      name: "rs5",
      description: { vi: "RS5" },
      workflow_id: wfId,
      output: { field: "text", render: "text" },
    });
    expect(c.status).toBe(201);
    expect((await admin("DELETE", `/admin/commands/${c.json.id}`)).status).toBeLessThan(300);
    expect((await admin("DELETE", `/admin/workflows/${wfId}`)).status).toBeLessThan(300);
    const d = expectErr4(
      await restore(await lastId("command", "delete", c.json.id)),
      "RESTORE_REF_MISSING",
    );
    expect(d.missing).toEqual([{ entity: "workflow", id: wfId }]);
  });
});

describe("ADM-FR-52 · khôi phục thực thể khác", () => {
  it("ADM-FR-52 · M4-R13 · RS6 · feature xoá kèm command_ids có command đã xoá → khôi phục bỏ id mất; group xoá có member → khôi phục không member/grant", async () => {
    const F = ID.feature.thuNghiem;
    const v = await verOf(env, "features", F);
    expect(
      (
        await admin("PATCH", `/admin/features/${F}`, {
          version: v,
          command_ids: [CMD.tomTat, CMD.trNhanh],
        })
      ).status,
    ).toBe(200);
    expect((await admin("DELETE", `/admin/commands/${CMD.trNhanh}`)).status).toBeLessThan(300);
    expect((await admin("DELETE", `/admin/features/${F}`)).status).toBeLessThan(300);
    expect((await restore(await lastId("feature", "delete", F))).status).toBe(200);
    const fc =
      await env.owner`select command_id from admin.feature_commands where feature_id = ${F}`;
    expect(fc.map((r) => r.command_id)).toEqual([CMD.tomTat]);
    const binh = env.by("acme", "binh");
    expect((await binh("DELETE", `/admin/groups/${KT}`)).status).toBeLessThan(300);
    expect((await restore(await lastId("group", "delete", KT))).status).toBe(200);
    const [g] = await env.owner`select
      (select count(*)::int from admin.groups where id = ${KT}) as g,
      (select count(*)::int from admin.group_members where group_id = ${KT}) as m,
      (select count(*)::int from admin.feature_grants where group_id = ${KT}) as gr`;
    expect(g).toEqual({ g: 1, m: 0, gr: 0 });
  });

  it("ADM-FR-52 · Q9 · RS7 · quota PUT 2 lần → restore dòng mới nhất → items = bản trước, tenant version +1, 1 NOTIFY quota acme", async () => {
    expect((await putQuota(env, A, [qi(null, { runs: 100 })])).status).toBe(200);
    expect(
      (await putQuota(env, A, [qi(null, { runs: 200 }), qi(ID.feature.keToan, { usd: "9.00" })]))
        .status,
    ).toBe(200);
    const v = await tenantVer(env, A);
    const t = await track(env, lis, async () => restore(await lastId("quota", "update")));
    expect(t.res.status).toBe(200);
    expect(await tenantVer(env, A)).toBe(v + 1);
    expect(t.msgs.map((m) => [m.payload.entity, m.payload.tenant_id])).toEqual([["quota", A]]);
    const b = parse4("QuotaSetResponseSchema", (await admin("GET", quotaPath(A))).json);
    expect(b.items.map((i: { max_runs: number | null }) => i.max_runs)).toEqual([100]);
  });

  it("ADM-FR-52 · Q7 · RS8 · restore dòng user update / tenant update / secret / grant / lock / create command → 409 NOT_RESTORABLE", async () => {
    const binh = env.by("acme", "binh");
    expect(
      (
        await binh("PATCH", `/admin/users/${USER_ID.lan}`, {
          version: await verOf(env, "users", USER_ID.lan),
          display_name: "L",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await admin("PATCH", `/admin/tenants/${A}`, {
          version: await tenantVer(env, A),
          name: "Acme 2",
        })
      ).status,
    ).toBe(200);
    expect((await admin("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: "rs8" })).status).toBe(200);
    expect(
      (await binh("POST", "/admin/grants", { feature_id: ID.feature.dichThuat, group_id: KT }))
        .status,
    ).toBe(201);
    expect((await binh("POST", `/admin/users/${USER_ID.lan}/lock`)).status).toBeLessThan(300);
    const ids = [
      await lastId("user", "update"),
      await lastId("tenant", "update"),
      await lastId("secret", "update"),
      await lastId("grant", "grant"),
      await lastId("user", "lock"),
    ];
    const c = await admin("POST", "/admin/commands", {
      name: "rs8",
      description: { vi: "RS8" },
      workflow_id: ID.workflow.reportTax,
      output: { field: "text", render: "text" },
    });
    expect(c.status).toBe(201);
    ids.push(await lastId("command", "create"));
    for (const id of ids) expectErr4(await restore(id), "NOT_RESTORABLE");
  });

  it("ADM-FR-52 · Q8 · M4-AC07 · RS9 · binh restore dòng acme / uuid lạ → 403; an → 403; admin uuid lạ → 404; body {x:1} → 400", async () => {
    const binh = env.by("acme", "binh");
    expect((await binh("POST", "/admin/groups", { key: "rs9", name: { vi: "RS9" } })).status).toBe(
      201,
    );
    const acmeRow = await lastId("group", "create");
    expectErr4(await binh("POST", `/admin/audit/${acmeRow}/restore`, {}), "FORBIDDEN");
    expectErr4(await binh("POST", `/admin/audit/${ID4.unknown}/restore`, {}), "FORBIDDEN");
    expectErr4(
      await env.by("acme", "an")("POST", `/admin/audit/${acmeRow}/restore`, {}),
      "FORBIDDEN",
    );
    expectErr4(await restore(ID4.unknown), "NOT_FOUND");
    expectErr4(await restore(E43, { x: 1 }), "VALIDATION_ERROR");
  });

  it("ADM-FR-52 · M4-R13 · RS10 · workflow, feature, group update → restore được, version +1", async () => {
    const W = ID.workflow.reportTax;
    const F = ID.feature.keToan;
    let v = await verOf(env, "workflows", W);
    expect(
      (await admin("PATCH", `/admin/workflows/${W}`, { version: v, name: "Tax 2" })).status,
    ).toBe(200);
    expect((await restore(await lastId("workflow", "update", W))).status).toBe(200);
    expect(await verOf(env, "workflows", W)).toBe(v + 2);
    v = await verOf(env, "features", F);
    expect(
      (await admin("PATCH", `/admin/features/${F}`, { version: v, status: "beta" })).status,
    ).toBe(200);
    expect((await restore(await lastId("feature", "update", F))).status).toBe(200);
    expect(
      (await env.owner`select status, version from admin.features where id = ${F}`)[0],
    ).toEqual({ status: "on", version: v + 2 });
    v = await verOf(env, "groups", KT);
    expect(
      (
        await env.by("acme", "binh")("PATCH", `/admin/groups/${KT}`, {
          version: v,
          name: { vi: "KT 2" },
        })
      ).status,
    ).toBe(200);
    expect((await restore(await lastId("group", "update", KT))).status).toBe(200);
    expect((await env.owner`select name, version from admin.groups where id = ${KT}`)[0]).toEqual({
      name: { vi: "Kế toán", en: "Accounting" },
      version: v + 2,
    });
  });
});
