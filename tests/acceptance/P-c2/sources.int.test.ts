// HUB-FR-129 · HUB-FR-68 · HUB-BR-30 · HUB-BR-14 · PC2-R02 · PC2-R10 · P-c2 · plan §3.1, §6.1, C12 · test-plan P-c2 §4 S01–S08: nguồn
// `git_remote` nhận `credential_secret_id` (secret `source_credential` CÙNG tenant, còn tồn tại — sai mọi kiểu ⇒ 422
// SOURCE_CREDENTIAL_INVALID một thân) + `apply_mode` (pr/auto_merge chỉ host có provider ⇒ 422 SOURCE_APPLY_UNSUPPORTED); nguồn cũ
// đọc được; xoá khoá đang dùng ⇒ SECRET_IN_USE; route khoá nguồn theo tenant phiên (C12). Không token trong phản hồi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPc2,
  code,
  expectNoToken,
  GL_URL,
  ghUrl,
  type Json,
  type Role,
  SEC,
  startPc2,
  T,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

let n = 0;
const body = (cfg: Json, o: Json = {}): Json => ({
  key: `pc2-s${++n}`,
  kind: "git_remote",
  config: { kind: "git_remote", url: ghUrl("app-repo"), branch: "main", ...cfg },
  description: "Nguồn thử P-c2",
  ...o,
});
const create = (who: Role, b: Json) => c.call(who, "POST", "/admin/sources", b);
const rows = async (key: string) =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from hub.sources where key = ${key}`)[0]
    ?.n;

describe("S01–S04 · tạo nguồn có khoá / chế độ áp [PC2-R10, PC2-R02]", () => {
  it("HUB-FR-129 · HUB-FR-68 · S01 · tenant_admin tạo nguồn github + khoá source_credential cùng tenant + auto_merge ⇒ 201; GET trả đúng id khoá + chế độ; không lộ token", async () => {
    const b = body({ credential_secret_id: SEC.acme, apply_mode: "auto_merge" });
    const r = await create("Adm", b);
    expect(code(r)).toEqual({ status: 201, code: undefined });
    const g = await c.call("Adm", "GET", `/admin/sources/${b.key}`);
    expect(g.status).toBe(200);
    expect({
      cred: g.json?.config?.credential_secret_id,
      mode: g.json?.config?.apply_mode,
    }).toEqual({
      cred: SEC.acme,
      mode: "auto_merge",
    });
    expectNoToken("POST/GET nguồn", JSON.stringify([r.json, g.json]));
  });
  it("HUB-BR-30 · HUB-BR-14 · PC2-R10 · S02 · khoá tenant khác / sai kind (kh_api_key, provider_api_key) / không tồn tại ⇒ 422 SOURCE_CREDENTIAL_INVALID, CÙNG một thân, không tạo hàng", async () => {
    const bad = [SEC.beta, SEC.khAcme, SEC.provider, SEC.missing];
    const out: Json[] = [];
    for (const id of bad) {
      const b = body({ credential_secret_id: id });
      const r = await create("Adm", b);
      expect({ id, ...code(r) }).toEqual({ id, status: 422, code: "SOURCE_CREDENTIAL_INVALID" });
      expect(await rows(b.key)).toBe(0);
      out.push(r.json);
    }
    expect(new Set(out.map((j) => JSON.stringify(j))).size).toBe(1);
    expect(JSON.stringify(out[0])).toContain("config.credential_secret_id");
  });
  it("HUB-BR-14 · PC2-R10 · S03 · tenant_admin beta dùng khoá acme ⇒ 422; platform_admin tạo cho acme bằng khoá beta ⇒ 422, bằng khoá acme ⇒ 201", async () => {
    expect(code(await create("Db", body({ credential_secret_id: SEC.acme })))).toEqual({
      status: 422,
      code: "SOURCE_CREDENTIAL_INVALID",
    });
    expect(
      code(await create("P", body({ credential_secret_id: SEC.beta }, { tenant_id: T.acme }))),
    ).toEqual({
      status: 422,
      code: "SOURCE_CREDENTIAL_INVALID",
    });
    expect(
      code(await create("P", body({ credential_secret_id: SEC.acme }, { tenant_id: T.acme }))),
    ).toEqual({
      status: 201,
      code: undefined,
    });
  });
  it("HUB-FR-129 · PC2-R02 · Q1 · S04 · gitlab.com + pr/auto_merge ⇒ 422 SOURCE_APPLY_UNSUPPORTED (path config.apply_mode); gitlab + branch_only / vắng ⇒ 201", async () => {
    for (const m of ["pr", "auto_merge"]) {
      const b = body({ url: GL_URL, apply_mode: m });
      const r = await create("Adm", b);
      expect({ m, ...code(r) }).toEqual({ m, status: 422, code: "SOURCE_APPLY_UNSUPPORTED" });
      expect(JSON.stringify(r.json)).toContain("config.apply_mode");
      expect(await rows(b.key)).toBe(0);
    }
    expect(code(await create("Adm", body({ url: GL_URL, apply_mode: "branch_only" }))).status).toBe(
      201,
    );
    expect(code(await create("Adm", body({ url: GL_URL }))).status).toBe(201);
  });
});

describe("S05–S06 · sửa nguồn + nguồn cũ [PC2-R10, C4]", () => {
  it("HUB-FR-68 · PC2-R10 · S05 · PUT thêm khoá cùng tenant ⇒ 200; đổi sang khoá beta ⇒ 422 (giữ khoá cũ); bỏ khoá (null) ⇒ 200", async () => {
    const b = body({});
    expect(code(await create("Adm", b)).status).toBe(201);
    const put = (cfg: Json, version: number) =>
      c.call("Adm", "PUT", `/admin/sources/${b.key}`, {
        config: { kind: "git_remote", url: ghUrl("app-repo"), branch: "main", ...cfg },
        description: "Nguồn thử P-c2",
        version,
      });
    expect((await put({ credential_secret_id: SEC.acme }, 1)).status).toBe(200);
    expect(code(await put({ credential_secret_id: SEC.beta }, 2))).toEqual({
      status: 422,
      code: "SOURCE_CREDENTIAL_INVALID",
    });
    const g = await c.call("Adm", "GET", `/admin/sources/${b.key}`);
    expect(g.json?.config?.credential_secret_id).toBe(SEC.acme);
    expect((await put({ credential_secret_id: null }, 2)).status).toBe(200);
    const g2 = await c.call("Adm", "GET", `/admin/sources/${b.key}`);
    expect(g2.json?.config?.credential_secret_id ?? null).toBeNull();
  });
  it("HUB-FR-129 · C4 · S06 · nguồn cũ (config không có 2 trường mới, tạo ở P-b) ⇒ GET 200, credential_secret_id null, apply_mode vắng; danh sách nguồn 200", async () => {
    const g = await c.call("Adm", "GET", "/admin/sources/app-repo");
    expect(g.status).toBe(200);
    expect({
      cred: g.json?.config?.credential_secret_id ?? null,
      mode: g.json?.config?.apply_mode,
    }).toEqual({
      cred: null,
      mode: undefined,
    });
    const l = await c.call("Adm", "GET", "/admin/sources");
    expect(l.status).toBe(200);
    const priv = (l.json?.items ?? []).find((s: Json) => s.key === "gh-priv");
    expect(priv?.config?.credential_secret_id).toBe(SEC.acme);
    expectNoToken("danh sách nguồn", l.text);
  });
});

describe("S07–S08 · route khoá nguồn H4b-1 [PC2-R10, C12]", () => {
  it("HUB-FR-68 · PC2-R10 · S07 · xoá khoá đang được nguồn dùng ⇒ 409 SECRET_IN_USE, used_by nêu nguồn gh-priv; khoá còn nguyên", async () => {
    const r = await c.call("Adm", "DELETE", `/admin/source-credentials/${SEC.acme}?version=1`);
    expect(code(r)).toEqual({ status: 409, code: "SECRET_IN_USE" });
    expect(r.text).toContain("gh-priv");
    const [s] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.secrets where id = ${SEC.acme}`;
    expect(s?.n).toBe(1);
  });
  it("HUB-FR-68 · C12 · S08 · tenant_admin GET /admin/source-credentials (không tenant_id) ⇒ khoá acme, không khoá beta; platform_admin: GET thiếu tenant_id ⇒ 404 (H4b-1 A51), POST thiếu ⇒ 400 path tenant_id (A50); không token", async () => {
    const a = await c.call("Adm", "GET", "/admin/source-credentials");
    expect(a.status).toBe(200);
    const ids = JSON.stringify(a.json);
    expect([ids.includes(SEC.acme), ids.includes(SEC.beta)]).toEqual([true, false]);
    const p = await c.call("P", "GET", "/admin/source-credentials");
    expect(code(p)).toEqual({ status: 404, code: "NOT_FOUND" });
    const pp = await c.call("P", "POST", "/admin/source-credentials", {
      name: "qc-pc2-s08",
      value: "qc-pc2-s08-value-Zx9",
    });
    expect(pp.status).toBe(400);
    expect(pp.text).toContain("tenant_id");
    expectNoToken("route khoá nguồn", a.text + p.text);
  });
});
