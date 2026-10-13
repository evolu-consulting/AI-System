// HUB-FR-131 · HUB-BR-37 · HUB-BR-40 · K1-AC01 · Q2 · spec §3.2 "Kiểm tra kết nối" + plan §3.1 (10 bước, mã) · test-plan K1 §4
// A30–A47: `POST /studio/api/kh/tenants/:id/check` với KH GIẢ — KH lỗi vẫn 200 `status=error`; lưu `check_status/checked_at/
// check_result` không tăng `version`, không bump `hub_config_version`; audit `check` {status, codes}; 409 KH_NOT_CONFIGURED.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  auditMaxK1,
  auditSinceK1,
  type CtxK1,
  configVersion,
  errCode,
  K1,
  NONE,
  NS,
  PROJ,
  setBaseUrl,
  startK1,
  studio,
  T,
  tenantRow,
} from "./_k1";
import { DEFAULT_CAPS, deadOrigin } from "./_khfake";

let c: CtxK1;
let dead = "";
beforeAll(async () => {
  dead = await deadOrigin();
  c = await startK1({ seed: "secrets", extraOrigins: [dead] });
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

const need = () =>
  expect({ migration0029: c.k1, hubSecrets: c.sec }).toEqual({
    migration0029: true,
    hubSecrets: true,
  });
type P = { id: string; ro?: boolean };
/** Dọn + URL = KH giả + hàng acme (unchecked) với `secret`/`projects`; KH giả về mặc định. */
async function prep(
  o: { secret?: string | null; projects?: P[]; url?: string | null } = {},
): Promise<void> {
  need();
  await c.sql`delete from hub.kh_bindings`;
  await c.sql`delete from hub.kh_projects`;
  await c.sql`delete from hub.kh_tenants`;
  await setBaseUrl(c.sql, o.url === undefined ? c.kh.base : o.url);
  c.kh.reset();
  c.kh.set(NS.acme, {
    scenario: "ok",
    peopleLanes: false,
    retrievalLanes: undefined,
    projects: [PROJ.a, PROJ.b, PROJ.shared],
    keyspaces: [{ keyspace: "step", dims: ["role", "step"] }],
    manifestRev: 1,
    kind: "client",
    meNs: undefined,
  });
  await c.sql`insert into hub.kh_tenants (tenant_id, ns, secret_id) values
    (${T.acme}, ${NS.acme}, ${o.secret === undefined ? K1.secAcme : o.secret})`;
  for (const p of o.projects ?? [{ id: PROJ.a }, { id: PROJ.b }])
    await c.sql`insert into hub.kh_projects (tenant_id, project_id, read_only) values (${T.acme}, ${p.id}, ${p.ro ?? false})`;
}
const check = () => studio(c, "POST", `/tenants/${T.acme}/check`);
// biome-ignore lint/suspicious/noExplicitAny: thân response
const codes = (r: any, level: "error" | "warning") =>
  // biome-ignore lint/suspicious/noExplicitAny: item
  ((r.json?.items ?? []) as any[]).filter((i) => i.level === level).map((i) => i.code);
// biome-ignore lint/suspicious/noExplicitAny: thân response
const item = (r: any, code: string) =>
  (r.json?.items ?? []).find((i: { code: string }) => i.code === code);

describe("A30–A33 · KH hợp lệ ⇒ OK [K1-AC01]", () => {
  it("HUB-FR-131 · K1-AC01 · A30 · 10 bước đạt ⇒ 200 status ok, cảnh báo embedder luôn có; lưu hàng (ok, checked_at, keyspace_dims), version không đổi", async () => {
    await prep();
    const cv0 = await configVersion(c.sql);
    const r = await check();
    expect(r.status).toBe(200);
    expect(r.json?.status).toBe("ok");
    expect(codes(r, "error")).toEqual([]);
    expect(codes(r, "warning")).toContain("kh_embedder_multilingual");
    expect(r.json?.kh_version).toBe("v6.4");
    expect(r.json?.keyspace_dims).toEqual(["role", "step"]);
    const row = await tenantRow(c.sql, T.acme);
    expect([row?.check_status, row?.checked_at !== null, row?.version]).toEqual(["ok", true, 1]);
    expect(row?.check_result?.keyspace_dims).toEqual(["role", "step"]);
    expect(await configVersion(c.sql)).toBe(cv0);
  });
  it("HUB-BR-40 · A31 · thứ tự gọi: /health → /version → /v1/me KHÔNG token → token (client kh-ns-<ns>) → /v1/capabilities, /v1/me, manifest có Bearer", async () => {
    await prep();
    expect((await check()).status).toBe(200);
    const seq = c.kh.calls.map((x) => `${x.method} ${x.path}${x.token ? " +auth" : ""}`);
    expect(seq.slice(0, 4)).toEqual([
      "GET /health",
      "GET /version",
      "GET /v1/me",
      "POST /v1/token",
    ]);
    const tokenCall = c.kh.calls.find((x) => x.path === "/v1/token");
    expect(tokenCall?.body?.client_id).toBe(`kh-ns-${NS.acme}`);
    for (const p of ["/v1/capabilities", `/v1/${NS.acme}/manifest`])
      expect({ p, auth: c.kh.calls.some((x) => x.path === p && x.token !== null) }).toEqual({
        p,
        auth: true,
      });
    expect(c.kh.calls.filter((x) => x.path === "/v1/me").map((x) => x.token !== null)).toEqual([
      false,
      true,
    ]);
  });
  it("HUB-FR-131 · HUB-FR-69 · A32 · audit `check` · kh_tenant {status, codes}; không bump hub_config_version", async () => {
    await prep();
    const a0 = await auditMaxK1(c.sql);
    expect((await check()).status).toBe(200);
    const au = await auditSinceK1(c.sql, a0, "kh_tenant");
    expect(au.map((x) => [x.action, x.entity_name, x.tenant_id])).toEqual([
      ["check", `acme:${NS.acme}`, T.acme],
    ]);
    expect(au[0]?.summary).toMatchObject({ status: "ok" });
    expect(Array.isArray(au[0]?.summary?.codes)).toBe(true);
  });
  it("HUB-BR-40 · Q2 · K1-AC01 · A33 · people lanes bật + chỉ project riêng ⇒ OK", async () => {
    await prep();
    c.kh.set(NS.acme, { peopleLanes: null });
    const r = await check();
    expect([r.json?.status, codes(r, "error")]).toEqual(["ok", []]);
  });
});

describe("A34–A45 · lỗi nêu nguyên nhân [K1-AC01 · plan §3.1]", () => {
  it("HUB-BR-40 · Q2 · K1-AC01 · A34 · lanes bật + tenant có project dùng chung ⇒ error kh_people_lanes_on_shared {project_id}; hàng status error", async () => {
    await prep({ projects: [{ id: PROJ.a }, { id: PROJ.shared, ro: true }] });
    c.kh.set(NS.acme, { peopleLanes: true });
    const r = await check();
    expect(r.status).toBe(200);
    expect([r.json?.status, codes(r, "error")]).toEqual(["error", ["kh_people_lanes_on_shared"]]);
    expect(item(r, "kh_people_lanes_on_shared")?.params).toEqual({ project_id: PROJ.shared });
    expect((await tenantRow(c.sql, T.acme))?.check_status).toBe("error");
  });
  it("HUB-BR-40 · Q2 · A35 · retrieval.include_people_lanes=false ghi đè top-level true ⇒ OK với project dùng chung", async () => {
    await prep({ projects: [{ id: PROJ.shared, ro: true }] });
    c.kh.set(NS.acme, { peopleLanes: true, retrievalLanes: false });
    expect((await check()).json?.status).toBe("ok");
  });
  it("HUB-BR-40 · K1-AC01 · A36 · /v1/me kind=local ⇒ error kh_auth_disabled", async () => {
    await prep();
    c.kh.set(NS.acme, { kind: "local" });
    const r = await check();
    expect([r.json?.status, codes(r, "error")]).toEqual(["error", ["kh_auth_disabled"]]);
  });
  it("HUB-BR-40 · K1-AC01 · A37 · KH tắt xác thực, URL localhost (dev/test) ⇒ chỉ cảnh báo kh_auth_disabled_dev", async () => {
    await prep();
    c.kh.g.auth = "off";
    const r = await check();
    expect(codes(r, "warning")).toContain("kh_auth_disabled_dev");
    expect(codes(r, "error")).not.toContain("kh_auth_disabled");
  });
  it("HUB-BR-37 · A38 · base_url ngoài allowlist (env đổi sau khi lưu) ⇒ error kh_url_not_allowed, KH không nhận lời gọi nào", async () => {
    await prep({ url: "https://kh.example.com" });
    const r = await check();
    expect([r.status, r.json?.status, codes(r, "error")]).toEqual([
      200,
      "error",
      ["kh_url_not_allowed"],
    ]);
    expect(c.kh.calls).toEqual([]);
  });
  it("HUB-FR-131 · A39 · KH không nghe ⇒ kh_unreachable; /health 503 ⇒ kh_unreachable {status:503}", async () => {
    await prep({ url: dead });
    expect(codes(await check(), "error")).toEqual(["kh_unreachable"]);
    await prep();
    c.kh.g.health = 503;
    const r = await check();
    expect(codes(r, "error")).toEqual(["kh_unreachable"]);
    expect(item(r, "kh_unreachable")?.params).toEqual({ status: 503 });
  });
  it("HUB-FR-131 · A40 · /version v6.3 ⇒ kh_version_too_old {found}", async () => {
    await prep();
    c.kh.g.version = "v6.3";
    const r = await check();
    expect(codes(r, "error")).toContain("kh_version_too_old");
    expect(item(r, "kh_version_too_old")?.params).toEqual({ found: "v6.3" });
  });
  it("HUB-FR-137 · HUB-BR-36 · A41 · secret không phải JSON ⇒ kh_credentials_invalid (không gọi token); client_secret sai ⇒ kh_credentials_rejected; token 500 ⇒ kh_token_failed", async () => {
    await prep({ secret: K1.secAcmeBad });
    const bad = await check();
    expect(codes(bad, "error")).toEqual(["kh_credentials_invalid"]);
    expect(bad.text.includes("qc-K1-not-json")).toBe(false);
    expect(c.kh.calls.some((x) => x.path === "/v1/token")).toBe(false);
    await prep({ secret: K1.secAcmeWrong });
    expect(codes(await check(), "error")).toEqual(["kh_credentials_rejected"]);
    await prep();
    c.kh.g.tokenStatus = 500;
    const r = await check();
    expect(codes(r, "error")).toEqual(["kh_token_failed"]);
    expect(item(r, "kh_token_failed")?.params).toEqual({ status: 500 });
  });
  it("HUB-FR-131 · A42 · capabilities thiếu v1 ⇒ kh_api_v1_missing; thiếu retrieval ⇒ kh_capability_missing {name}", async () => {
    await prep();
    c.kh.g.capabilities = { ...DEFAULT_CAPS, api_versions: ["v0"] };
    expect(codes(await check(), "error")).toContain("kh_api_v1_missing");
    await prep();
    c.kh.g.capabilities = { ...DEFAULT_CAPS, capabilities: [{ name: "events", status: "beta" }] };
    const r = await check();
    expect(codes(r, "error")).toContain("kh_capability_missing");
    expect(item(r, "kh_capability_missing")?.params).toEqual({ name: "retrieval" });
  });
  it("HUB-BR-35 · A43 · khoá thuộc ns khác ⇒ kh_ns_mismatch {found}; ns chưa kích hoạt ⇒ kh_ns_not_active", async () => {
    await prep();
    c.kh.set(NS.acme, { meNs: "other_ns" });
    const r = await check();
    expect(codes(r, "error")).toContain("kh_ns_mismatch");
    expect(item(r, "kh_ns_mismatch")?.params).toEqual({ found: "other_ns" });
    await prep();
    c.kh.set(NS.acme, { scenario: "ns_not_active" });
    expect(codes(await check(), "error")).toContain("kh_ns_not_active");
  });
  it("HUB-FR-131 · A44 · manifest_rev 0 ⇒ kh_manifest_missing; thiếu keyspace ⇒ kh_keyspace_missing {keyspace}; 423 ⇒ cảnh báo kh_ns_suspended", async () => {
    await prep();
    c.kh.set(NS.acme, { manifestRev: 0 });
    expect(codes(await check(), "error")).toContain("kh_manifest_missing");
    await prep();
    c.kh.set(NS.acme, { keyspaces: [{ keyspace: "other", dims: ["role"] }] });
    const ks = await check();
    expect(codes(ks, "error")).toEqual(["kh_keyspace_missing"]);
    expect(item(ks, "kh_keyspace_missing")?.params).toEqual({ keyspace: "step" });
    await prep();
    c.kh.set(NS.acme, { scenario: "ns_suspended" });
    expect(codes(await check(), "warning")).toContain("kh_ns_suspended");
  });
  it("HUB-BR-35 · A45 · project khai báo không gắn với khoá ⇒ kh_project_not_attached {project_id}; khoá không liệt kê project ⇒ cảnh báo kh_projects_unverified", async () => {
    await prep();
    c.kh.set(NS.acme, { projects: [PROJ.a] });
    const r = await check();
    expect(codes(r, "error")).toEqual(["kh_project_not_attached"]);
    expect(item(r, "kh_project_not_attached")?.params).toEqual({ project_id: PROJ.b });
    await prep();
    c.kh.set(NS.acme, { projects: [] });
    const u = await check();
    expect([u.json?.status, codes(u, "warning").includes("kh_projects_unverified")]).toEqual([
      "ok",
      true,
    ]);
  });
});

describe("A46–A47 · chưa cấu hình [spec §3.2]", () => {
  it("HUB-FR-131 · A46 · thiếu base_url / thiếu secret_id ⇒ 409 KH_NOT_CONFIGURED; tenant chưa có hàng ⇒ 404", async () => {
    await prep({ url: null });
    const a = await check();
    expect([a.status, errCode(a)]).toEqual([409, "KH_NOT_CONFIGURED"]);
    await prep({ secret: null });
    const b = await check();
    expect([b.status, errCode(b)]).toEqual([409, "KH_NOT_CONFIGURED"]);
    expect((await studio(c, "POST", `/tenants/${T.beta}/check`)).status).toBe(404);
    expect((await studio(c, "POST", `/tenants/${NONE}/check`)).status).toBe(404);
  });
  it("HUB-FR-131 · A47 · kết quả kiểm hiện ở GET /kh/tenants (status + check) và không chứa token/secret", async () => {
    await prep({ projects: [{ id: PROJ.shared, ro: true }] });
    c.kh.set(NS.acme, { peopleLanes: true });
    expect((await check()).json?.status).toBe("error");
    const l = await studio(c, "GET", "/tenants");
    const acme = (l.json?.items ?? []).find((i: { ns: string }) => i.ns === NS.acme);
    expect(acme?.status).toBe("error");
    expect(
      acme?.check?.items?.some((i: { code: string }) => i.code === "kh_people_lanes_on_shared"),
    ).toBe(true);
    for (const t of c.kh.tokens) expect(l.text.includes(t)).toBe(false);
    expect(l.text.includes("qc-K1-acme")).toBe(false);
  });
});
