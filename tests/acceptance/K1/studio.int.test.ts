// HUB-FR-131 · HUB-FR-132 · HUB-BR-35 · HUB-BR-36 · HUB-BR-37 · K1-AC09a · spec §3.2 (Studio `/studio/api/kh*`, chỉ platform_admin)
// + §3.6 audit + §4 used_by · test-plan K1 §4 A01–A24: cài đặt URL (allowlist, version, đổi URL ⇒ unchecked), tenant ↔ ns ↔
// secret (tạo/sửa/xoá, mã lỗi), list + cursor, agent `knowledge_enabled`, xoá `kh_api_key` đang dùng ⇒ SECRET_IN_USE.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  auditMaxK1,
  auditSinceK1,
  type CtxK1,
  configVersion,
  errCode,
  errDetails,
  K1,
  NONE,
  NS,
  P1,
  PROJ,
  seedBinding,
  setBaseUrl,
  startK1,
  studio,
  T,
  tenantRow,
} from "./_k1";

let c: CtxK1;
beforeAll(async () => {
  c = await startK1({ seed: "secrets" });
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

const need = () =>
  expect({ migration0029: c.k1, hubSecrets: c.sec }).toEqual({
    migration0029: true,
    hubSecrets: true,
  });
async function clean(): Promise<void> {
  need();
  await c.sql`delete from hub.kh_bindings`;
  await c.sql`delete from hub.kh_projects`;
  await c.sql`delete from hub.kh_tenants`;
  await setBaseUrl(c.sql, null);
}
const body = (o: Record<string, unknown> = {}) => ({
  ns: NS.acme,
  secret_id: K1.secAcme,
  keyspace: "step",
  projects: [
    { project_id: PROJ.a, label: "Dự án A" },
    { project_id: PROJ.b },
    { project_id: PROJ.shared, read_only: true },
  ],
  ...o,
});
const putTenant = (tenant: string, b: unknown) => studio(c, "PUT", `/tenants/${tenant}`, b);
async function settingsVersion(): Promise<number> {
  return Number((await studio(c, "GET", "/settings")).json?.version ?? -1);
}

describe("A01–A06 · cài đặt URL [spec §3.2 · HUB-BR-37]", () => {
  it("HUB-FR-131 · A01 · GET /kh/settings ⇒ 200 {base_url null, allowed_origins từ env (chỉ đọc), timeout_ms, version}", async () => {
    await clean();
    const r = await studio(c, "GET", "/settings");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      base_url: null,
      allowed_origins: [c.kh.origin],
      timeout_ms: 1000,
    });
    expect(Number.isInteger(r.json?.version)).toBe(true);
  });
  it("HUB-FR-131 · A02 · tenant_admin / member ⇒ 403 ở mọi route Studio KH (trước parse)", async () => {
    need();
    for (const role of ["Adm", "A"] as const) {
      const got = [
        (await studio(c, "GET", "/settings", undefined, role)).status,
        (await studio(c, "PUT", "/settings", { bad: 1 }, role)).status,
        (await studio(c, "GET", "/tenants", undefined, role)).status,
        (await studio(c, "PUT", `/tenants/${T.acme}`, { bad: 1 }, role)).status,
        (await studio(c, "POST", `/tenants/${T.acme}/check`, undefined, role)).status,
      ];
      expect({ role, got }).toEqual({ role, got: [403, 403, 403, 403, 403] });
    }
  });
  it("HUB-FR-131 · HUB-FR-69 · A03 · PUT URL hợp lệ ⇒ 200, version+1, bump hub_config_version, audit update kh_settings {base_url, version}", async () => {
    await clean();
    const v = await settingsVersion();
    const [a0, cv0] = [await auditMaxK1(c.sql), await configVersion(c.sql)];
    const r = await studio(c, "PUT", "/settings", { base_url: `${c.kh.base}/`, version: v });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ base_url: c.kh.base, version: v + 1 });
    expect(await configVersion(c.sql)).toBeGreaterThan(cv0);
    const au = await auditSinceK1(c.sql, a0, "kh_settings");
    expect(au.map((x) => [x.action, x.entity_name, x.tenant_id])).toEqual([["update", "kh", null]]);
    expect(au[0]?.after).toMatchObject({ base_url: c.kh.base, version: v + 1 });
  });
  it("HUB-BR-37 · A04 · URL ngoài allowlist / có userinfo ⇒ 422 KH_URL_NOT_ALLOWED {reason}; 0 ghi", async () => {
    await clean();
    const v = await settingsVersion();
    const a0 = await auditMaxK1(c.sql);
    const out = await studio(c, "PUT", "/settings", {
      base_url: "https://evil.example.com",
      version: v,
    });
    expect([out.status, errCode(out), errDetails(out)?.reason]).toEqual([
      422,
      "KH_URL_NOT_ALLOWED",
      "not_in_allowlist",
    ]);
    const ui = await studio(c, "PUT", "/settings", {
      base_url: "https://u:p@kh.example.com",
      version: v,
    });
    expect([ui.status, errCode(ui), errDetails(ui)?.reason]).toEqual([
      422,
      "KH_URL_NOT_ALLOWED",
      "invalid",
    ]);
    expect(await settingsVersion()).toBe(v);
    expect(await auditSinceK1(c.sql, a0)).toEqual([]);
  });
  it("HUB-FR-69 · A05 · version cũ ⇒ 409 VERSION_CONFLICT; body sai kiểu ⇒ 400", async () => {
    await clean();
    const v = await settingsVersion();
    const r = await studio(c, "PUT", "/settings", { base_url: c.kh.base, version: v + 7 });
    expect([r.status, errCode(r)]).toEqual([409, "VERSION_CONFLICT"]);
    expect((await studio(c, "PUT", "/settings", { base_url: 5, version: v })).status).toBe(400);
  });
  it("HUB-FR-131 · Q5 · A06 · đổi URL ⇒ mọi tenant về unchecked (check giữ hay null không quan trọng, status phải unchecked)", async () => {
    await clean();
    await setBaseUrl(c.sql, c.kh.base);
    await c.sql`insert into hub.kh_tenants (tenant_id, ns, secret_id, check_status) values
      (${T.acme}, ${NS.acme}, ${K1.secAcme}, 'ok'), (${T.beta}, ${NS.beta}, ${K1.secBeta}, 'error')`;
    const v = await settingsVersion();
    expect(
      (await studio(c, "PUT", "/settings", { base_url: `${c.kh.base}/kh`, version: v })).status,
    ).toBe(200);
    expect([
      (await tenantRow(c.sql, T.acme))?.check_status,
      (await tenantRow(c.sql, T.beta))?.check_status,
    ]).toEqual(["unchecked", "unchecked"]);
  });
});

describe("A10–A19 · tenant ↔ ns ↔ secret [spec §3.2 · HUB-BR-35]", () => {
  it("HUB-FR-131 · HUB-BR-36 · A10 · tạo ⇒ 201 KhTenant (unchecked, enabled false, secret {id,name}, version 1), không giá trị secret; audit create", async () => {
    await clean();
    const a0 = await auditMaxK1(c.sql);
    const r = await putTenant(T.acme, body());
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      tenant: { id: T.acme, key: "acme", name: "Acme Corp" },
      ns: NS.acme,
      secret: { id: K1.secAcme, name: "kh-acme" },
      keyspace: "step",
      enabled: false,
      status: "unchecked",
      check: null,
      version: 1,
    });
    expect(r.json?.projects).toEqual([
      { project_id: PROJ.a, label: "Dự án A", read_only: false },
      { project_id: PROJ.b, label: "", read_only: false },
      { project_id: PROJ.shared, label: "", read_only: true },
    ]);
    expect(r.text.includes("client_secret")).toBe(false);
    const au = await auditSinceK1(c.sql, a0, "kh_tenant");
    expect(au.map((x) => [x.action, x.entity_name, x.tenant_id])).toEqual([
      ["create", `acme:${NS.acme}`, T.acme],
    ]);
  });
  it("HUB-FR-131 · A11 · tạo lần hai ⇒ 409 KH_TENANT_EXISTS; ns đã dùng bởi tenant khác ⇒ 409 KH_NS_TAKEN", async () => {
    await clean();
    expect((await putTenant(T.acme, body())).status).toBe(201);
    const again = await putTenant(T.acme, body());
    expect([again.status, errCode(again)]).toEqual([409, "KH_TENANT_EXISTS"]);
    const taken = await putTenant(T.beta, body({ secret_id: K1.secBeta, projects: [] }));
    expect([taken.status, errCode(taken)]).toEqual([409, "KH_NS_TAKEN"]);
  });
  it("HUB-BR-35 · Q7 · A12 · secret phải là kh_api_key CỦA CHÍNH tenant ⇒ 422 KH_SECRET_INVALID {not_found|wrong_kind|wrong_tenant}", async () => {
    await clean();
    const cases: [string, string][] = [
      [NONE, "not_found"],
      [K1.secProv, "wrong_kind"],
      [K1.secAcme, "wrong_tenant"],
      [K1.secPlatKh, "wrong_tenant"],
    ];
    for (const [sid, reason] of cases) {
      const r = await putTenant(T.beta, body({ ns: NS.beta, secret_id: sid, projects: [] }));
      expect({ sid, got: [r.status, errCode(r), errDetails(r)?.reason] }).toEqual({
        sid,
        got: [422, "KH_SECRET_INVALID", reason],
      });
    }
    expect(await tenantRow(c.sql, T.beta)).toBeUndefined();
  });
  it("HUB-BR-35 · A13 · ns sai luật / project trùng / > 50 project / tenant không tồn tại ⇒ 400 (path)", async () => {
    await clean();
    for (const ns of ["khacme", "admin", "Ac", "a-b"])
      expect({ ns, s: (await putTenant(T.acme, body({ ns }))).status }).toEqual({ ns, s: 400 });
    const dup = await putTenant(
      T.acme,
      body({ projects: [{ project_id: "p1" }, { project_id: "p1" }] }),
    );
    expect(dup.status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ project_id: `p${i}` }));
    expect((await putTenant(T.acme, body({ projects: many }))).status).toBe(400);
    const ghost = await putTenant(NONE, body());
    expect(ghost.status).toBe(400);
    expect(JSON.stringify(errDetails(ghost) ?? {}).includes("tenant_id")).toBe(true);
  });
  it("HUB-FR-69 · A14 · sửa khi chưa có ⇒ 404; version cũ ⇒ 409 VERSION_CONFLICT {current}", async () => {
    await clean();
    expect((await putTenant(T.acme, body({ version: 1 }))).status).toBe(404);
    expect((await putTenant(T.acme, body())).status).toBe(201);
    const r = await putTenant(T.acme, body({ version: 5 }));
    expect([r.status, errCode(r)]).toEqual([409, "VERSION_CONFLICT"]);
  });
  it("HUB-FR-131 · Q5 · A15 · đổi secret/project ⇒ 200, version+1, status unchecked, check null (kể cả đang ok)", async () => {
    await clean();
    expect((await putTenant(T.acme, body())).status).toBe(201);
    await c.sql`update hub.kh_tenants set check_status = 'ok', checked_at = now(),
      check_result = ${c.sql.json({ kh_version: "v6.4", keyspace_dims: ["role"], items: [] })} where tenant_id = ${T.acme}`;
    const r = await putTenant(T.acme, body({ secret_id: K1.secAcme2, version: 1 }));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      version: 2,
      status: "unchecked",
      check: null,
      secret: { id: K1.secAcme2 },
    });
    expect((await tenantRow(c.sql, T.acme))?.check_status).toBe("unchecked");
  });
  it("HUB-FR-132 · A16 · bỏ project còn được gắn ⇒ 409 KH_PROJECT_IN_USE {project_id, process_defs:[{id,key,name}]}", async () => {
    await clean();
    expect((await putTenant(T.acme, body())).status).toBe(201);
    await seedBinding(c.sql, K1.defFree, T.acme, null, { f1: PROJ.b });
    const r = await putTenant(T.acme, body({ projects: [{ project_id: PROJ.a }], version: 1 }));
    expect([r.status, errCode(r)]).toEqual([409, "KH_PROJECT_IN_USE"]);
    expect(errDetails(r)).toMatchObject({
      project_id: PROJ.b,
      process_defs: [{ id: K1.defFree, key: "k1-free", name: "K1 tự do" }],
    });
  });
  it("HUB-FR-131 · A17 · GET /kh/tenants sắp theo key, q lọc, limit + next_cursor", async () => {
    await clean();
    expect((await putTenant(T.acme, body())).status).toBe(201);
    expect(
      (await putTenant(T.beta, body({ ns: NS.beta, secret_id: K1.secBeta, projects: [] }))).status,
    ).toBe(201);
    const all = await studio(c, "GET", "/tenants");
    expect(all.status).toBe(200);
    expect(all.json?.items?.map((i: { tenant: { key: string } }) => i.tenant.key)).toEqual([
      "acme",
      "beta",
    ]);
    const q = await studio(c, "GET", "/tenants?q=bet");
    expect(q.json?.items?.map((i: { ns: string }) => i.ns)).toEqual([NS.beta]);
    const p1 = await studio(c, "GET", "/tenants?limit=1");
    expect(p1.json?.items).toHaveLength(1);
    expect(typeof p1.json?.next_cursor).toBe("string");
    const p2 = await studio(
      c,
      "GET",
      `/tenants?limit=1&cursor=${encodeURIComponent(p1.json?.next_cursor)}`,
    );
    expect(p2.json?.items?.map((i: { ns: string }) => i.ns)).toEqual([NS.beta]);
    expect((await studio(c, "GET", "/tenants?limit=101")).status).toBe(400);
  });
  it("HUB-FR-131 · D16 · A18 · DELETE ?version ⇒ 204, CASCADE project + gắn quy trình, audit delete summary.bindings_removed; version cũ 409; chưa có 404", async () => {
    await clean();
    expect((await putTenant(T.acme, body())).status).toBe(201);
    await seedBinding(c.sql, K1.defFree, T.acme, PROJ.a);
    const stale = await studio(c, "DELETE", `/tenants/${T.acme}?version=9`);
    expect([stale.status, errCode(stale)]).toEqual([409, "VERSION_CONFLICT"]);
    const a0 = await auditMaxK1(c.sql);
    expect((await studio(c, "DELETE", `/tenants/${T.acme}?version=1`)).status).toBe(204);
    const [n] =
      await c.sql`select (select count(*) from hub.kh_projects where tenant_id = ${T.acme})::int as p,
      (select count(*) from hub.kh_bindings where tenant_id = ${T.acme})::int as b`;
    expect({ ...n }).toEqual({ p: 0, b: 0 });
    const au = await auditSinceK1(c.sql, a0, "kh_tenant");
    expect(au.map((x) => x.action)).toEqual(["delete"]);
    expect(au[0]?.summary).toMatchObject({ bindings_removed: 1 });
    expect((await studio(c, "DELETE", `/tenants/${T.acme}?version=1`)).status).toBe(404);
    expect((await c.sql`select 1 from hub.secrets where id = ${K1.secAcme}`).length).toBe(1);
  });
});

describe("A20–A22 · agent tri thức [D17 · spec §3.2]", () => {
  const agentVersion = async (id: string) =>
    Number((await c.sql`select version from hub.agents where id = ${id}`)[0]?.version ?? -1);
  it("HUB-FR-132 · A20 · PUT /agents/:id/knowledge ⇒ 200 AgentWriteResponse, GET agent knowledge_enabled=true, audit update agent", async () => {
    need();
    const v = await agentVersion(P1.agM1);
    const a0 = await auditMaxK1(c.sql);
    const r = await c.call("P", "PUT", `/studio/api/agents/${P1.agM1}/knowledge`, {
      knowledge_enabled: true,
      version: v,
    });
    expect(r.status).toBe(200);
    const g = await c.call("P", "GET", `/studio/api/agents/${P1.agM1}`);
    expect(g.json?.agent?.knowledge_enabled ?? g.json?.knowledge_enabled).toBe(true);
    const au = await auditSinceK1(c.sql, a0, "agent");
    expect(au.map((x) => [x.action, x.entity_name])).toEqual([["update", "m1"]]);
    expect(au[0]?.after).toMatchObject({ knowledge_enabled: true });
  });
  it("HUB-FR-132 · A21 · version cũ ⇒ 409; agent không phải agentic-cli ⇒ 422 KH_AGENT_RUNTIME; id lạ ⇒ 404; tenant_admin ⇒ 403", async () => {
    need();
    const stale = await c.call("P", "PUT", `/studio/api/agents/${P1.agM2}/knowledge`, {
      knowledge_enabled: true,
      version: 99,
    });
    expect([stale.status, errCode(stale)]).toEqual([409, "VERSION_CONFLICT"]);
    const llm = await c.call("P", "PUT", `/studio/api/agents/${K1.agLlm}/knowledge`, {
      knowledge_enabled: true,
      version: await agentVersion(K1.agLlm),
    });
    expect([llm.status, errCode(llm)]).toEqual([422, "KH_AGENT_RUNTIME"]);
    expect(
      (
        await c.call("P", "PUT", `/studio/api/agents/${NONE}/knowledge`, {
          knowledge_enabled: true,
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await c.call("Adm", "PUT", `/studio/api/agents/${P1.agM2}/knowledge`, {
          knowledge_enabled: true,
          version: 1,
        })
      ).status,
    ).toBe(403);
  });
});

describe("A23 · used_by knowledge_hub [K1-AC09a · spec §4]", () => {
  it("HUB-FR-68 · K1-AC09a · A23 · xoá kh_api_key đang được KH trỏ tới ⇒ 409 SECRET_IN_USE, used_by có {type: knowledge_hub, id: tenant, key: ns}", async () => {
    await clean();
    expect((await putTenant(T.acme, body())).status).toBe(201);
    const r = await c.call("P", "DELETE", `/studio/api/secrets/${K1.secAcme}?version=1`);
    expect([r.status, errCode(r)]).toEqual([409, "SECRET_IN_USE"]);
    expect(errDetails(r)?.used_by).toContainEqual({
      type: "knowledge_hub",
      id: T.acme,
      key: NS.acme,
    });
    const g = await c.call("P", "GET", `/studio/api/secrets/${K1.secAcme}`);
    expect(g.json?.used_by).toContainEqual({ type: "knowledge_hub", id: T.acme, key: NS.acme });
    expect((await c.sql`select 1 from hub.secrets where id = ${K1.secAcme}`).length).toBe(1);
  });
});
