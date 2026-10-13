// HUB-FR-132 · HUB-BR-35 · K1-AC02 · spec §3.3 (`/admin/kh*`, `/process-defs/:id/knowledge`; tenant_admin = tenant phiên,
// platform_admin kèm ?tenant_id, member 403) · test-plan K1 §4 A50–A61: trạng thái dùng được theo reason, bật/tắt theo công ty,
// gắn project cho quy trình/stage + `effective`, cách ly tenant (def/project tenant khác ⇒ 404), version, audit.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  auditMaxK1,
  auditSinceK1,
  type CtxK1,
  errCode,
  errDetails,
  K1,
  NONE,
  PROJ,
  startK1,
  T,
} from "./_k1";

let c: CtxK1;
beforeAll(async () => {
  c = await startK1({ seed: "full" });
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

const need = () =>
  expect({ migration0029: c.k1, hubSecrets: c.sec }).toEqual({
    migration0029: true,
    hubSecrets: true,
  });
const kb = (id: string) => `/process-defs/${id}/knowledge`;
const pids = (r: { json: { projects?: { project_id: string }[] } }) =>
  (r.json?.projects ?? []).map((p) => p.project_id).sort();

describe("A50–A53 · /admin/kh [spec §3.3]", () => {
  it("HUB-FR-132 · A50 · tenant_admin ⇒ 200 {available true, reason null, enabled, projects của tenant mình, version}; member ⇒ 403", async () => {
    need();
    const r = await c.call("Adm", "GET", "/admin/kh");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ available: true, reason: null, enabled: true });
    expect(pids(r)).toEqual([PROJ.a, PROJ.b, PROJ.shared].sort());
    expect(Number.isInteger(r.json?.version)).toBe(true);
    expect((await c.call("A", "GET", "/admin/kh")).status).toBe(403);
  });
  it("HUB-BR-35 · K1-AC02 · A51 · tenant_admin beta chỉ thấy project beta; platform_admin ?tenant_id=beta như vậy", async () => {
    need();
    expect(pids(await c.call("Db", "GET", "/admin/kh"))).toEqual([PROJ.beta]);
    expect(pids(await c.call("P", "GET", `/admin/kh?tenant_id=${T.beta}`))).toEqual([PROJ.beta]);
  });
  it("HUB-FR-132 · Q5 · A52 · reason: unchecked / check_failed / not_configured ⇒ available false", async () => {
    need();
    try {
      await c.sql`update hub.kh_tenants set check_status = 'unchecked' where tenant_id = ${T.acme}`;
      expect((await c.call("Adm", "GET", "/admin/kh")).json).toMatchObject({
        available: false,
        reason: "unchecked",
      });
      await c.sql`update hub.kh_tenants set check_status = 'error' where tenant_id = ${T.acme}`;
      expect((await c.call("Adm", "GET", "/admin/kh")).json).toMatchObject({
        available: false,
        reason: "check_failed",
      });
      await c.sql`delete from hub.kh_bindings where tenant_id = ${T.beta}`;
      await c.sql`delete from hub.kh_tenants where tenant_id = ${T.beta}`;
      const nb = await c.call("Db", "GET", "/admin/kh");
      expect(nb.status).toBe(200);
      expect(nb.json).toMatchObject({ available: false, reason: "not_configured", version: null });
    } finally {
      await c.sql`update hub.kh_tenants set check_status = 'ok' where tenant_id = ${T.acme}`;
    }
  });
  it("HUB-FR-132 · HUB-FR-69 · A53 · PUT /admin/kh/enabled ⇒ 200 + audit disable/enable; version cũ 409; chưa có hàng ⇒ 409 KH_NOT_CONFIGURED; member 403", async () => {
    need();
    const v = Number((await c.call("Adm", "GET", "/admin/kh")).json?.version);
    const a0 = await auditMaxK1(c.sql);
    const off = await c.call("Adm", "PUT", "/admin/kh/enabled", { enabled: false, version: v });
    expect([off.status, off.json?.enabled]).toEqual([200, false]);
    const on = await c.call("Adm", "PUT", "/admin/kh/enabled", {
      enabled: true,
      version: off.json?.version,
    });
    expect([on.status, on.json?.enabled]).toEqual([200, true]);
    expect((await auditSinceK1(c.sql, a0, "kh_tenant")).map((x) => x.action)).toEqual([
      "disable",
      "enable",
    ]);
    const stale = await c.call("Adm", "PUT", "/admin/kh/enabled", { enabled: false, version: v });
    expect([stale.status, errCode(stale)]).toEqual([409, "VERSION_CONFLICT"]);
    await c.sql`delete from hub.kh_bindings where tenant_id = ${T.beta}`;
    await c.sql`delete from hub.kh_tenants where tenant_id = ${T.beta}`;
    const nb = await c.call("Db", "PUT", "/admin/kh/enabled", { enabled: true, version: 1 });
    expect([nb.status, errCode(nb)]).toEqual([409, "KH_NOT_CONFIGURED"]);
    expect(
      (await c.call("A", "PUT", "/admin/kh/enabled", { enabled: false, version: v })).status,
    ).toBe(403);
  });
});

describe("A54–A61 · gắn project cho quy trình [spec §3.3 · HUB-BR-35]", () => {
  it("HUB-FR-132 · A54 · GET binding ⇒ project mặc định + effective theo stage (read_only, summary_required)", async () => {
    need();
    const r = await c.call("Adm", "GET", kb(K1.defAuto));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      process_def_id: K1.defAuto,
      project_id: PROJ.a,
      stage_projects: {},
      version: 1,
    });
    expect(r.json?.effective).toEqual([
      { stage_key: "a0", project_id: PROJ.a, read_only: false, summary_required: true },
      { stage_key: "a1", project_id: PROJ.a, read_only: false, summary_required: true },
    ]);
    const mixed = await c.call("Adm", "GET", kb(K1.defMixed));
    expect(mixed.json?.effective?.map((e: { project_id: string | null }) => e.project_id)).toEqual([
      null,
      PROJ.a,
    ]);
  });
  it("HUB-FR-132 · A55 · PUT tạo (version null) ⇒ 200 version 1; override stage sang project chỉ đọc ⇒ summary_required false; audit update kh_binding", async () => {
    need();
    const a0 = await auditMaxK1(c.sql);
    const r = await c.call("Adm", "PUT", kb(K1.defFree), {
      project_id: PROJ.b,
      stage_projects: { f1: PROJ.shared },
      version: null,
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      project_id: PROJ.b,
      stage_projects: { f1: PROJ.shared },
      version: 1,
    });
    expect(r.json?.effective).toEqual([
      { stage_key: "f0", project_id: PROJ.b, read_only: false, summary_required: true },
      { stage_key: "f1", project_id: PROJ.shared, read_only: true, summary_required: false },
    ]);
    const au = await auditSinceK1(c.sql, a0, "kh_binding");
    expect(au.map((x) => [x.action, x.entity_name, x.tenant_id])).toEqual([
      ["update", "k1-free", T.acme],
    ]);
  });
  it("HUB-BR-35 · K1-AC02 · A56 · project của tenant khác / không có ⇒ 404 KH_PROJECT_NOT_FOUND (cả trong stage_projects)", async () => {
    need();
    const v = (await c.call("Adm", "GET", kb(K1.defFree))).json?.version ?? null;
    for (const b of [
      { project_id: PROJ.beta, stage_projects: {}, version: v },
      { project_id: "proj-zzz", stage_projects: {}, version: v },
      { project_id: PROJ.a, stage_projects: { f0: PROJ.beta }, version: v },
    ]) {
      const r = await c.call("Adm", "PUT", kb(K1.defFree), b);
      expect({ b, got: [r.status, errCode(r)] }).toEqual({ b, got: [404, "KH_PROJECT_NOT_FOUND"] });
    }
  });
  it("HUB-FR-132 · A57 · stage_projects có khoá không phải stage của def ⇒ 400 path stage_projects.<key>", async () => {
    need();
    const v = (await c.call("Adm", "GET", kb(K1.defFree))).json?.version ?? null;
    const r = await c.call("Adm", "PUT", kb(K1.defFree), {
      project_id: PROJ.a,
      stage_projects: { zz: null },
      version: v,
    });
    expect(r.status).toBe(400);
    expect(JSON.stringify(errDetails(r) ?? {}).includes("stage_projects")).toBe(true);
  });
  it("HUB-FR-69 · A58 · version cũ ⇒ 409 VERSION_CONFLICT", async () => {
    need();
    const r = await c.call("Adm", "PUT", kb(K1.defAuto), {
      project_id: PROJ.b,
      stage_projects: {},
      version: 99,
    });
    expect([r.status, errCode(r)]).toEqual([409, "VERSION_CONFLICT"]);
  });
  it("HUB-FR-132 · A59 · project_id null + mọi override null/vắng ⇒ xoá gắn (GET project null, version null); audit delete kh_binding", async () => {
    need();
    const v = (await c.call("Adm", "GET", kb(K1.defFree))).json?.version ?? null;
    const a0 = await auditMaxK1(c.sql);
    const r = await c.call("Adm", "PUT", kb(K1.defFree), {
      project_id: null,
      stage_projects: { f1: null },
      version: v,
    });
    expect(r.status).toBe(200);
    const g = await c.call("Adm", "GET", kb(K1.defFree));
    expect(g.json).toMatchObject({ project_id: null, version: null });
    expect(
      (await c.sql`select 1 from hub.kh_bindings where process_def_id = ${K1.defFree}`).length,
    ).toBe(0);
    expect((await auditSinceK1(c.sql, a0, "kh_binding")).map((x) => x.action)).toEqual(["delete"]);
  });
  it("HUB-BR-35 · K1-AC02 · A60 · def tenant khác / id lạ ⇒ 404 NOT_FOUND giống nhau (GET + PUT); platform_admin ?tenant_id đúng ⇒ 200", async () => {
    need();
    const other = await c.call("Adm", "GET", kb(K1.defBeta));
    const ghost = await c.call("Adm", "GET", kb(NONE));
    expect([other.status, errCode(other)]).toEqual([404, "NOT_FOUND"]);
    expect([ghost.status, errCode(ghost)]).toEqual([404, "NOT_FOUND"]);
    const put = await c.call("Db", "PUT", kb(K1.defAuto), {
      project_id: PROJ.beta,
      stage_projects: {},
      version: 1,
    });
    expect([put.status, errCode(put)]).toEqual([404, "NOT_FOUND"]);
    expect((await c.call("P", "GET", `${kb(K1.defAuto)}?tenant_id=${T.acme}`)).status).toBe(200);
  });
  it("HUB-FR-132 · A61 · member ⇒ 403 cả GET và PUT binding", async () => {
    need();
    expect((await c.call("A", "GET", kb(K1.defAuto))).status).toBe(403);
    expect(
      (
        await c.call("A", "PUT", kb(K1.defAuto), {
          project_id: null,
          stage_projects: {},
          version: 1,
        })
      ).status,
    ).toBe(403);
  });
});
