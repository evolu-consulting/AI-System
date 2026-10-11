// P-b · PF-S1 · HUB-FR-120 · ADM-FR-68 · PB-R01/02/08 · C10 · C-01…C-18 (test-plan §4.1): CRUD `/admin/sources`.
// Đỏ trước code: route `/admin/sources` chưa mount ⇒ 404 thay vì 201/200…; bảng `hub.sources` chưa có ⇒ fixture SQL được bảo vệ.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type Ctx1,
  code,
  defWithSource,
  gitBody,
  type Json,
  libBody,
  mkSource,
  PA,
  putBody,
  resetPfs1,
  seedLibraryDoc,
  startPfs1,
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

const countRows = async (key?: string): Promise<number> => {
  const [r] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.sources
    where deleted_at is null and (${key ?? null}::text is null or key = ${key ?? null})`;
  return r?.n ?? -1;
};
const VIEW_KEYS = [
  "config",
  "created_at",
  "description",
  "id",
  "key",
  "kind",
  "last_pin",
  "tenant_id",
  "updated_at",
  "updated_by",
  "used_by",
  "version",
];

describe("C-01…C-03 · tạo nguồn git_remote [HUB-FR-120, PB-R01]", () => {
  it("HUB-FR-120 · C-01 · POST git_remote ⇒ 201, version 1, used_by [], last_pin null, đúng shape SourceView", async () => {
    const r = await mkSource(c, "Adm", gitBody("app-repo"));
    expect(r.status).toBe(201);
    expect(Object.keys(r.json).sort()).toEqual(VIEW_KEYS);
    expect(r.json).toMatchObject({
      key: "app-repo",
      kind: "git_remote",
      version: 1,
      used_by: [],
      last_pin: null,
      config: { kind: "git_remote", url: URL_APP, branch: "main" },
    });
  });

  it("HUB-FR-120 · C-02 · host gitlab.com thuộc allowlist ⇒ 201", async () => {
    const r = await mkSource(
      c,
      "Adm",
      gitBody("lab-repo", { url: "https://gitlab.com/pb-test/lab.git" }),
    );
    expect(r.status).toBe(201);
  });

  it("HUB-FR-120 · C-03 · key trùng cùng tenant ⇒ 409 SOURCE_KEY_TAKEN; cùng key tenant beta ⇒ 201", async () => {
    expect((await mkSource(c, "Adm", gitBody("app-repo"))).status).toBe(201);
    const dup = await mkSource(c, "Adm", gitBody("app-repo"));
    expect(code(dup)).toEqual({ status: 409, code: "SOURCE_KEY_TAKEN" });
    expect(await countRows("app-repo")).toBe(1);
    expect((await mkSource(c, "Db", gitBody("app-repo"))).status).toBe(201);
  });
});

describe("C-04…C-07 · validate [PB-R02, C10]", () => {
  it.each([
    "https://bitbucket.org/pb-test/app-repo.git",
    "https://github.com.evil.io/pb-test/app-repo.git",
    "https://evilgithub.com/pb-test/app-repo.git",
  ])(
    "PB-R02 · C-04 · host ngoài allowlist %s ⇒ 422 SOURCE_HOST_NOT_ALLOWED, không tạo hàng",
    async (url) => {
      const r = await mkSource(c, "Adm", gitBody("bad-host", { url }));
      expect(code(r)).toEqual({ status: 422, code: "SOURCE_HOST_NOT_ALLOWED" });
      expect(await countRows("bad-host")).toBe(0);
    },
  );

  it.each([
    "https://user:pass@github.com/pb-test/app-repo.git",
    "https://tok@github.com/pb-test/app-repo.git",
  ])("PB-R02 · C-05 · URL có credential %s ⇒ 422 VALIDATION_ERROR", async (url) => {
    const r = await mkSource(c, "Adm", gitBody("cred-url", { url }));
    expect(vcode(r)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    expect(await countRows("cred-url")).toBe(0);
  });

  it("PB-R01 · C-06 · key `App_1` và field thừa ⇒ 422 VALIDATION_ERROR", async () => {
    const badKey = await mkSource(c, "Adm", gitBody("App_1"));
    expect(vcode(badKey)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    const extra = await mkSource(c, "Adm", { ...gitBody("extra-field"), surprise: 1 });
    expect(vcode(extra)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    expect(await countRows()).toBe(0);
  });

  it("HUB-FR-120 · C-07 · library document_id thật của acme ⇒ 201", async () => {
    const doc = await seedLibraryDoc(c.sql, { tenant: PA.A.tid, userId: PA.A.id });
    expect(doc).not.toBeNull(); // đỏ nếu 0021 chưa nới attachments_origin_check cho 'library'
    const r = await mkSource(c, "Adm", libBody("quy-dinh", doc as string));
    expect(r.status).toBe(201);
    expect(r.json.config).toEqual({ kind: "library", document_id: doc });
  });

  it("C10 · C-07 · library id không tồn tại / của beta ⇒ 422 SOURCE_UNRESOLVABLE cùng body, không tạo hàng", async () => {
    const betaDoc = await seedLibraryDoc(c.sql, { tenant: PA.D.tid, userId: PA.D.id });
    expect(betaDoc).not.toBeNull();
    const ghost = await mkSource(
      c,
      "Adm",
      libBody("ma-lac", "b1b10000-0000-4000-8000-0000000000ff"),
    );
    const foreign = await mkSource(c, "Adm", libBody("ma-lac", betaDoc as string));
    expect(code(ghost)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    expect(code(foreign)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    expect(foreign.json).toEqual(ghost.json); // không rò tồn tại
    expect(await countRows("ma-lac")).toBe(0);
  });
});

describe("C-08…C-09 · đọc [HUB-FR-120]", () => {
  it("HUB-FR-120 · C-08 · list limit=2 phân trang đủ 5 nguồn không trùng; kind=library lọc đúng", async () => {
    const doc = await seedLibraryDoc(c.sql, { tenant: PA.A.tid, userId: PA.A.id });
    expect(doc).not.toBeNull();
    for (const k of ["src-a1", "src-a2", "src-a3", "src-a4"])
      expect((await mkSource(c, "Adm", gitBody(k))).status).toBe(201);
    expect((await mkSource(c, "Adm", libBody("src-lib", doc as string))).status).toBe(201);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const q: string = `/admin/sources?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await c.call("Adm", "GET", q);
      expect(r.status).toBe(200);
      expect(r.json.items.length).toBeLessThanOrEqual(2);
      for (const it of r.json.items as Json[]) seen.push(it.key);
      cursor = r.json.next_cursor ?? null;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(["src-a1", "src-a2", "src-a3", "src-a4", "src-lib"]);
    expect(new Set(seen).size).toBe(5);
    const lib = await c.call("Adm", "GET", "/admin/sources?kind=library");
    expect((lib.json.items as Json[]).map((x) => x.key)).toEqual(["src-lib"]);
  });

  it("HUB-FR-120 · C-09 · GET :key ⇒ 200; key lạ ⇒ 404 SOURCE_NOT_FOUND", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const ok = await c.call("Adm", "GET", "/admin/sources/app-repo");
    expect(ok.status).toBe(200);
    expect(ok.json.key).toBe("app-repo");
    const miss = await c.call("Adm", "GET", "/admin/sources/khong-co");
    expect(code(miss)).toEqual({ status: 404, code: "SOURCE_NOT_FOUND" });
  });
});

describe("C-10…C-13 · sửa [PB-R08]", () => {
  it("HUB-FR-120 · C-10 · PUT version 1 đổi branch dev ⇒ 200 version 2", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const r = await c.call(
      "Adm",
      "PUT",
      "/admin/sources/app-repo",
      putBody({ kind: "git_remote", url: URL_APP, branch: "dev" }, 1),
    );
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ version: 2, config: { branch: "dev" } });
  });

  it("HUB-FR-120 · C-11 · PUT version 1 lần hai ⇒ 409 VERSION_CONFLICT", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const cfg = { kind: "git_remote", url: URL_APP, branch: "dev" };
    expect((await c.call("Adm", "PUT", "/admin/sources/app-repo", putBody(cfg, 1))).status).toBe(
      200,
    );
    const again = await c.call("Adm", "PUT", "/admin/sources/app-repo", putBody(cfg, 1));
    expect(code(again)).toEqual({ status: 409, code: "VERSION_CONFLICT" });
  });

  it("PB-R08 · C-12 · đổi kind khi chưa ai dùng ⇒ 200; khi quy trình p-src dùng ⇒ 409 SOURCE_IN_USE", async () => {
    const doc = await seedLibraryDoc(c.sql, { tenant: PA.A.tid, userId: PA.A.id });
    expect(doc).not.toBeNull();
    await mkSource(c, "Adm", gitBody("free-src"));
    const free = await c.call(
      "Adm",
      "PUT",
      "/admin/sources/free-src",
      putBody({ kind: "library", document_id: doc }, 1),
    );
    expect(free.status).toBe(200);
    expect(free.json.kind).toBe("library");

    await mkSource(c, "Adm", gitBody("app-repo"));
    expect(
      (await c.call("Adm", "POST", "/process-defs", defWithSource("pbx-src", "app-repo"))).status,
    ).toBe(201);
    const used = await c.call(
      "Adm",
      "PUT",
      "/admin/sources/app-repo",
      putBody({ kind: "library", document_id: doc }, 1),
    );
    expect(code(used)).toEqual({ status: 409, code: "SOURCE_IN_USE" });
  });

  it("PB-R08 · C-13 · đổi URL/branch khi đang dùng ⇒ 200", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    await c.call("Adm", "POST", "/process-defs", defWithSource("pbx-src", "app-repo"));
    const r = await c.call(
      "Adm",
      "PUT",
      "/admin/sources/app-repo",
      putBody(
        { kind: "git_remote", url: "https://github.com/pb-test/other.git", branch: "dev" },
        1,
      ),
    );
    expect(r.status).toBe(200);
    expect(r.json.version).toBe(2);
  });
});

describe("C-14…C-17 · xoá mềm + used_by [PB-R08]", () => {
  it("HUB-FR-120 · C-14 · DELETE version đúng, chưa dùng ⇒ 204; GET ⇒ 404; POST lại cùng key ⇒ 201", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const del = await c.call("Adm", "DELETE", "/admin/sources/app-repo?version=1");
    expect(del.status).toBe(204);
    expect(code(await c.call("Adm", "GET", "/admin/sources/app-repo"))).toEqual({
      status: 404,
      code: "SOURCE_NOT_FOUND",
    });
    expect((await mkSource(c, "Adm", gitBody("app-repo"))).status).toBe(201);
  });

  it("HUB-FR-120 · C-15 · DELETE version cũ ⇒ 409 VERSION_CONFLICT, hàng còn", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    await c.call(
      "Adm",
      "PUT",
      "/admin/sources/app-repo",
      putBody({ kind: "git_remote", url: URL_APP, branch: "dev" }, 1),
    );
    const del = await c.call("Adm", "DELETE", "/admin/sources/app-repo?version=1");
    expect(code(del)).toEqual({ status: 409, code: "VERSION_CONFLICT" });
    expect(await countRows("app-repo")).toBe(1);
  });

  it("PB-R08 · C-16 · DELETE khi p-src/stage s1 dùng ⇒ 409 SOURCE_IN_USE details.refs, hàng còn", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const def = await c.call("Adm", "POST", "/process-defs", defWithSource("p-src", "app-repo"));
    expect(def.status).toBe(201);
    const del = await c.call("Adm", "DELETE", "/admin/sources/app-repo?version=1");
    expect(code(del)).toEqual({ status: 409, code: "SOURCE_IN_USE" });
    expect(del.json.error.details.refs).toEqual([{ process_key: "p-src", stage_key: "s1" }]);
    expect(await countRows("app-repo")).toBe(1);
  });

  it("PB-R08 · C-17 · used_by = [p-src] sau khi quy trình tham chiếu; về [] sau khi gỡ", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const def = await c.call("Adm", "POST", "/process-defs", defWithSource("p-src", "app-repo"));
    expect(def.status).toBe(201);
    expect((await c.call("Adm", "GET", "/admin/sources/app-repo")).json.used_by).toEqual(["p-src"]);
    const del = await c.call(
      "Adm",
      "DELETE",
      `/process-defs/${def.json.id}?version=${def.json.version}`,
    );
    expect([200, 204]).toContain(del.status);
    expect((await c.call("Adm", "GET", "/admin/sources/app-repo")).json.used_by).toEqual([]);
  });
});

describe("C-18 · mọi response CRUD đúng shape contract [HUB-FR-120]", () => {
  it("HUB-FR-120 · C-18 · create/get/put/list trả cùng bộ khoá strict; list có items+next_cursor", async () => {
    const created = await mkSource(c, "Adm", gitBody("app-repo"));
    const got = await c.call("Adm", "GET", "/admin/sources/app-repo");
    const put = await c.call(
      "Adm",
      "PUT",
      "/admin/sources/app-repo",
      putBody({ kind: "git_remote", url: URL_APP, branch: "dev" }, 1),
    );
    for (const r of [created, got, put]) expect(Object.keys(r.json).sort()).toEqual(VIEW_KEYS);
    const list = await c.call("Adm", "GET", "/admin/sources");
    expect(Object.keys(list.json).sort()).toEqual(["items", "next_cursor"]);
    expect(Object.keys(list.json.items[0]).sort()).toEqual(VIEW_KEYS);
    expect(list.json.next_cursor).toBeNull();
  });
});
