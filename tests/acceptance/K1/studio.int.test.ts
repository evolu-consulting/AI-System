// HUB-FR-131 · HUB-FR-132 · HUB-BR-36 · HUB-BR-37 · K1-AC09a · CR-073 · spec §3.2 (Studio `/kh/connections*`, `PUT
// /agents/:id/knowledge`), §3.5 (audit), §4 (`used_by` knowledge_hub) · plan §3.3, §4 · test-plan K1 §4 A01–A14: CRUD kết nối
// (allowlist/https, `KH_SECRET_INVALID` not_found/wrong_kind/not_platform, `KH_CONNECTION_EXISTS`, đổi URL/khoá ⇒ unchecked,
// `KH_CONNECTION_IN_USE {agents}`), gắn agent (≤ 5, thứ tự, chỉ agentic-cli, version), quyền platform_admin, audit, used_by.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  agentKh,
  auditMaxK1,
  auditSinceK1,
  CONN,
  type CtxK1,
  checkResult,
  configVersion,
  connRow,
  errCode,
  errDetails,
  K1,
  KEY,
  NONE,
  needK1,
  P1,
  putAgentKh,
  seedConn,
  startK1,
  studio,
  tick,
} from "./_k1";

let c: CtxK1;
beforeAll(async () => {
  c = await startK1({ seed: "secrets", extraOrigins: ["http://kh.example.com"] });
}, 90_000);
afterAll(async () => {
  await c?.stop();
});
beforeEach(async () => {
  if (!c.k1 || !c.sec) return;
  await c.sql`delete from hub.agent_kh`;
  await c.sql`delete from hub.kh_connections`;
});

const need = () => needK1(c);
const body = (o: Record<string, unknown> = {}) => ({
  name: CONN.main,
  base_url: `${c.khA.base}/`,
  secret_id: K1.secMain,
  summary_project: "proj-a",
  ...o,
});
const create = (o: Record<string, unknown> = {}) => studio(c, "POST", "", body(o));
const seedMain = (status: "ok" | "unchecked" = "ok") =>
  seedConn(c.sql, {
    id: K1.connMain,
    name: CONN.main,
    baseUrl: c.khA.base,
    secretId: K1.secMain,
    summary: "proj-a",
    status,
    projects: ["proj-a", "proj-b"],
  });
async function agentVersion(id: string): Promise<number> {
  const [r] = await c.sql<{ v: number }[]>`select version as v from hub.agents where id = ${id}`;
  return r?.v ?? -1;
}

describe("A01–A07 · tạo + đọc kết nối [spec §3.2]", () => {
  it("HUB-FR-131 · A01 · POST ⇒ 201 KhConnection (unchecked, check null, secret {id,name}, base_url bỏ '/', agents_count 0, v1) + audit create + bump config", async () => {
    need();
    const a0 = await auditMaxK1(c.sql);
    const v0 = await configVersion(c.sql);
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      name: CONN.main,
      base_url: c.khA.base,
      secret: { id: K1.secMain, name: "kh-key-main" },
      summary_project: "proj-a",
      status: "unchecked",
      check: null,
      agents_count: 0,
      version: 1,
    });
    expect(await configVersion(c.sql)).toBeGreaterThan(v0);
    const au = await auditSinceK1(c.sql, a0, "kh_connection");
    expect(au.map((x) => [x.action, x.tenant_id, x.entity_name])).toEqual([
      ["create", null, CONN.main],
    ]);
    expect(au[0]?.after).toEqual({
      name: CONN.main,
      base_url: c.khA.base,
      secret_id: K1.secMain,
      summary_project: "proj-a",
      version: 1,
    });
    expect(JSON.stringify(au)).not.toContain(KEY.a);
  });
  it("HUB-FR-131 · A02 · GET ⇒ items sắp lower(name), allowed_origins + timeout_ms theo cấu hình, phân trang cursor; summary_project vắng ⇒ null", async () => {
    need();
    expect((await create({ name: "Zeta" })).status).toBe(201);
    const b = await create({
      name: "alpha",
      base_url: c.khB.base,
      secret_id: K1.secAlt,
      summary_project: undefined,
    });
    expect([b.status, b.json?.summary_project]).toEqual([201, null]);
    const r = await studio(c, "GET", "");
    expect(r.status).toBe(200);
    expect(r.json.items.map((x: { name: string }) => x.name)).toEqual(["alpha", "Zeta"]);
    expect([...r.json.allowed_origins].sort()).toEqual([c.khA.origin, c.khB.origin].sort());
    expect(r.json.timeout_ms).toBe(1000);
    const p1 = await studio(c, "GET", "?limit=1");
    expect([p1.json.items.length, typeof p1.json.next_cursor]).toEqual([1, "string"]);
    const p2 = await studio(c, "GET", `?limit=1&cursor=${encodeURIComponent(p1.json.next_cursor)}`);
    expect([p2.json.items[0]?.name, p2.json.next_cursor]).toEqual(["Zeta", null]);
  });
  it("HUB-FR-131 · A03 · không phải platform_admin ⇒ 403 trước parse (body sai vẫn 403) ở mọi route kết nối + gắn agent", async () => {
    need();
    await seedMain();
    for (const r of ["Adm", "A"] as const) {
      const res = [
        await studio(c, "GET", "", undefined, r),
        await studio(c, "POST", "", { bad: 1 }, r),
        await studio(c, "PUT", `/${K1.connMain}`, { bad: 1 }, r),
        await studio(c, "DELETE", `/${K1.connMain}?version=1`, undefined, r),
        await studio(c, "POST", `/${K1.connMain}/check`, undefined, r),
        await putAgentKh(c, P1.agM1, { bad: 1 }, r),
      ];
      expect({ r, s: res.map((x) => x.status) }).toEqual({ r, s: [403, 403, 403, 403, 403, 403] });
    }
    expect(c.khA.calls).toEqual([]);
  });
  it("HUB-FR-131 · A04 · body sai ⇒ 400 (tên có '/', tên rỗng, base_url > 512, secret_id không uuid, summary_project sai, trường lạ)", async () => {
    need();
    for (const o of [
      { name: "a/b" },
      { name: "  " },
      { base_url: `${c.khA.base}/${"a".repeat(520)}` },
      { secret_id: "x" },
      { summary_project: "a/b" },
      { tenant_id: K1.secMain },
    ]) {
      const r = await create(o);
      expect({ o, s: r.status }).toEqual({ o, s: 400 });
    }
  });
  it("HUB-BR-37 · A05 · 422 KH_URL_NOT_ALLOWED: origin ngoài allowlist / http không loopback ⇒ not_https / userinfo ⇒ invalid", async () => {
    need();
    const cases: [string, string][] = [
      ["https://evil.example.com", "not_in_allowlist"],
      ["http://kh.example.com", "not_https"],
      [`http://u:p@${c.khA.origin.slice(7)}`, "invalid"],
      [`${c.khA.base}/?q=1`, "invalid"],
    ];
    for (const [u, reason] of cases) {
      const r = await create({ base_url: u });
      expect({ u, r: [r.status, errCode(r), errDetails(r)?.reason] }).toEqual({
        u,
        r: [422, "KH_URL_NOT_ALLOWED", reason],
      });
    }
    expect(await c.sql`select id from hub.kh_connections`).toHaveLength(0);
  });
  it("HUB-BR-36 · Q29 · A06 · 422 KH_SECRET_INVALID: không có ⇒ not_found; provider_api_key ⇒ wrong_kind; kh_api_key của tenant ⇒ not_platform", async () => {
    need();
    const cases: [string, string][] = [
      [NONE, "not_found"],
      [K1.secProv, "wrong_kind"],
      [K1.secTenant, "not_platform"],
    ];
    for (const [id, reason] of cases) {
      const r = await create({ secret_id: id });
      expect({ id, r: [r.status, errCode(r), errDetails(r)?.reason] }).toEqual({
        id,
        r: [422, "KH_SECRET_INVALID", reason],
      });
    }
  });
  it("HUB-FR-131 · Q15 · A07 · trùng tên (khác hoa thường) ⇒ 409 KH_CONNECTION_EXISTS {id, field: name}; trùng base_url ⇒ field base_url", async () => {
    need();
    const a = await create();
    expect(a.status).toBe(201);
    const n = await create({ name: CONN.main.toUpperCase(), base_url: c.khB.base });
    expect([n.status, errCode(n), errDetails(n)]).toEqual([
      409,
      "KH_CONNECTION_EXISTS",
      { id: a.json.id, field: "name" },
    ]);
    const u = await create({ name: "khac" });
    expect([u.status, errCode(u), errDetails(u)]).toEqual([
      409,
      "KH_CONNECTION_EXISTS",
      { id: a.json.id, field: "base_url" },
    ]);
  });
});

describe("A08–A09 · sửa + xoá kết nối [spec §3.2 · Q34]", () => {
  it("HUB-FR-131 · Q34 · A08 · PUT đổi tên / summary_project ⇒ giữ ok + check; đổi base_url hoặc secret_id ⇒ unchecked, check null; version tăng", async () => {
    need();
    await seedMain("ok");
    const put = (o: Record<string, unknown>, version: number) =>
      studio(c, "PUT", `/${K1.connMain}`, { ...body(o), version });
    const r1 = await put({ name: "kh-main-2", summary_project: "proj-b" }, 1);
    expect(r1.status).toBe(200);
    expect(r1.json).toMatchObject({
      name: "kh-main-2",
      summary_project: "proj-b",
      status: "ok",
      version: 2,
    });
    expect(r1.json.check?.status).toBe("ok");
    const r2 = await put(
      { name: "kh-main-2", secret_id: K1.secMain2, summary_project: "proj-b" },
      2,
    );
    expect([r2.status, r2.json?.status, r2.json?.check, r2.json?.version]).toEqual([
      200,
      "unchecked",
      null,
      3,
    ]);
    await c.sql`update hub.kh_connections set check_status = 'ok', check_result = ${c.sql.json(checkResult(["proj-a"]))} where id = ${K1.connMain}`;
    const r3 = await put(
      {
        name: "kh-main-2",
        base_url: c.khB.base,
        secret_id: K1.secMain2,
        summary_project: "proj-b",
      },
      3,
    );
    expect([r3.status, r3.json?.status, r3.json?.check, r3.json?.base_url]).toEqual([
      200,
      "unchecked",
      null,
      c.khB.base,
    ]);
    const row = await connRow(c.sql, K1.connMain);
    expect([row?.check_status, row?.check_result, row?.checked_at]).toEqual([
      "unchecked",
      null,
      null,
    ]);
  });
  it("HUB-FR-131 · A09 · PUT version cũ ⇒ 409 VERSION_CONFLICT {current, updated_at}; id lạ ⇒ 404; URL/secret sai ⇒ 422 như POST", async () => {
    need();
    await seedMain();
    const stale = await studio(c, "PUT", `/${K1.connMain}`, { ...body(), version: 9 });
    expect([stale.status, errCode(stale), errDetails(stale)?.current]).toEqual([
      409,
      "VERSION_CONFLICT",
      1,
    ]);
    expect(typeof errDetails(stale)?.updated_at).toBe("string");
    expect((await studio(c, "PUT", `/${NONE}`, { ...body(), version: 1 })).status).toBe(404);
    const u = await studio(c, "PUT", `/${K1.connMain}`, {
      ...body({ base_url: "https://evil.example.com" }),
      version: 1,
    });
    expect([u.status, errCode(u)]).toEqual([422, "KH_URL_NOT_ALLOWED"]);
    const s = await studio(c, "PUT", `/${K1.connMain}`, {
      ...body({ secret_id: K1.secTenant }),
      version: 1,
    });
    expect([s.status, errCode(s), errDetails(s)?.reason]).toEqual([
      422,
      "KH_SECRET_INVALID",
      "not_platform",
    ]);
  });
  it("HUB-FR-131 · A10 · DELETE: agent đang tick ⇒ 409 KH_CONNECTION_IN_USE {agents}; version sai ⇒ 409 VERSION_CONFLICT; gỡ ⇒ 204 + audit delete; lại ⇒ 404", async () => {
    need();
    await seedMain();
    await tick(c.sql, P1.agM1, [K1.connMain]);
    await tick(c.sql, P1.agM2, [K1.connMain]);
    const used = await studio(c, "DELETE", `/${K1.connMain}?version=1`);
    expect([used.status, errCode(used), errDetails(used)]).toEqual([
      409,
      "KH_CONNECTION_IN_USE",
      { agents: 2 },
    ]);
    const list = await studio(c, "GET", "");
    expect(list.json?.items?.[0]?.agents_count).toBe(2);
    await c.sql`delete from hub.agent_kh`;
    const stale = await studio(c, "DELETE", `/${K1.connMain}?version=5`);
    expect([stale.status, errCode(stale)]).toEqual([409, "VERSION_CONFLICT"]);
    const a0 = await auditMaxK1(c.sql);
    expect((await studio(c, "DELETE", `/${K1.connMain}?version=1`)).status).toBe(204);
    expect(await connRow(c.sql, K1.connMain)).toBeUndefined();
    const au = await auditSinceK1(c.sql, a0, "kh_connection");
    expect(au.map((x) => [x.action, x.entity_name])).toEqual([["delete", CONN.main]]);
    expect((await studio(c, "DELETE", `/${K1.connMain}?version=1`)).status).toBe(404);
    expect((await studio(c, "POST", `/${NONE}/check`)).status).toBe(404);
  });
});

describe("A11–A13 · agent tick kết nối [spec §3.2 · D4]", () => {
  const seedTwo = async () => {
    await seedMain();
    await seedConn(c.sql, {
      id: K1.connAlt,
      name: CONN.alt,
      baseUrl: c.khB.base,
      secretId: K1.secAlt,
      summary: null,
      status: "unchecked",
    });
  };
  it("HUB-FR-132 · A11 · PUT /agents/:id/knowledge {connection_ids theo thứ tự tick, version} ⇒ 200; agent_kh đúng thứ tự; version +1; đọc agent có knowledge_connection_ids; list knowledge_count; audit update agent", async () => {
    need();
    await seedTwo();
    const v = await agentVersion(P1.agM1);
    const a0 = await auditMaxK1(c.sql);
    const r = await putAgentKh(c, P1.agM1, {
      connection_ids: [K1.connAlt, K1.connMain],
      version: v,
    });
    expect(r.status).toBe(200);
    expect(await agentKh(c.sql, P1.agM1)).toEqual([K1.connAlt, K1.connMain]);
    expect(await agentVersion(P1.agM1)).toBe(v + 1);
    const g = await c.call("P", "GET", `/studio/api/agents/${P1.agM1}`);
    expect(g.json?.agent?.knowledge_connection_ids ?? g.json?.knowledge_connection_ids).toEqual([
      K1.connAlt,
      K1.connMain,
    ]);
    const li = await c.call("P", "GET", "/studio/api/agents");
    const items = (li.json?.items ?? li.json ?? []) as { id: string; knowledge_count?: number }[];
    expect(items.find((x) => x.id === P1.agM1)?.knowledge_count).toBe(2);
    const au = await auditSinceK1(c.sql, a0, "agent");
    expect(au.map((x) => x.action)).toEqual(["update"]);
    expect(au[0]?.after).toMatchObject({ knowledge_connection_ids: [K1.connAlt, K1.connMain] });
    const clear = await putAgentKh(c, P1.agM1, { connection_ids: [], version: v + 1 });
    expect(clear.status).toBe(200);
    expect(await agentKh(c.sql, P1.agM1)).toEqual([]);
  });
  it("HUB-FR-132 · Q22 · A12 · trùng / > 5 ⇒ 400 path connection_ids; id lạ ⇒ 422 KH_CONNECTION_NOT_FOUND {ids}; version cũ ⇒ 409; agent lạ ⇒ 404", async () => {
    need();
    await seedTwo();
    const v = await agentVersion(P1.agM2);
    const dup = await putAgentKh(c, P1.agM2, {
      connection_ids: [K1.connMain, K1.connMain],
      version: v,
    });
    expect(dup.status).toBe(400);
    expect(JSON.stringify(dup.json)).toContain("connection_ids");
    const six = Array.from(
      { length: 6 },
      (_, i) => `c1a10000-0000-4000-8000-0000000005${String(i).padStart(2, "0")}`,
    );
    expect((await putAgentKh(c, P1.agM2, { connection_ids: six, version: v })).status).toBe(400);
    const nf = await putAgentKh(c, P1.agM2, { connection_ids: [K1.connMain, NONE], version: v });
    expect([nf.status, errCode(nf), errDetails(nf)]).toEqual([
      422,
      "KH_CONNECTION_NOT_FOUND",
      { ids: [NONE] },
    ]);
    const stale = await putAgentKh(c, P1.agM2, { connection_ids: [K1.connMain], version: v + 9 });
    expect([stale.status, errCode(stale)]).toEqual([409, "VERSION_CONFLICT"]);
    expect((await putAgentKh(c, NONE, { connection_ids: [], version: 1 })).status).toBe(404);
    expect(await agentKh(c.sql, P1.agM2)).toEqual([]);
    expect(await agentVersion(P1.agM2)).toBe(v);
  });
  it("HUB-FR-132 · Q10 · A13 · agent runtime ≠ agentic-cli: list ≠ [] ⇒ 422 KH_AGENT_RUNTIME; [] ⇒ 200", async () => {
    need();
    await seedTwo();
    const v = await agentVersion(K1.agLlm);
    const r = await putAgentKh(c, K1.agLlm, { connection_ids: [K1.connMain], version: v });
    expect([r.status, errCode(r)]).toEqual([422, "KH_AGENT_RUNTIME"]);
    expect((await putAgentKh(c, K1.agLlm, { connection_ids: [], version: v })).status).toBe(200);
  });
});

describe("A14 · used_by secret [K1-AC09a · spec §4]", () => {
  it("HUB-FR-131 · K1-AC09a · A14 · xoá kh_api_key đang được kết nối trỏ tới ⇒ 409 SECRET_IN_USE used_by [{type: knowledge_hub, id: kết nối, key: tên}]; GET secret cũng liệt kê", async () => {
    need();
    await seedMain();
    const ub = [{ type: "knowledge_hub", id: K1.connMain, key: CONN.main }];
    const g = await c.call("P", "GET", `/studio/api/secrets/${K1.secMain}`);
    expect(g.json?.used_by).toEqual(ub);
    const r = await c.call("P", "DELETE", `/studio/api/secrets/${K1.secMain}?version=1`);
    expect([r.status, errCode(r), errDetails(r)?.used_by]).toEqual([409, "SECRET_IN_USE", ub]);
    const free = await c.call("P", "GET", `/studio/api/secrets/${K1.secAlt}`);
    expect(free.json?.used_by).toEqual([]);
  });
});
