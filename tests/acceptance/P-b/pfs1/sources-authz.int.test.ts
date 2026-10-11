// P-b · PF-S1 · PB-R21 · HUB-BR-14/29 · AC-H36(d)(e) · C1 · C7 · C11 · A-01…A-12 (test-plan §4.1): quyền + cách ly tenant.
// Đỏ trước code: `/admin/sources` chưa mount ⇒ 404 (không 403/401/201…); `/process-runs/sources` chưa có.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  anon,
  type Ctx1,
  code,
  gitBody,
  insertSource,
  type Json,
  LOCAL_PATH,
  localBody,
  mkSource,
  putBody,
  resetPfs1,
  resolveStub,
  startPfs1,
  T,
  URL_APP,
  vcode,
} from "./_local";

let c: Ctx1;
beforeAll(async () => {
  c = await startPfs1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
beforeEach(async () => {
  await resetPfs1(c.sql);
});

const rows = async (key: string): Promise<number> => {
  const [t] = await c.sql<{ ok: boolean }[]>`select to_regclass('hub.sources') is not null as ok`;
  if (!t?.ok) return -1; // chưa có bảng ⇒ giữ đỏ ở expect (không PostgresError)
  const [r] = await c.sql<
    { n: number }[]
  >`select count(*)::int as n from hub.sources where key = ${key}`;
  return r?.n ?? -1;
};
const seedLocal = (tenant = T.acme, key = "pb-docs") =>
  insertSource(c.sql, {
    tenant,
    key,
    kind: "local_path",
    config: { kind: "local_path", path: LOCAL_PATH },
  });

describe("A-01…A-02 · xác thực + vai trò [HUB-BR-14]", () => {
  it("HUB-BR-14 · A-01 · member (lan) GET /admin/sources ⇒ 403", async () => {
    expect((await c.call("A", "GET", "/admin/sources")).status).toBe(403);
  });
  it("HUB-BR-14 · A-02 · không token ⇒ 401", async () => {
    expect((await anon(c, "GET", "/admin/sources")).status).toBe(401);
  });
});

describe("A-03…A-05 · ghi local_path chỉ platform_admin [PB-R21, AC-H36(e), C7, C11]", () => {
  it("PB-R21 · AC-H36(e) · A-03 · tenant_admin POST local_path ⇒ 403 SOURCE_FORBIDDEN_KIND, không tạo hàng", async () => {
    const r = await mkSource(c, "Adm", localBody("pb-docs"));
    expect(code(r)).toEqual({ status: 403, code: "SOURCE_FORBIDDEN_KIND" });
    expect(await rows("pb-docs")).toBe(0);
  });

  it("PB-R21 · A-04 · nguồn local_path có sẵn: tenant_admin PUT ⇒ 403, DELETE ⇒ 403, hàng nguyên vẹn", async () => {
    await seedLocal();
    const put = await c.call(
      "Adm",
      "PUT",
      "/admin/sources/pb-docs",
      putBody({ kind: "local_path", path: "/qc-roots/khac" }, 1),
    );
    expect(code(put)).toEqual({ status: 403, code: "SOURCE_FORBIDDEN_KIND" });
    const del = await c.call("Adm", "DELETE", "/admin/sources/pb-docs?version=1");
    expect(code(del)).toEqual({ status: 403, code: "SOURCE_FORBIDDEN_KIND" });
    const [row] = await c.sql<
      Json[]
    >`select config, version from hub.sources where key = 'pb-docs'`;
    expect(row).toMatchObject({ config: { path: LOCAL_PATH }, version: 1 });
  });

  it("PB-R21 · C7 · C11 · A-05 · platform_admin POST local_path tenant_id=acme ⇒ 201; thiếu tenant_id ⇒ 422 VALIDATION_ERROR; path ngoài gốc vẫn 201", async () => {
    const ok = await mkSource(c, "P", localBody("pb-docs", { tenant_id: T.acme }));
    expect(ok.status).toBe(201);
    expect(ok.json.tenant_id).toBe(T.acme);
    const missing = await mkSource(c, "P", localBody("pb-docs2"));
    expect(vcode(missing)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    expect(JSON.stringify(missing.json)).toContain("tenant_id");
    expect(await rows("pb-docs2")).toBe(0);
    const outside = await mkSource(
      c,
      "P",
      localBody("pb-out", { tenant_id: T.acme, path: "/qc-roots/../pb-outside" }),
    );
    expect(outside.status).toBe(201); // Hub chỉ validate cú pháp (C7); Runtime từ chối lúc check
  });
});

describe("A-06…A-07 · ẩn path local_path [PB-R21, C1]", () => {
  it("PB-R21 · C1 · A-06 · tenant_admin GET list/:key ⇒ config == {kind:local_path}; response (gồm last_pin) không chứa path", async () => {
    await seedLocal();
    const pin = {
      kind: "local_path",
      path: LOCAL_PATH,
      snapshot_id: "b1b10000-0000-4000-8000-000000000900",
    };
    // last_pin lưu ở đâu là việc của backend: mô phỏng bằng check thật (stub Runtime trả pin có path) rồi đọc lại bằng tenant_admin.
    const stub = resolveStub(c, () => ({ status: "ok", pin }));
    const check = await c.call("Adm", "POST", "/admin/sources/pb-docs/check");
    await stub.stop();
    expect(check.status).toBe(200);
    for (const r of [
      await c.call("Adm", "GET", "/admin/sources"),
      await c.call("Adm", "GET", "/admin/sources/pb-docs"),
    ]) {
      expect(r.status).toBe(200);
      expect(r.text).not.toContain(LOCAL_PATH);
      expect(r.text).not.toContain("/qc-roots");
    }
    const one = await c.call("Adm", "GET", "/admin/sources/pb-docs");
    expect(one.json.config).toEqual({ kind: "local_path" });
    expect(one.json.last_pin).toEqual({ kind: "local_path", snapshot_id: pin.snapshot_id });
  });

  it("PB-R21 · A-07 · platform_admin GET cùng nguồn ⇒ thấy path ở config và last_pin", async () => {
    await seedLocal();
    const pin = {
      kind: "local_path",
      path: LOCAL_PATH,
      snapshot_id: "b1b10000-0000-4000-8000-000000000900",
    };
    const stub = resolveStub(c, () => ({ status: "ok", pin }));
    const check = await c.call("P", "POST", `/admin/sources/pb-docs/check?tenant_id=${T.acme}`);
    await stub.stop();
    expect(check.status).toBe(200);
    expect(check.json.pin).toEqual(pin);
    const one = await c.call("P", "GET", `/admin/sources/pb-docs?tenant_id=${T.acme}`);
    expect(one.status).toBe(200);
    expect(one.json.config).toEqual({ kind: "local_path", path: LOCAL_PATH });
    expect(one.json.last_pin).toEqual(pin);
  });
});

describe("A-08…A-10 · cách ly tenant [HUB-BR-14, AC-H36(d)]", () => {
  it("HUB-BR-14 · A-08 · tenant_admin gắn tenant_id của beta vào POST/GET ⇒ 403 hoặc 404, không ghi", async () => {
    const post = await mkSource(c, "Adm", gitBody("sneaky", { tenant_id: T.beta }));
    expect([403, 404]).toContain(post.status);
    expect(await rows("sneaky")).toBe(0);
    await insertSource(c.sql, {
      tenant: T.beta,
      key: "beta-only",
      kind: "git_remote",
      config: gitBody("x").config as Json,
    });
    const get = await c.call("Adm", "GET", `/admin/sources/beta-only?tenant_id=${T.beta}`);
    expect([403, 404]).toContain(get.status);
    expect(get.text).not.toContain("pb-test/app-repo");
  });

  it("AC-H36(d) · A-09 · tenant B GET/PUT/DELETE/check key của acme ⇒ 404 SOURCE_NOT_FOUND, body y hệt key không tồn tại", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const cfg = { kind: "git_remote", url: URL_APP, branch: "dev" };
    const calls: [string, string, unknown?][] = [
      ["GET", "/admin/sources/KEY"],
      ["PUT", "/admin/sources/KEY", putBody(cfg, 1)],
      ["DELETE", "/admin/sources/KEY?version=1"],
      ["POST", "/admin/sources/KEY/check"],
    ];
    for (const [m, p, b] of calls) {
      const real = await c.call("Db", m, p.replace("KEY", "app-repo"), b);
      const ghost = await c.call("Db", m, p.replace("KEY", "khong-co-gi"), b);
      expect(code(real)).toEqual({ status: 404, code: "SOURCE_NOT_FOUND" });
      expect(code(ghost)).toEqual({ status: 404, code: "SOURCE_NOT_FOUND" });
      expect(real.json.error.message).toBe(ghost.json.error.message);
    }
    expect(await rows("app-repo")).toBe(1);
    const [row] = await c.sql<
      Json[]
    >`select version, deleted_at from hub.sources where key = 'app-repo'`;
    expect(row).toMatchObject({ version: 1, deleted_at: null });
  });

  it("HUB-BR-14 · A-10 · platform_admin GET ?tenant_id=acme thấy nguồn acme", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const r = await c.call("P", "GET", `/admin/sources?tenant_id=${T.acme}`);
    expect(r.status).toBe(200);
    expect((r.json.items as Json[]).map((s) => s.key)).toEqual(["app-repo"]);
  });
});

describe("A-11…A-12 · chip nguồn cho user thường [PB-R21]", () => {
  it("PB-R21 · A-11 · member GET /process-runs/sources ⇒ chỉ key/kind/description của tenant mình, không config/url/path, nguồn xoá mềm vắng", async () => {
    await mkSource(c, "Adm", gitBody("app-repo", { description: "Mã nguồn app" }));
    await seedLocal();
    await mkSource(c, "Adm", gitBody("da-xoa"));
    await c.call("Adm", "DELETE", "/admin/sources/da-xoa?version=1");
    await insertSource(c.sql, {
      tenant: T.beta,
      key: "beta-repo",
      kind: "git_remote",
      config: gitBody("x").config as Json,
    });
    const r = await c.call("A", "GET", "/process-runs/sources");
    expect(r.status).toBe(200);
    const items = r.json.items as Json[];
    expect(items.map((s) => s.key).sort()).toEqual(["app-repo", "pb-docs"]);
    for (const it of items) {
      expect(
        Object.keys(it).every((k) => ["key", "kind", "description", "default_branch"].includes(k)),
      ).toBe(true);
      expect(it).toHaveProperty("description");
    }
    expect(r.text).not.toContain("config");
    expect(r.text).not.toContain("github.com");
    expect(r.text).not.toContain(LOCAL_PATH);
    const beta = await c.call("D", "GET", "/process-runs/sources");
    expect((beta.json.items as Json[]).map((s) => s.key)).toEqual(["beta-repo"]);
  });

  it("PB-R21 · A-12 · chip không token ⇒ 401", async () => {
    expect((await anon(c, "GET", "/process-runs/sources")).status).toBe(401);
  });
});
