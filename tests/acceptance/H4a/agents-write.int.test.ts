// HUB-FR-60 · HUB-FR-61 · HUB-FR-64 · HUB-FR-69 · H4a-AC-03…07 · H4a-R03…R06, R09 · QB2–QB5 · test-plan H4a §3 A20–A49:
// tạo/sửa/bật-tắt/xoá agent qua `/studio/api/agents`: validate (QB2 theo CHECK DB), tham chiếu workflow/profile/agent_type,
// Bash ack, VERSION_CONFLICT, chặn tắt/xoá (Orchestrator → lịch sử → quyền), ghi an toàn audit + bump + NOTIFY một
// transaction (audit lỗi ⇒ rollback), audit `tenant_id` NULL (QB6), kiểm lịch sử dưới scope system (R-K2).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { HubX } from "../H1/_hub";
import { startHubH2b } from "../H2b/_h2b";
import { failingAudit, listenHub, type Notes } from "../H3b/_h3b";
import {
  AG,
  AG4,
  AGENT_TYPE,
  agentByKey,
  agentRow,
  agentWfIds,
  auditMax,
  auditSince,
  CLI_OPTS,
  type Ctx,
  cliBody,
  configState,
  difyBody,
  errOf,
  llmBody,
  NONE,
  PROFILE,
  pa,
  putOf,
  startH4a,
  T,
  USERS,
  versionOf,
  WF,
} from "./_h4a";

let x: Ctx;
let n: Notes;
beforeAll(async () => {
  x = await startH4a();
  n = await listenHub();
}, 60_000);
afterAll(async () => {
  await n?.close();
  await x?.stop();
});

/** POST phải lỗi `code` (+ details khớp một phần) và 0 ghi (state + không NOTIFY). */
async function expectRejected(body: unknown, status: number, code: string, details?: unknown) {
  const s0 = await configState(x.sql);
  const m = n.mark();
  const r = await pa(x, "POST", "/agents", body);
  expect(errOf(r)).toMatchObject({ status, code });
  if (details !== undefined) expect(errOf(r).details).toMatchObject(details as object);
  await n.sentinel();
  expect(n.since(m)).toEqual([]);
  expect(await configState(x.sql)).toEqual(s0);
}

describe("A20–A23 · tạo agent llm [HUB-FR-60 · HUB-FR-69 · H4a-AC-03 · H4a-R03, R09]", () => {
  it("HUB-FR-69 · A20 · POST llm hợp lệ ⇒ 201 {agent v1, hub_config_version+1}; audit create (before null, tenant null) cùng version; NOTIFY ≤ 1 s [H4a-AC-03 · H4a-R09 · QB6]", async () => {
    const v0 = await versionOf(x.sql);
    const a0 = await auditMax(x.sql);
    const m = n.mark();
    const t0 = Date.now();
    const r = await pa(x, "POST", "/agents", llmBody("qc-llm-1"));
    expect(r.status).toBe(201);
    expect(r.json.hub_config_version).toBe(v0 + 1);
    expect(r.json.agent).toMatchObject({
      key: "qc-llm-1",
      runtime: "llm",
      profile_id: PROFILE.fake,
      version: 1,
      enabled: true,
      timeout_s: 600,
      token_budget: null,
      workflow_ids: [],
    });
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    const au = await auditSince(x.sql, a0);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({
      entity: "agent",
      action: "create",
      entity_id: r.json.agent.id,
      entity_name: "qc-llm-1",
      tenant_id: null,
      before: null,
      actor_id: USERS.padmin.id,
      actor_role: "platform_admin",
      hub_config_version: v0 + 1,
    });
    expect(au[0].after).toMatchObject({ key: "qc-llm-1", runtime: "llm" });
    await n.sentinel();
    const msgs = n.since(m);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ version: v0 + 1 });
    expect((n.at(m)[0] ?? Number.POSITIVE_INFINITY) - t0).toBeLessThanOrEqual(1_000);
  });

  it("HUB-FR-60 · A21 · agent vừa tạo có trong GET /agents (entitled_tenant_count 0) [H4a-AC-03]", async () => {
    const r = await pa(x, "GET", "/agents?q=qc-llm-1");
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(1);
    expect(r.json.items[0]).toMatchObject({
      key: "qc-llm-1",
      entitled_tenant_count: 0,
      runtime: "llm",
    });
  });

  it("HUB-FR-60 · A22 · thiếu name.en ⇒ 400 VALIDATION_ERROR, issues chỉ đúng path [name, en]; 0 ghi [H4a-AC-03 · H4a-R03]", async () => {
    const b = llmBody("qc-thieu-en", { name: { vi: "Chỉ có tiếng Việt" } });
    await expectRejected(b, 400, "VALIDATION_ERROR");
    const r = await pa(x, "POST", "/agents", b);
    const paths = (errOf(r).details?.issues ?? []).map((i: { path: unknown[] }) =>
      i.path.join("."),
    );
    expect(paths).toContain("name.en");
  });

  it("HUB-FR-60 · A23 · KEY_TAKEN: key `assistant` đã có ⇒ 409 {field: key}; 0 ghi [plan §2.1 E8]", async () => {
    await expectRejected(llmBody("assistant"), 409, "KEY_TAKEN", { field: "key" });
  });
});

describe("A24–A27 · validate theo CHECK DB [HUB-FR-60 · H4a-R03 · QB2 mặc định]", () => {
  // QB2 mặc định: contract theo CHECK DB (key không `_`, 2–48; mô tả 20–400; timeout 10–3600). Đổi QB2 ⇒ sửa các ca này.
  const bad: [string, unknown][] = [
    ["key có `_` (QB2)", llmBody("qc_gach_duoi")],
    ["key chữ hoa", llmBody("QcHoa")],
    ["key 1 ký tự", llmBody("q")],
    ["key 49 ký tự", llmBody(`q${"a".repeat(48)}`)],
    ["mô tả 19 ký tự (QB2)", llmBody("qc-mota", { description: "a".repeat(19) })],
    ["mô tả 401 ký tự", llmBody("qc-mota", { description: "a".repeat(401) })],
    ["timeout_s 9 (QB2)", llmBody("qc-to", { timeout_s: 9 })],
    ["timeout_s 3601", llmBody("qc-to", { timeout_s: 3601 })],
    ["token_budget 0", llmBody("qc-tb", { token_budget: 0 })],
    ["llm thiếu profile_id", llmBody("qc-np", { profile_id: undefined })],
    ["agentic-cli thiếu profile_id", cliBody("qc-np2", { profile_id: null })],
    ["dify-workflow 2 workflow", difyBody("qc-dify-2", "dify-workflow", [WF.tom, WF.dich])],
    ["dify-workflow 0 workflow", difyBody("qc-dify-0", "dify-workflow", [])],
    ["cli lạ", cliBody("qc-cli", { runtime_options: { ...CLI_OPTS, cli: "cursor" } })],
    [
      "tool lạ",
      cliBody("qc-tool", { runtime_options: { ...CLI_OPTS, allowed_tools: ["Read", "WebFetch"] } }),
    ],
    ["trường lạ (strict)", llmBody("qc-strict", { foo: 1 })],
  ];
  for (const [what, b] of bad)
    it(`HUB-FR-60 · A24 · ${what} ⇒ 400 VALIDATION_ERROR, 0 ghi [H4a-R03 · QB2]`, async () => {
      await expectRejected(b, 400, "VALIDATION_ERROR");
    });

  it("HUB-FR-60 · A25 · biên hợp lệ: key 2 ký tự có `-`, mô tả 20/400, timeout 10/3600, token_budget 10⁷ ⇒ 201 [QB2]", async () => {
    const ok = [
      llmBody("q-", { description: "a".repeat(20), timeout_s: 10 }),
      llmBody("qc-bien-tren", {
        description: "b".repeat(400),
        timeout_s: 3600,
        token_budget: 10_000_000,
      }),
    ];
    for (const b of ok) expect((await pa(x, "POST", "/agents", b)).status).toBe(201);
  });

  it("HUB-FR-60 · A26 · profile_id không tồn tại ⇒ 400 INVALID_REFERENCE {field: profile_id}; 0 ghi [plan §5.2]", async () => {
    await expectRejected(llmBody("qc-prof", { profile_id: NONE }), 400, "INVALID_REFERENCE", {
      field: "profile_id",
    });
  });

  it("HUB-FR-90 · A27 · python: agent_type py-report ⇒ 201; py-old (available=false) / cli-tool (runtime lệch) / không có ⇒ 400 INVALID_REFERENCE {agent_type_key} [plan §5.2 · QB7]", async () => {
    const py = (key: string, t: string) => ({
      ...llmBody(key),
      runtime: "python",
      agent_type_key: t,
      runtime_options: { sheet: "A1", khong_kiem_schema: true },
    });
    const r = await pa(x, "POST", "/agents", py("qc-py", AGENT_TYPE.py));
    expect(r.status).toBe(201);
    expect(r.json.agent).toMatchObject({ runtime: "python", agent_type_key: AGENT_TYPE.py });
    expect(r.json.agent.warnings).toEqual(expect.arrayContaining([{ code: "runtime_not_ready" }]));
    for (const t of [AGENT_TYPE.pyOff, AGENT_TYPE.cli, "khong-co"])
      await expectRejected(py(`qc-py-${t}`, t), 400, "INVALID_REFERENCE", {
        field: "agent_type_key",
      });
  });
});

describe("A28–A32 · workflow [HUB-FR-64 · H4a-AC-05 · H4a-R04 · QB3, QB4]", () => {
  it("HUB-FR-64 · A28 · llm gắn workflow tắt `tat` ⇒ 400 INVALID_REFERENCE {workflow_ids, disabled}; không tồn tại ⇒ not_found; 0 ghi [H4a-AC-05]", async () => {
    await expectRejected(
      llmBody("qc-wf-tat", { workflow_ids: [WF.tat] }),
      400,
      "INVALID_REFERENCE",
      {
        field: "workflow_ids",
        reason: "disabled",
      },
    );
    await expectRejected(
      llmBody("qc-wf-none", { workflow_ids: [WF.tom, NONE] }),
      400,
      "INVALID_REFERENCE",
      {
        field: "workflow_ids",
        reason: "not_found",
        ids: [NONE],
      },
    );
  });

  it("HUB-FR-64 · A29 · dify-workflow gắn app chat ⇒ app_type; gắn `so` (không có input text) ⇒ no_input; 0 ghi [H4a-R04 · QB3]", async () => {
    await expectRejected(
      difyBody("qc-dw-chat", "dify-workflow", [WF.hoi]),
      400,
      "INVALID_REFERENCE",
      {
        reason: "app_type",
      },
    );
    await expectRejected(difyBody("qc-dw-so", "dify-workflow", [WF.so]), 400, "INVALID_REFERENCE", {
      reason: "no_input",
    });
    await expectRejected(difyBody("qc-da-wf", "dify-agent", [WF.tom]), 400, "INVALID_REFERENCE", {
      reason: "app_type",
    });
  });

  it("HUB-FR-64 · A30 · dify-workflow `tom` ⇒ 201; profile_id null; runtime_options.workflow_key=tom; agent_workflows 1 dòng [H4a-AC-05 · QB3, QB4]", async () => {
    const r = await pa(x, "POST", "/agents", difyBody("qc-dify-tom", "dify-workflow", [WF.tom]));
    expect(r.status).toBe(201);
    expect(r.json.agent).toMatchObject({ profile_id: null, workflow_ids: [WF.tom] });
    const row = await agentByKey(x.sql, "qc-dify-tom");
    expect(row).toMatchObject({ profile_id: null, runtime_options: { workflow_key: "tom" } });
    expect(await agentWfIds(x.sql, row?.id)).toEqual([WF.tom]);
  });

  it("HUB-FR-64 · A31 · dify-agent nhận app chat (`hoi`) và agent (`tro-ly`) ⇒ 201 [QB3]", async () => {
    expect(
      (await pa(x, "POST", "/agents", difyBody("qc-da-hoi", "dify-agent", [WF.hoi]))).status,
    ).toBe(201);
    expect(
      (await pa(x, "POST", "/agents", difyBody("qc-da-trol", "dify-agent", [WF.troLy]))).status,
    ).toBe(201);
  });

  it("HUB-FR-64 · A32 · llm 2 workflow ⇒ 201, agent_workflows 2 dòng; PUT bỏ 1 ⇒ còn 1 dòng [H4a-R04]", async () => {
    const r = await pa(
      x,
      "POST",
      "/agents",
      llmBody("qc-llm-wf", { workflow_ids: [WF.dich, WF.tom] }),
    );
    expect(r.status).toBe(201);
    const id = r.json.agent.id;
    expect(await agentWfIds(x.sql, id)).toEqual([WF.dich, WF.tom].sort());
    const u = await pa(
      x,
      "PUT",
      `/agents/${id}`,
      putOf(llmBody("qc-llm-wf", { workflow_ids: [WF.tom] }), 1),
    );
    expect(u.status).toBe(200);
    expect(u.json.agent.version).toBe(2);
    expect(await agentWfIds(x.sql, id)).toEqual([WF.tom]);
  });
});

describe("A33–A36 · Bash ack + cảnh báo [HUB-FR-61 · H4a-AC-06 · H4a-R05 · QB7]", () => {
  const bashOpts = { ...CLI_OPTS, allowed_tools: ["Read", "Bash"] };

  it("HUB-FR-61 · A33 · agentic-cli chọn Bash không bash_ack ⇒ 422 BASH_ACK_REQUIRED; bash_ack false cũng vậy; 0 ghi [H4a-AC-06]", async () => {
    await expectRejected(
      cliBody("qc-bash", { runtime_options: bashOpts }),
      422,
      "BASH_ACK_REQUIRED",
    );
    await expectRejected(
      cliBody("qc-bash", { runtime_options: bashOpts, bash_ack: false }),
      422,
      "BASH_ACK_REQUIRED",
    );
  });

  it("HUB-FR-61 · A34 · có bash_ack ⇒ 201; audit summary.bash_ack = true; warnings tools_not_supported [Bash] [H4a-AC-06 · QB7]", async () => {
    const a0 = await auditMax(x.sql);
    const r = await pa(
      x,
      "POST",
      "/agents",
      cliBody("qc-bash", { runtime_options: bashOpts, bash_ack: true }),
    );
    expect(r.status).toBe(201);
    expect(r.json.agent.runtime_options.allowed_tools).toEqual(["Read", "Bash"]);
    expect(r.json.agent.warnings).toEqual(
      expect.arrayContaining([{ code: "tools_not_supported", tools: ["Bash"] }]),
    );
    const [au] = await auditSince(x.sql, a0, { action: "create" });
    expect(au?.summary).toMatchObject({ bash_ack: true });
  });

  it("HUB-FR-61 · A35 · PUT agent đã có Bash (co-bash) giữ Bash, không ack ⇒ 200; PUT thêm Bash cho agent chưa có, không ack ⇒ 422 [H4a-R05 needsBashAck]", async () => {
    const keep = putOf(cliBody("co-bash", { runtime_options: bashOpts }), 1);
    expect((await pa(x, "PUT", `/agents/${AG4.bash}`, keep)).status).toBe(200);
    const add = putOf(cliBody("tu-do", { runtime_options: bashOpts }), 1);
    const r = await pa(x, "PUT", `/agents/${AG4.free}`, add);
    expect(errOf(r)).toMatchObject({ status: 422, code: "BASH_ACK_REQUIRED" });
    expect((await agentRow(x.sql, AG4.free))?.version).toBe(1);
  });

  it("HUB-FR-61 · A36 · cli codex ⇒ 201 + warnings runtime_not_ready (Q8: lưu được, cảnh báo) [H4a-R05 · CR-041]", async () => {
    const r = await pa(
      x,
      "POST",
      "/agents",
      cliBody("qc-codex", { runtime_options: { ...CLI_OPTS, cli: "codex" } }),
    );
    expect(r.status).toBe(201);
    expect(r.json.agent.warnings).toEqual(expect.arrayContaining([{ code: "runtime_not_ready" }]));
  });
});

describe("A37–A41 · sửa + xung đột phiên bản [HUB-FR-69 · H4a-AC-04 · H4a-R09 · QB5]", () => {
  it("HUB-FR-69 · A37 · hai tab cùng version 1: tab 1 PUT ⇒ 200 v2; tab 2 PUT version 1 ⇒ 409 VERSION_CONFLICT {current = bản tab 1}; DB giữ tab 1 [H4a-AC-04]", async () => {
    const c = await pa(x, "POST", "/agents", cliBody("qc-hai-tab"));
    expect(c.status).toBe(201);
    const id = c.json.agent.id;
    const t1 = await pa(
      x,
      "PUT",
      `/agents/${id}`,
      putOf(cliBody("qc-hai-tab", { system_prompt: "TAB-1" }), 1),
    );
    expect(t1.status).toBe(200);
    expect(t1.json.agent).toMatchObject({ version: 2, system_prompt: "TAB-1" });
    const s0 = await configState(x.sql);
    const t2 = await pa(
      x,
      "PUT",
      `/agents/${id}`,
      putOf(cliBody("qc-hai-tab", { system_prompt: "TAB-2" }), 1),
    );
    expect(errOf(t2)).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(errOf(t2).details?.current).toMatchObject({ id, version: 2, system_prompt: "TAB-1" });
    expect(typeof errOf(t2).details?.updated_at).toBe("string");
    expect(await configState(x.sql)).toEqual(s0);
  });

  it("HUB-FR-69 · A38 · PUT thành công ⇒ audit update (before v1 / after v2, summary.fields chứa system_prompt), bump, NOTIFY [H4a-R09]", async () => {
    const c = await pa(x, "POST", "/agents", cliBody("qc-sua"));
    expect(c.status).toBe(201);
    const v0 = await versionOf(x.sql);
    const a0 = await auditMax(x.sql);
    const m = n.mark();
    const r = await pa(
      x,
      "PUT",
      `/agents/${c.json.agent.id}`,
      putOf(cliBody("qc-sua", { system_prompt: "MOI" }), 1),
    );
    expect(r.status).toBe(200);
    expect(r.json.hub_config_version).toBe(v0 + 1);
    const au = await auditSince(x.sql, a0);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({
      action: "update",
      entity: "agent",
      tenant_id: null,
      hub_config_version: v0 + 1,
    });
    expect(au[0].before).toMatchObject({ version: 1 });
    expect(au[0].after).toMatchObject({ version: 2, system_prompt: "MOI" });
    expect(au[0].summary.fields).toContain("system_prompt");
    await n.sentinel();
    expect(n.since(m)).toEqual([expect.objectContaining({ version: v0 + 1 })]);
  });

  it("HUB-FR-60 · A39 · PUT gửi key hoặc runtime ⇒ 400 VALIDATION_ERROR (bất biến, QB5); agent lạ ⇒ 404 [plan P10]", async () => {
    const b = putOf(cliBody("tu-do"), 1);
    expect(errOf(await pa(x, "PUT", `/agents/${AG4.free}`, { ...b, key: "doi-key" })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errOf(await pa(x, "PUT", `/agents/${AG4.free}`, { ...b, runtime: "llm" })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errOf(await pa(x, "PUT", `/agents/${NONE}`, b))).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    expect((await agentRow(x.sql, AG4.free))?.key).toBe("tu-do");
  });

  it("HUB-FR-69 · A40 · PATCH enabled: version cũ ⇒ 409 VERSION_CONFLICT; đúng ⇒ 200 v+1, audit disable rồi enable [H4a-R09]", async () => {
    const c = await pa(x, "POST", "/agents", cliBody("qc-bat-tat"));
    expect(c.status).toBe(201);
    const id = c.json.agent.id;
    expect(
      errOf(await pa(x, "PATCH", `/agents/${id}/enabled`, { enabled: false, version: 7 })).code,
    ).toBe("VERSION_CONFLICT");
    const a0 = await auditMax(x.sql);
    const off = await pa(x, "PATCH", `/agents/${id}/enabled`, { enabled: false, version: 1 });
    expect(off.status).toBe(200);
    expect(off.json.agent).toMatchObject({ enabled: false, version: 2 });
    const on = await pa(x, "PATCH", `/agents/${id}/enabled`, { enabled: true, version: 2 });
    expect(on.json.agent).toMatchObject({ enabled: true, version: 3 });
    expect((await auditSince(x.sql, a0)).map((a) => a.action)).toEqual(["disable", "enable"]);
  });

  it("HUB-FR-69 · A41 · audit lỗi giữa transaction ⇒ 500, rollback cả gói (không agent, không bump, không NOTIFY) [H4a-R09 · plan P7]", async () => {
    const audit = failingAudit(["create"]);
    const hub2: HubX = await startHubH2b(x.k, {
      instanceId: "qc-hub-h4a-audit",
      hubAudit: audit,
    } as never);
    try {
      const s0 = await configState(x.sql);
      const m = n.mark();
      const r = await pa({ ...x, hub: hub2 }, "POST", "/agents", cliBody("qc-audit-loi"));
      expect(r.status).toBe(500);
      expect(audit.calls).toEqual(["create"]);
      await n.sentinel();
      expect(n.since(m)).toEqual([]);
      expect(await configState(x.sql)).toEqual(s0);
      expect(await agentByKey(x.sql, "qc-audit-loi")).toBeUndefined();
    } finally {
      await hub2.stop();
    }
  });
});

describe("A42–A49 · chặn tắt/xoá [HUB-FR-60 · H4a-AC-07 · H4a-R06 · R-K2]", () => {
  it("HUB-FR-62 · A42 · PATCH tắt Orchestrator mặc định ⇒ 409 AGENT_IN_USE_AS_ORCHESTRATOR {scopes:[{tenant_id:null}]}; 0 ghi [H4a-AC-07]", async () => {
    const s0 = await configState(x.sql);
    const r = await pa(x, "PATCH", `/agents/${AG.orchestrator}/enabled`, {
      enabled: false,
      version: 1,
    });
    expect(errOf(r)).toMatchObject({ status: 409, code: "AGENT_IN_USE_AS_ORCHESTRATOR" });
    expect(errOf(r).details).toEqual({ scopes: [{ tenant_id: null }] });
    expect(await configState(x.sql)).toEqual(s0);
  });

  it("HUB-FR-62 · A43 · tắt qua PUT (enabled=false) Orchestrator tenant beta ⇒ 409 {scopes:[{tenant_id: beta, tenant_key: beta}]} [H4a-R06 · plan §3]", async () => {
    const r = await pa(
      x,
      "PUT",
      `/agents/${AG4.orchBeta}`,
      putOf(cliBody("orch-beta4", { enabled: false }), 1),
    );
    expect(errOf(r)).toMatchObject({ status: 409, code: "AGENT_IN_USE_AS_ORCHESTRATOR" });
    expect(errOf(r).details).toEqual({ scopes: [{ tenant_id: T.beta, tenant_key: "beta" }] });
  });

  it("HUB-FR-60 · A44 · DELETE Orchestrator mặc định ⇒ 409 AGENT_IN_USE_AS_ORCHESTRATOR; agent còn [H4a-AC-07]", async () => {
    const r = await pa(x, "DELETE", `/agents/${AG.orchestrator}?version=1`);
    expect(errOf(r)).toMatchObject({ status: 409, code: "AGENT_IN_USE_AS_ORCHESTRATOR" });
    expect(await agentRow(x.sql, AG.orchestrator)).toBeDefined();
  });

  it("HUB-FR-60 · A45 · DELETE agent có run_steps ở tenant acme (actor platform) ⇒ 409 AGENT_HAS_HISTORY — kiểm dưới scope system [H4a-AC-07 · R-K2 · plan P6]", async () => {
    const s0 = await configState(x.sql);
    const r = await pa(x, "DELETE", `/agents/${AG4.hist}?version=1`);
    expect(errOf(r)).toMatchObject({ status: 409, code: "AGENT_HAS_HISTORY" });
    expect(await configState(x.sql)).toEqual(s0);
  });

  it("HUB-FR-60 · A46 · DELETE agent còn entitlement ⇒ 409 AGENT_HAS_ACCESS {entitlements:1, grants:0}; `assistant` (ent 2, grant) ⇒ grants > 0 [H4a-R06]", async () => {
    const r = await pa(x, "DELETE", `/agents/${AG4.access}?version=1`);
    expect(errOf(r)).toMatchObject({ status: 409, code: "AGENT_HAS_ACCESS" });
    expect(errOf(r).details).toEqual({ entitlements: 1, grants: 0 });
    const r2 = await pa(x, "DELETE", `/agents/${AG.assistant}?version=1`);
    expect(errOf(r2).code).toBe("AGENT_HAS_ACCESS");
    expect(errOf(r2).details.entitlements).toBe(2);
    expect(errOf(r2).details.grants).toBeGreaterThan(0);
  });

  it("HUB-FR-60 · A47 · thứ tự: version sai đi trước mọi chặn (agent có lịch sử, version 9) ⇒ VERSION_CONFLICT; thiếu ?version ⇒ 400 [plan §3]", async () => {
    expect(errOf(await pa(x, "DELETE", `/agents/${AG4.hist}?version=9`)).code).toBe(
      "VERSION_CONFLICT",
    );
    expect(errOf(await pa(x, "DELETE", `/agents/${AG4.hist}`)).code).toBe("VALIDATION_ERROR");
    expect(errOf(await pa(x, "DELETE", `/agents/${NONE}?version=1`)).code).toBe("NOT_FOUND");
  });

  it("HUB-FR-60 · A48 · DELETE agent tự do có workflow ⇒ 204; hàng + agent_workflows biến mất; audit delete (after null, tenant null) [H4a-R06 · R09]", async () => {
    const c = await pa(x, "POST", "/agents", llmBody("qc-xoa", { workflow_ids: [WF.tom] }));
    expect(c.status).toBe(201);
    const id = c.json.agent.id;
    const v0 = await versionOf(x.sql);
    const a0 = await auditMax(x.sql);
    const r = await pa(x, "DELETE", `/agents/${id}?version=1`);
    expect(r.status).toBe(204);
    expect(await agentRow(x.sql, id)).toBeUndefined();
    expect(await agentWfIds(x.sql, id)).toEqual([]);
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    const au = await auditSince(x.sql, a0);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: "delete", entity_id: id, tenant_id: null, after: null });
    expect(au[0].before).toMatchObject({ key: "qc-xoa" });
  });

  it("HUB-FR-69 · A49 · audit agent Studio không gắn tenant nào (tenant_id NULL) ⇒ đọc audit theo tenant acme/platform không thấy [QB6 · cách ly]", async () => {
    const [r] = await x.sql<{ n: number }[]>`select count(*)::int as n from hub.audit_log
      where entity = 'agent' and tenant_id is not null`;
    expect(r?.n).toBe(0);
    const [t] = await x.sql<{ n: number }[]>`select count(*)::int as n from hub.audit_log
      where entity = 'agent' and tenant_id = any(${x.sql.array([T.acme, T.platform], 2950)})`;
    expect(t?.n).toBe(0);
    const [all] = await x.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.audit_log where entity = 'agent'`;
    expect(all?.n).toBeGreaterThan(0);
  });
});
