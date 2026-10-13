// HUB-FR-131 · HUB-BR-37 · HUB-BR-40 · K1-AC01 · CR-073 · spec §3.0 (giao thức `X-KH-Key`), §3.2 `POST C/:id/check`, §9 Q27/Q28/
// Q31/Q33 · plan §3.1 (6 bước, 7 lỗi + 5 cảnh báo), §4 (audit `check`) · test-plan K1 §4 A20–A31: "Kiểm tra" trên KH GIẢ qua
// hub-api thật — luôn 200 `KhCheckResult` (KH lỗi vẫn 200), lưu vào hàng (không tăng version/không bump config), `/version`
// không khoá phải 401, mọi lời gọi có khoá dùng header `X-KH-Key`, `/health` không gửi khoá.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMaxK1,
  auditSinceK1,
  CONN,
  type CtxK1,
  configVersion,
  connRow,
  K1,
  KEY,
  needK1,
  seedConn,
  startK1,
  studio,
} from "./_k1";
import { deadOrigin } from "./_khfake";

let c: CtxK1;
let dead = "";
beforeAll(async () => {
  dead = await deadOrigin();
  c = await startK1({ seed: "secrets", extraOrigins: [dead] });
}, 90_000);
afterAll(async () => {
  await c?.stop();
});
beforeEach(async () => {
  c.khA.reset();
  c.khB.reset();
  if (!c.k1 || !c.sec) return;
  await c.sql`delete from hub.agent_kh`;
  await c.sql`delete from hub.kh_connections`;
});

const need = () => needK1(c);
// biome-ignore lint/suspicious/noExplicitAny: KhCheckResult JSON
type J = any;
async function check(
  o: { base?: string; secretId?: string; summary?: string | null } = {},
): Promise<J> {
  await seedConn(c.sql, {
    id: K1.connMain,
    name: CONN.main,
    baseUrl: o.base ?? c.khA.base,
    secretId: o.secretId ?? K1.secMain,
    summary: o.summary === undefined ? "proj-a" : o.summary,
    status: "unchecked",
  });
  const r = await studio(c, "POST", `/${K1.connMain}/check`);
  expect(r.status).toBe(200);
  return r.json;
}
const codes = (r: J): string[] =>
  ((r?.items ?? []) as J[]).map((i) => `${i.level}:${i.code}`).sort();
const item = (r: J, code: string): J => ((r?.items ?? []) as J[]).find((i) => i.code === code);

describe("A20–A23 · đạt + giao thức [plan §3.1 · spec §3.0]", () => {
  it("HUB-FR-131 · K1-AC01 · A20 · KH hợp lệ ⇒ 200 status ok, kh_version, embedder, projects khoá thấy, items []; lưu hàng (ok, check_result, checked_at)", async () => {
    need();
    const r = await check();
    expect(r).toMatchObject({
      status: "ok",
      kh_version: "v6.4",
      embedder: "BAAI/bge-m3",
      projects: ["proj-a", "proj-b"],
      items: [],
    });
    expect(typeof r.checked_at).toBe("string");
    const row = await connRow(c.sql, K1.connMain);
    expect(row?.check_status).toBe("ok");
    expect(row?.check_result).toMatchObject({ status: "ok", projects: ["proj-a", "proj-b"] });
    expect(row?.checked_at).not.toBeNull();
    const g = await studio(c, "GET", "");
    expect(g.json?.items?.[0]).toMatchObject({ status: "ok", check: { status: "ok" } });
  });
  it("HUB-BR-40 · Q26 · A21 · /health không khoá; /version gọi KHÔNG khoá (nhận 401) rồi CÓ khoá; /projects có khoá; mọi khoá qua header X-KH-Key và đúng giá trị", async () => {
    need();
    await check();
    const calls = c.khA.calls;
    const h = calls.filter((x) => x.path === "/health");
    expect(h.length).toBeGreaterThanOrEqual(1);
    expect(h.every((x) => !x.sentKey)).toBe(true);
    const v = calls.filter((x) => x.path === "/version");
    expect(v.map((x) => [x.sentKey, x.status])).toEqual([
      [false, 401],
      [true, 200],
    ]);
    const keyed = calls.filter((x) => x.sentKey);
    expect(keyed.length).toBeGreaterThanOrEqual(2);
    expect(keyed.every((x) => x.via === "x-kh-key" && x.keyOk)).toBe(true);
    expect(calls.filter((x) => x.path === "/projects").map((x) => x.status)).toEqual([200]);
    expect(c.khB.calls).toEqual([]);
  });
  it("HUB-FR-131 · A22 · kiểm tra không tăng version kết nối, không bump hub_config_version; audit check {status, codes} không có khoá", async () => {
    need();
    const v0 = await configVersion(c.sql);
    const a0 = await auditMaxK1(c.sql);
    c.khA.set({ model: "BAAI/bge-small-en-v1.5" });
    await check();
    expect((await connRow(c.sql, K1.connMain))?.version).toBe(1);
    expect(await configVersion(c.sql)).toBe(v0);
    const au = await auditSinceK1(c.sql, a0, "kh_connection");
    expect(au.map((x) => [x.action, x.tenant_id, x.entity_name])).toEqual([
      ["check", null, CONN.main],
    ]);
    expect(au[0]?.summary).toMatchObject({ status: "ok", codes: ["kh_embedder_english"] });
    expect(JSON.stringify(au)).not.toContain(KEY.a);
  });
  it("HUB-FR-131 · Q33 · A23 · embedder chỉ tiếng Anh ⇒ cảnh báo kh_embedder_english {model}, vẫn ok", async () => {
    need();
    c.khA.set({ model: "BAAI/bge-small-en-v1.5" });
    const r = await check();
    expect([r.status, codes(r)]).toEqual(["ok", ["warning:kh_embedder_english"]]);
    expect(item(r, "kh_embedder_english").params).toEqual({ model: "BAAI/bge-small-en-v1.5" });
  });
});

describe("A24–A28 · lỗi xác thực / khoá / phiên bản [Q27 · Q28]", () => {
  it("HUB-BR-40 · Q28 · A24 · KH tắt xác thực (/version không khoá 2xx) trên loopback dev/test ⇒ chỉ cảnh báo kh_auth_disabled_dev", async () => {
    need();
    c.khA.set({ auth: false });
    const r = await check();
    expect([r.status, codes(r)]).toEqual(["ok", ["warning:kh_auth_disabled_dev"]]);
  });
  it("HUB-BR-40 · A25 · khoá sai ⇒ kh_key_rejected, status error, hàng lưu error; không gọi /projects", async () => {
    need();
    const r = await check({ secretId: K1.secWrong });
    expect([r.status, codes(r)]).toEqual(["error", ["error:kh_key_rejected"]]);
    expect((await connRow(c.sql, K1.connMain))?.check_status).toBe("error");
    expect(c.khA.callsTo("/projects")).toEqual([]);
  });
  it("HUB-FR-131 · Q27 · A26 · KH chế độ đăng nhập (SSO, khoá tĩnh luôn 401) ⇒ kh_key_rejected", async () => {
    need();
    c.khA.set({ sso: true });
    const r = await check();
    expect([r.status, codes(r)]).toEqual(["error", ["error:kh_key_rejected"]]);
  });
  it("HUB-FR-131 · A27 · phiên bản v6.3 ⇒ kh_version_too_old {found}", async () => {
    need();
    c.khA.set({ version: "v6.3" });
    const r = await check();
    expect(r.status).toBe("error");
    expect(codes(r)).toContain("error:kh_version_too_old");
    expect(String(item(r, "kh_version_too_old")?.params?.found)).toContain("6.3");
  });
  it("HUB-BR-36 · A28 · secret không giải mã được ⇒ kh_key_invalid, không gửi lời gọi có khoá", async () => {
    need();
    await c.sql`update hub.secrets set ciphertext = ${Buffer.from("qc-K1-hong-hong-hong")} where id = ${K1.secMain2}`;
    const r = await check({ secretId: K1.secMain2 });
    expect([r.status, codes(r)]).toEqual(["error", ["error:kh_key_invalid"]]);
    expect(c.khA.calls.filter((x) => x.sentKey)).toEqual([]);
  });
});

describe("A29–A31 · mạng, URL, project [plan §3.1 bước 1–2, 6]", () => {
  it("HUB-FR-131 · A29 · /health 503 ⇒ kh_unreachable {status:503}; origin chết ⇒ kh_unreachable; KH chậm hơn timeout ⇒ kh_timeout (vẫn 200)", async () => {
    need();
    c.khA.set({ healthStatus: 503 });
    const a = await check();
    expect([a.status, codes(a)]).toEqual(["error", ["error:kh_unreachable"]]);
    expect(item(a, "kh_unreachable").params).toEqual({ status: 503 });
    await c.sql`delete from hub.kh_connections`;
    const b = await check({ base: dead });
    expect([b.status, codes(b)]).toEqual(["error", ["error:kh_unreachable"]]);
    await c.sql`delete from hub.kh_connections`;
    c.khA.reset();
    c.khA.set({ slow: true });
    const t = await check();
    expect([t.status, codes(t)]).toEqual(["error", ["error:kh_timeout"]]);
  });
  it("HUB-BR-37 · A30 · base_url không còn qua allowlist lúc kiểm (đổi trong DB) ⇒ kh_url_not_allowed {reason}, không gọi ra ngoài", async () => {
    need();
    const r = await check({ base: "https://evil.example.com" });
    expect([r.status, codes(r)]).toEqual(["error", ["error:kh_url_not_allowed"]]);
    expect(item(r, "kh_url_not_allowed").params).toEqual({ reason: "not_in_allowlist" });
    expect([...c.khA.calls, ...c.khB.calls]).toEqual([]);
  });
  it("HUB-FR-132 · HUB-FR-133 · Q31 · A31 · /projects 500 ⇒ kh_unreachable; rỗng ⇒ kh_projects_empty; summary_project khoá không thấy ⇒ kh_summary_project_missing", async () => {
    need();
    c.khA.set({ projectsStatus: 500 });
    const a = await check();
    expect([a.status, codes(a)]).toEqual(["error", ["error:kh_unreachable"]]);
    await c.sql`delete from hub.kh_connections`;
    c.khA.reset();
    c.khA.set({ projects: [] });
    const b = await check({ summary: null });
    expect([b.status, b.projects, codes(b)]).toEqual(["ok", [], ["warning:kh_projects_empty"]]);
    await c.sql`delete from hub.kh_connections`;
    c.khA.reset();
    const d = await check({ summary: "proj-x" });
    expect([d.status, codes(d)]).toEqual(["ok", ["warning:kh_summary_project_missing"]]);
    expect(item(d, "kh_summary_project_missing").params).toEqual({ project_id: "proj-x" });
  });
});
