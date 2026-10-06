// HUB-FR-72 · HUB-FR-60 · HUB-FR-62 · HUB-FR-64 · H4a-AC-01, AC-10 · H4a-R01, R02, R11, R13 · test-plan H4a §3 A01–A19:
// mọi `/studio/api/*` chỉ `platform_admin` (401 → 403 trước parse, 0 ghi), `me`, danh sách agent (cột R11, lọc, badge
// Orchestrator, "Chưa cấp"), đọc catalog (workflow chỉ bật, tenants, agent-types, profiles, providers không secret).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  AG,
  AG4,
  AGENT_TYPE,
  api,
  type Ctx,
  cliBody,
  configState,
  errOf,
  NONE,
  orchBody,
  PROFILE,
  pa,
  startH4a,
  T,
  USERS,
  versionOf,
  WF,
  type Who,
} from "./_h4a";

let x: Ctx;
beforeAll(async () => {
  x = await startH4a();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

type Ep = { m: string; p: string; b?: unknown };
const EPS: Ep[] = [
  { m: "GET", p: "/me" },
  { m: "GET", p: "/agents" },
  { m: "POST", p: "/agents", b: cliBody("qc-role") },
  { m: "GET", p: `/agents/${AG4.free}` },
  { m: "PUT", p: `/agents/${AG4.free}`, b: { version: 1 } },
  { m: "PATCH", p: `/agents/${AG4.free}/enabled`, b: { enabled: false, version: 1 } },
  { m: "DELETE", p: `/agents/${AG4.free}?version=1` },
  { m: "GET", p: "/orchestrator" },
  { m: "PUT", p: "/orchestrator/default", b: { ...orchBody(AG4.free), version: 1 } },
  { m: "DELETE", p: "/orchestrator/default" },
  { m: "POST", p: "/orchestrator/tenants", b: { ...orchBody(AG4.free), tenant_id: T.acme } },
  { m: "PUT", p: `/orchestrator/tenants/${T.beta}`, b: { ...orchBody(AG4.free), version: 1 } },
  { m: "DELETE", p: `/orchestrator/tenants/${T.beta}?version=1` },
  { m: "GET", p: "/agent-types" },
  { m: "GET", p: "/model-profiles" },
  { m: "GET", p: "/providers" },
  { m: "GET", p: "/workflows" },
  { m: "GET", p: "/tenants" },
];

describe("A01–A04 · role [HUB-FR-72 · H4a-AC-01 · H4a-R01]", () => {
  it("HUB-FR-72 · A01 · không token ⇒ 401 AUTH_EXPIRED ở mọi endpoint (18) [H4a-AC-01 · H4a-R01]", async () => {
    const got = [];
    for (const e of EPS) got.push([e.m, e.p, errOf(await api(x, null, e.m, e.p, e.b)).code]);
    expect(got).toEqual(EPS.map((e) => [e.m, e.p, "AUTH_EXPIRED"]));
  });

  for (const who of ["tadmin", "lan", "an"] as Who[]) {
    it(`HUB-FR-72 · A02 · ${who} (${USERS[who].role}) ⇒ 403 FORBIDDEN ở mọi endpoint, 0 ghi cấu hình [H4a-AC-01 · H4a-R01]`, async () => {
      const s0 = await configState(x.sql);
      const got = [];
      for (const e of EPS) {
        const r = await api(x, who, e.m, e.p, e.b);
        got.push([e.m, e.p, r.status, errOf(r).code]);
      }
      expect(got).toEqual(EPS.map((e) => [e.m, e.p, 403, "FORBIDDEN"]));
      expect(await configState(x.sql)).toEqual(s0);
    });
  }

  it("HUB-FR-72 · A03 · tenant_admin gửi body sai/limit sai ⇒ vẫn 403 (role kiểm trước parse) [H4a-R01 · plan §3]", async () => {
    expect(errOf(await api(x, "tadmin", "POST", "/agents", { key: "X" })).code).toBe("FORBIDDEN");
    expect(errOf(await api(x, "tadmin", "GET", "/agents?limit=9999")).code).toBe("FORBIDDEN");
    expect(errOf(await api(x, "tadmin", "GET", "/agents/khong-phai-uuid")).code).toBe("FORBIDDEN");
  });

  it("HUB-FR-72 · A04 · GET /me (padmin) ⇒ 200 {user_id, tenant_id, role platform_admin, hub_config_version = DB} [H4a-R02]", async () => {
    const r = await pa(x, "GET", "/me");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      user_id: USERS.padmin.id,
      tenant_id: T.platform,
      role: "platform_admin",
      hub_config_version: await versionOf(x.sql),
    });
  });
});

describe("A05–A11 · danh sách agent [HUB-FR-60 · H4a-AC-02 · H4a-R11]", () => {
  const item = (r: { json: { items: { key: string }[] } }, key: string) =>
    r.json.items.find((i) => i.key === key) as Record<string, unknown> | undefined;

  it("HUB-FR-60 · A05 · GET /agents ⇒ 200, mọi agent seed (total = DB), không cột 24 giờ, hub_config_version [H4a-R11]", async () => {
    const r = await pa(x, "GET", "/agents");
    expect(r.status).toBe(200);
    const [c] = await x.sql<{ n: number }[]>`select count(*)::int as n from hub.agents`;
    expect(r.json.total).toBe(c?.n);
    expect(r.json.items.length).toBe(c?.n);
    expect(r.json.truncated).toBe(false);
    expect(r.json.hub_config_version).toBe(await versionOf(x.sql));
    for (const i of r.json.items) {
      expect(Object.keys(i)).not.toContain("runs_24h");
      expect(Object.keys(i).some((k) => k.includes("24"))).toBe(false);
    }
  });

  it("HUB-FR-60 · A06 · dòng agent: runtime, profile {id,key}, workflow_count, entitled_tenant_count, enabled [H4a-AC-02 · H4a-R11]", async () => {
    const r = await pa(x, "GET", "/agents");
    expect(r.status).toBe(200);
    expect(item(r, "co-quyen")).toMatchObject({
      id: AG4.access,
      runtime: "agentic-cli",
      enabled: true,
      version: 1,
      profile: { id: PROFILE.fake, key: "fake-1" },
      entitled_tenant_count: 1,
      workflow_count: 0,
    });
    expect(item(r, "tu-do")).toMatchObject({ entitled_tenant_count: 0 });
    expect(item(r, "trello")).toMatchObject({ workflow_count: 1 });
    expect(item(r, "llm-bot")).toMatchObject({ runtime: "llm" });
    expect(item(r, "dang-tat")).toMatchObject({ enabled: false });
  });

  it("HUB-FR-62 · A07 · badge Orchestrator: `orchestrator` default=true; `orch-beta4` tenant_ids=[beta]; agent khác không [H4a-AC-02]", async () => {
    const r = await pa(x, "GET", "/agents");
    expect(r.status).toBe(200);
    expect(item(r, "orchestrator")?.orchestrator_of).toEqual({ default: true, tenant_ids: [] });
    expect(item(r, "orch-beta4")?.orchestrator_of).toEqual({
      default: false,
      tenant_ids: [T.beta],
    });
    expect(item(r, "tu-do")?.orchestrator_of).toEqual({ default: false, tenant_ids: [] });
  });

  it("HUB-FR-60 · A08 · lọc runtime=llm, enabled=false, q theo key/tên ⇒ đúng tập [H4a-R11]", async () => {
    const keys = async (q: string) =>
      ((await pa(x, "GET", `/agents${q}`)).json?.items ?? [])
        .map((i: { key: string }) => i.key)
        .sort();
    expect(await keys("?runtime=llm")).toEqual(["llm-bot", "llmbot"]);
    expect(await keys("?enabled=false")).toEqual(["dang-tat"]);
    expect(await keys("?q=quyen")).toEqual(["co-quyen"]);
    expect(await keys("?q=Name%20tu-do")).toEqual(["tu-do"]);
  });

  it("HUB-FR-60 · A09 · query sai (limit 0 / 201, runtime lạ) ⇒ 400 VALIDATION_ERROR [plan §2.3]", async () => {
    for (const q of ["?limit=0", "?limit=201", "?runtime=java", "?enabled=yes"])
      expect([q, errOf(await pa(x, "GET", `/agents${q}`)).code]).toEqual([q, "VALIDATION_ERROR"]);
  });

  it("HUB-FR-60 · A10 · GET /agents/:id: id lạ/không uuid ⇒ 404 NOT_FOUND; agent có ⇒ 200 chi tiết + orchestrator_of [plan §3]", async () => {
    expect(errOf(await pa(x, "GET", `/agents/${NONE}`))).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(errOf(await pa(x, "GET", "/agents/abc"))).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    const r = await pa(x, "GET", `/agents/${AG.orchestrator}`);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      id: AG.orchestrator,
      key: "orchestrator",
      version: 1,
      workflow_ids: [],
    });
    expect(r.json.orchestrator_of).toEqual({ default: true, tenant_ids: [] });
  });

  it("HUB-FR-64 · A11 · GET /agents/:id agent có workflow ⇒ workflow_ids + workflows ghép catalog (key, app_type, enabled) [plan §2.3 E2]", async () => {
    const r = await pa(x, "GET", `/agents/${AG.hoadon}`);
    expect(r.status).toBe(200);
    expect([...r.json.workflow_ids].sort()).toEqual([WF.checkInvoice, WF.tat].sort());
    const wf = r.json.workflows.find((w: { id: string }) => w.id === WF.tat);
    expect(wf).toMatchObject({ key: "tat", app_type: "workflow", enabled: false });
  });
});

describe("A12–A19 · đọc catalog [HUB-FR-64 · HUB-FR-62 · H4a-AC-05, AC-10 · H4a-R04, R13]", () => {
  it("HUB-FR-64 · A12 · GET /workflows ⇒ chỉ workflow bật (không `tat`), usable_for đúng app/input [H4a-AC-05 · H4a-R04 · QB3]", async () => {
    const r = await pa(x, "GET", "/workflows");
    expect(r.status).toBe(200);
    const by = (k: string) => r.json.items.find((i: { key: string }) => i.key === k);
    expect(by("tat")).toBeUndefined();
    expect(r.json.items.every((i: { id: string }) => i.id !== WF.tat)).toBe(true);
    expect(by("tom")?.usable_for).toEqual(expect.arrayContaining(["tool", "dify-workflow"]));
    expect(by("tom")?.usable_for).not.toContain("dify-agent");
    expect(by("hoi")?.usable_for).toEqual(expect.arrayContaining(["dify-agent"]));
    expect(by("tro-ly")?.usable_for).toEqual(expect.arrayContaining(["dify-agent"]));
    expect(by("so")?.usable_for ?? []).not.toContain("dify-workflow");
    expect(by("tom")).toMatchObject({ id: WF.tom, app_type: "workflow" });
  });

  it("HUB-FR-64 · A13 · GET /workflows?app_type=chat ⇒ chỉ chat; ?limit=201 ⇒ 400 [plan §2.5]", async () => {
    const r = await pa(x, "GET", "/workflows?app_type=chat");
    expect(r.status).toBe(200);
    expect(r.json.items.map((i: { key: string }) => i.key)).toEqual(["hoi"]);
    expect(errOf(await pa(x, "GET", "/workflows?limit=201")).code).toBe("VALIDATION_ERROR");
  });

  it("HUB-FR-62 · A14 · GET /tenants ⇒ acme active, zeta active=false, has_orchestrator beta=true acme=false [H4a-R07]", async () => {
    const r = await pa(x, "GET", "/tenants");
    expect(r.status).toBe(200);
    const by = (k: string) => r.json.items.find((i: { key: string }) => i.key === k);
    expect(by("acme")).toMatchObject({ id: T.acme, active: true, has_orchestrator: false });
    expect(by("beta")).toMatchObject({ id: T.beta, has_orchestrator: true });
    expect(by("zeta")).toMatchObject({ id: T.zeta, active: false });
  });

  it("HUB-FR-90 · A15 · GET /agent-types ⇒ py-report available, py-old available=false, config_schema nguyên [plan §2.5]", async () => {
    const r = await pa(x, "GET", "/agent-types");
    expect(r.status).toBe(200);
    const by = (k: string) => r.json.items.find((i: { key: string }) => i.key === k);
    expect(by(AGENT_TYPE.py)).toMatchObject({ runtime: "python", available: true, version: 1 });
    expect(by(AGENT_TYPE.py)?.config_schema).toEqual({
      type: "object",
      properties: { sheet: { type: "string" } },
    });
    expect(by(AGENT_TYPE.pyOff)).toMatchObject({ available: false });
  });

  it("HUB-FR-60 · A16 · GET /model-profiles ⇒ fake-1, claude-sub-1 kèm steps [plan §2.5]", async () => {
    const r = await pa(x, "GET", "/model-profiles");
    expect(r.status).toBe(200);
    const by = (k: string) => r.json.items.find((i: { key: string }) => i.key === k);
    expect(by("fake-1")).toMatchObject({ id: PROFILE.fake, steps: [{ provider_key: "fake-cli" }] });
    expect(by("claude-sub-1")).toMatchObject({ id: PROFILE.claude });
  });

  it("HUB-FR-68 · A17 · GET /providers ⇒ has_secret bool, KHÔNG secret_id/ciphertext/last_error/iv ở bất kỳ đâu [H4a-AC-10 · H4a-R13]", async () => {
    const [sec] = await x.sql<{ id: string }[]>`select id from admin.secrets limit 1`;
    if (sec)
      await x.sql`update hub.providers set secret_id = ${sec.id} where key = 'claude-sub'`.catch(
        () => {},
      );
    const r = await pa(x, "GET", "/providers");
    expect(r.status).toBe(200);
    expect(r.json.items.length).toBeGreaterThanOrEqual(2);
    for (const p of r.json.items) {
      expect(typeof p.has_secret).toBe("boolean");
      for (const k of ["secret_id", "ciphertext", "iv", "last_error", "last4"])
        expect(Object.keys(p)).not.toContain(k);
    }
    for (const s of ["secret_id", "ciphertext", "last_error", '"iv"'])
      expect(r.text).not.toContain(s);
    if (sec) expect(r.text).not.toContain(sec.id);
  });

  it("HUB-FR-60 · A18 · catalog query sai (q rỗng 101 ký tự, limit 201) ⇒ 400 ở cả 5 endpoint [plan §2.5]", async () => {
    for (const p of ["/agent-types", "/model-profiles", "/providers", "/workflows", "/tenants"]) {
      expect([p, errOf(await pa(x, "GET", `${p}?limit=201`)).code]).toEqual([
        p,
        "VALIDATION_ERROR",
      ]);
      expect([p, errOf(await pa(x, "GET", `${p}?q=${"a".repeat(101)}`)).code]).toEqual([
        p,
        "VALIDATION_ERROR",
      ]);
    }
  });

  it("HUB-FR-62 · A19 · GET /orchestrator ⇒ default (agent orchestrator, agentic_cli_slow) + tenants [beta] [H4a-R07, R08]", async () => {
    const r = await pa(x, "GET", "/orchestrator");
    expect(r.status).toBe(200);
    expect(r.json.default).toMatchObject({
      tenant: null,
      agent: { id: AG.orchestrator, key: "orchestrator", runtime: "agentic-cli", enabled: true },
      max_steps: 5,
      token_budget: 200_000,
      history_n: 10,
      on_no_match: "answer",
      warnings: ["agentic_cli_slow"],
    });
    expect(r.json.tenants).toHaveLength(1);
    expect(r.json.tenants[0]).toMatchObject({
      tenant: { id: T.beta, key: "beta" },
      agent: { id: AG4.orchBeta },
    });
    expect(r.json.hub_config_version).toBe(await versionOf(x.sql));
  });
});
