// HUB-FR-62 · HUB-FR-69 · HUB-BR-08 · H4a-AC-08 (vế API) · H4a-R07, R08, R09 · QB1, QB2, QB6 · test-plan H4a §3 A50–A62:
// Orchestrator mặc định (sửa, không xoá) + theo tenant (≤ 1/tenant, tenant tồn tại + active), agent phải bật và runtime
// ∈ ORCHESTRATOR_RUNTIMES = {agentic-cli} (QB1 mặc định), VERSION_CONFLICT, audit tenant (null | đích) + bump + NOTIFY.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { listenHub, type Notes } from "../H3b/_h3b";
import {
  AG,
  AG4,
  auditMax,
  auditSince,
  type Ctx,
  configState,
  errOf,
  NONE,
  orchBody,
  orchRow,
  pa,
  startH4a,
  T,
  USERS,
  versionOf,
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

async function expect0(
  p: Promise<{ status: number }> | (() => Promise<unknown>),
  status: number,
  code: string,
  details?: object,
) {
  const s0 = await configState(x.sql);
  const r = (await (typeof p === "function" ? p() : p)) as never;
  expect(errOf(r)).toMatchObject({ status, code });
  if (details) expect(errOf(r).details).toEqual(details);
  expect(await configState(x.sql)).toEqual(s0);
}
const putDefault = (body: object) => () => pa(x, "PUT", "/orchestrator/default", body);
const postTenant = (body: object) => () => pa(x, "POST", "/orchestrator/tenants", body);

describe("A50–A54 · Orchestrator mặc định [HUB-FR-62 · H4a-R07 · QB1]", () => {
  it("HUB-FR-62 · A50 · PUT default agent `llm-bot` (llm, bật) ⇒ 409 AGENT_NOT_ORCHESTRATABLE {reason: runtime_unsupported}; 0 ghi [QB1 mặc định · R-K1]", async () => {
    await expect0(
      putDefault({ ...orchBody(AG4.llmBot), version: 1 }),
      409,
      "AGENT_NOT_ORCHESTRATABLE",
      {
        reason: "runtime_unsupported",
      },
    );
  });

  it("HUB-FR-62 · A51 · agent tắt ⇒ 409 {reason: disabled}; agent không tồn tại ⇒ 400 INVALID_REFERENCE {field: agent_id} [H4a-R07]", async () => {
    await expect0(
      putDefault({ ...orchBody(AG4.off), version: 1 }),
      409,
      "AGENT_NOT_ORCHESTRATABLE",
      {
        reason: "disabled",
      },
    );
    const r = await pa(x, "PUT", "/orchestrator/default", { ...orchBody(NONE), version: 1 });
    expect(errOf(r)).toMatchObject({ status: 400, code: "INVALID_REFERENCE" });
    expect(errOf(r).details).toMatchObject({ field: "agent_id" });
  });

  it("HUB-FR-62 · A52 · biên (QB2 theo DB): max_steps 0/21, token_budget 999, history_n 0/51, on_no_match lạ ⇒ 400 VALIDATION_ERROR [H4a-R07 · QB2]", async () => {
    const bad = [
      { max_steps: 0 },
      { max_steps: 21 },
      { token_budget: 999 },
      { history_n: 0 },
      { history_n: 51 },
      { on_no_match: "skip" },
    ];
    for (const o of bad)
      await expect0(
        putDefault({ ...orchBody(AG.orchestrator, o), version: 1 }),
        400,
        "VALIDATION_ERROR",
      );
  });

  it("HUB-FR-69 · A53 · PUT default hợp lệ (max_steps 20, history_n 50, ask) ⇒ 200 v2; audit update tenant null, entity_name orchestrator:default; bump; NOTIFY; version cũ lần 2 ⇒ 409 VERSION_CONFLICT [H4a-R09 · QB6]", async () => {
    const v0 = await versionOf(x.sql);
    const a0 = await auditMax(x.sql);
    const m = n.mark();
    const body = {
      ...orchBody(AG.orchestrator, { max_steps: 20, history_n: 50, on_no_match: "ask" }),
      version: 1,
    };
    const r = await pa(x, "PUT", "/orchestrator/default", body);
    expect(r.status).toBe(200);
    expect(r.json.hub_config_version).toBe(v0 + 1);
    expect(r.json.orchestrator).toMatchObject({
      tenant: null,
      max_steps: 20,
      history_n: 50,
      on_no_match: "ask",
      version: 2,
      updated_by: USERS.padmin.id,
      warnings: ["agentic_cli_slow"],
    });
    expect(await orchRow(x.sql, null)).toMatchObject({ max_steps: 20, version: 2 });
    const au = await auditSince(x.sql, a0);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({
      entity: "orchestrator",
      action: "update",
      entity_name: "orchestrator:default",
      tenant_id: null,
      hub_config_version: v0 + 1,
    });
    await n.sentinel();
    expect(n.since(m)).toEqual([expect.objectContaining({ version: v0 + 1 })]);
    const again = await pa(x, "PUT", "/orchestrator/default", {
      ...orchBody(AG.orchestrator),
      version: 1,
    });
    expect(errOf(again)).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(errOf(again).details?.current).toMatchObject({ version: 2, max_steps: 20 });
  });

  it("HUB-FR-62 · A54 · DELETE default ⇒ 409 ORCHESTRATOR_DEFAULT_PROTECTED (có/không ?version); hàng còn [H4a-R07]", async () => {
    await expect0(
      () => pa(x, "DELETE", "/orchestrator/default"),
      409,
      "ORCHESTRATOR_DEFAULT_PROTECTED",
    );
    await expect0(
      () => pa(x, "DELETE", "/orchestrator/default?version=2"),
      409,
      "ORCHESTRATOR_DEFAULT_PROTECTED",
    );
    expect(await orchRow(x.sql, null)).toBeDefined();
  });
});

describe("A55–A62 · Orchestrator theo tenant [HUB-FR-62 · H4a-AC-08 · H4a-R07 · CR-032]", () => {
  it("HUB-FR-62 · A55 · POST tenant acme agent tu-do ⇒ 201 (tenant {id,key,name}, v1); audit create tenant_id = acme, entity_name orchestrator:acme; bump [H4a-AC-08 · QB6]", async () => {
    const v0 = await versionOf(x.sql);
    const a0 = await auditMax(x.sql);
    const r = await pa(x, "POST", "/orchestrator/tenants", {
      ...orchBody(AG4.free, { max_steps: 3 }),
      tenant_id: T.acme,
    });
    expect(r.status).toBe(201);
    expect(r.json.orchestrator).toMatchObject({
      tenant: { id: T.acme, key: "acme", name: "Acme Corp" },
      agent: { id: AG4.free, key: "tu-do" },
      max_steps: 3,
      version: 1,
    });
    expect(r.json.hub_config_version).toBe(v0 + 1);
    expect(await orchRow(x.sql, T.acme)).toMatchObject({ agent_id: AG4.free, max_steps: 3 });
    const au = await auditSince(x.sql, a0);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({
      entity: "orchestrator",
      action: "create",
      tenant_id: T.acme,
      entity_name: "orchestrator:acme",
      before: null,
    });
  });

  it("HUB-FR-62 · A56 · POST acme lần 2 ⇒ 409 ORCHESTRATOR_EXISTS; 0 ghi [H4a-AC-08 · H4a-R07]", async () => {
    await expect0(
      postTenant({ ...orchBody(AG4.free), tenant_id: T.acme }),
      409,
      "ORCHESTRATOR_EXISTS",
    );
  });

  it("HUB-FR-62 · A57 · tenant zeta (active=false) ⇒ 409 TENANT_INACTIVE; tenant không có ⇒ 400 INVALID_REFERENCE {tenant_id} [H4a-R07 · E8]", async () => {
    await expect0(postTenant({ ...orchBody(AG4.free), tenant_id: T.zeta }), 409, "TENANT_INACTIVE");
    const r = await pa(x, "POST", "/orchestrator/tenants", {
      ...orchBody(AG4.free),
      tenant_id: NONE,
    });
    expect(errOf(r)).toMatchObject({ status: 400, code: "INVALID_REFERENCE" });
    expect(errOf(r).details).toMatchObject({ field: "tenant_id" });
  });

  it("HUB-FR-62 · A58 · tenant gamma + agent llm ⇒ 409 AGENT_NOT_ORCHESTRATABLE {runtime_unsupported}; agent tắt ⇒ {disabled} [QB1]", async () => {
    await expect0(
      postTenant({ ...orchBody(AG4.llmBot), tenant_id: T.gamma }),
      409,
      "AGENT_NOT_ORCHESTRATABLE",
      {
        reason: "runtime_unsupported",
      },
    );
    await expect0(
      postTenant({ ...orchBody(AG4.off), tenant_id: T.gamma }),
      409,
      "AGENT_NOT_ORCHESTRATABLE",
      {
        reason: "disabled",
      },
    );
  });

  it("HUB-FR-62 · A59 · GET /orchestrator ⇒ tenants sắp theo tenant.key: [acme, beta] [plan §2.4]", async () => {
    const r = await pa(x, "GET", "/orchestrator");
    expect(r.status).toBe(200);
    expect(r.json.tenants.map((t: { tenant: { key: string } }) => t.tenant.key)).toEqual([
      "acme",
      "beta",
    ]);
  });

  it("HUB-FR-69 · A60 · PUT tenants/acme version cũ ⇒ 409 VERSION_CONFLICT; đúng ⇒ 200 v2; tenant chưa có bản (gamma) ⇒ 404 [H4a-R09]", async () => {
    await expect0(
      () => pa(x, "PUT", `/orchestrator/tenants/${T.acme}`, { ...orchBody(AG4.free), version: 5 }),
      409,
      "VERSION_CONFLICT",
    );
    const r = await pa(x, "PUT", `/orchestrator/tenants/${T.acme}`, {
      ...orchBody(AG4.free, { max_steps: 4 }),
      version: 1,
    });
    expect(r.status).toBe(200);
    expect(r.json.orchestrator).toMatchObject({ max_steps: 4, version: 2 });
    const g = await pa(x, "PUT", `/orchestrator/tenants/${T.gamma}`, {
      ...orchBody(AG4.free),
      version: 1,
    });
    expect(errOf(g)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("HUB-FR-62 · A61 · tắt/xoá agent đang là Orchestrator tenant acme ⇒ 409 AGENT_IN_USE_AS_ORCHESTRATOR {scopes: acme} [H4a-AC-07 · H4a-R06]", async () => {
    const r = await pa(x, "PATCH", `/agents/${AG4.free}/enabled`, { enabled: false, version: 1 });
    expect(errOf(r)).toMatchObject({ status: 409, code: "AGENT_IN_USE_AS_ORCHESTRATOR" });
    expect(errOf(r).details).toEqual({ scopes: [{ tenant_id: T.acme, tenant_key: "acme" }] });
  });

  it("HUB-FR-62 · A62 · DELETE tenants/acme ?version sai ⇒ 409; đúng ⇒ 204, hàng mất, audit delete tenant acme; lần 2 ⇒ 404 [H4a-R07, R09]", async () => {
    await expect0(
      () => pa(x, "DELETE", `/orchestrator/tenants/${T.acme}?version=1`),
      409,
      "VERSION_CONFLICT",
    );
    const a0 = await auditMax(x.sql);
    const r = await pa(x, "DELETE", `/orchestrator/tenants/${T.acme}?version=2`);
    expect(r.status).toBe(204);
    expect(await orchRow(x.sql, T.acme)).toBeUndefined();
    const au = await auditSince(x.sql, a0);
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: "delete", tenant_id: T.acme, after: null });
    const again = await pa(x, "DELETE", `/orchestrator/tenants/${T.acme}?version=2`);
    expect(errOf(again)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
