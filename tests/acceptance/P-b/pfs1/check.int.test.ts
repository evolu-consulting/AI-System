// P-b · PF-S1 · HUB-FR-120 "Kiểm tra kết nối" · PB-R05 · PB-R18 · PB-R21 · C1 · C13 · K-01…K-06 + ID-07 + RS-05 (test-plan §4.1, §4.4).
// Stub Runtime (`resolveStub`) claim job `source.resolve` rồi POST `/internal/jobs/:id/sources-resolved` bằng job-token.
// Đỏ trước code: `/admin/sources/:key/check` chưa mount ⇒ 404; stub không thấy job.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type Ctx1,
  code,
  gitBody,
  insertSource,
  type Json,
  LOCAL_PATH,
  mkSource,
  PA,
  postResolved,
  resetPfs1,
  resolveStub,
  seedLibraryDoc,
  startPfs1,
  T,
  waitFor,
} from "./_local";

let c: Ctx1;
beforeAll(async () => {
  c = await startPfs1({ checkTimeoutMs: 1500 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
beforeEach(async () => {
  await resetPfs1(c.sql);
});

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("K-01…K-04 · check git_remote [HUB-FR-120, PB-R05, C13]", () => {
  it("HUB-FR-120 · K-01 · check ⇒ job source.resolve (process_run_id null, config đầy đủ); 200 {pin,files,bytes}; last_pin cập nhật", async () => {
    const src = await mkSource(c, "Adm", gitBody("app-repo"));
    expect(src.status).toBe(201);
    const pin = { kind: "git_remote", url: src.json.config.url, sha: SHA };
    const stub = resolveStub(c, () => ({ status: "ok", pin, files: 6, bytes: 4096 }));
    const r = await c.call("Adm", "POST", "/admin/sources/app-repo/check");
    await stub.stop();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ pin, files: 6, bytes: 4096 });
    expect(stub.seen.length).toBe(1);
    const p = stub.seen[0]?.payload as Json;
    expect(p).toMatchObject({
      v: 1,
      type: "source.resolve",
      tenant_id: T.acme,
      process_run_id: null,
    });
    expect(p.items).toEqual([
      {
        source_id: src.json.id,
        key: "app-repo",
        kind: "git_remote",
        config: src.json.config,
        allowlist_union: [],
      },
    ]);
    const got = await c.call("Adm", "GET", "/admin/sources/app-repo");
    expect(got.json.last_pin).toEqual(pin);
  });

  it("HUB-FR-120 · K-02 · Runtime trả SOURCE_UNRESOLVABLE ⇒ 422 SOURCE_UNRESOLVABLE", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const stub = resolveStub(c, () => ({ status: "error", code: "SOURCE_UNRESOLVABLE" }));
    const r = await c.call("Adm", "POST", "/admin/sources/app-repo/check");
    await stub.stop();
    expect(code(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
  });

  it.each(["SOURCE_TOO_LARGE", "SOURCE_HOST_NOT_ALLOWED"])(
    "HUB-FR-120 · K-03 · Runtime trả %s ⇒ 422 đúng mã",
    async (errCode) => {
      await mkSource(c, "Adm", gitBody("app-repo"));
      const stub = resolveStub(c, () => ({ status: "error", code: errCode }));
      const r = await c.call("Adm", "POST", "/admin/sources/app-repo/check");
      await stub.stop();
      expect(code(r)).toEqual({ status: 422, code: errCode });
    },
  );

  it("PB-R05 · C13 · K-04 · Runtime im lặng quá sourceCheckTimeoutMs ⇒ 422 SOURCE_UNRESOLVABLE", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    const stub = resolveStub(c, () => "silent");
    const t0 = Date.now();
    const r = await c.call("Adm", "POST", "/admin/sources/app-repo/check");
    await stub.stop();
    expect(code(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    expect(stub.seen.length).toBe(1); // job đã được enqueue (đỏ nếu route chưa có)
    expect(Date.now() - t0).toBeLessThan(10_000); // seam 1500 ms, không chờ mặc định 60 s
  });
});

describe("K-05 · không lộ path [PB-R21, C1]", () => {
  it("PB-R21 · C1 · K-05 · tenant_admin check local_path ⇒ response không chứa path (LocalPinPublic); platform_admin thấy path", async () => {
    await insertSource(c.sql, {
      tenant: T.acme,
      key: "pb-docs",
      kind: "local_path",
      config: { kind: "local_path", path: LOCAL_PATH },
    });
    const snap = "b1b10000-0000-4000-8000-000000000900";
    const full = { kind: "local_path", path: LOCAL_PATH, snapshot_id: snap };
    const stub = resolveStub(c, () => ({ status: "ok", pin: full }));
    const t = await c.call("Adm", "POST", "/admin/sources/pb-docs/check");
    expect(t.status).toBe(200);
    expect(t.text).not.toContain(LOCAL_PATH);
    expect(t.json.pin).toEqual({ kind: "local_path", snapshot_id: snap });
    const p = await c.call("P", "POST", `/admin/sources/pb-docs/check?tenant_id=${T.acme}`);
    await stub.stop();
    expect(p.status).toBe(200);
    expect(p.json.pin).toEqual(full);
  });
});

describe("K-06 · RS-05 · ID-07 · job-token đúng job + đúng tenant [PB-R18, AC-PB-04]", () => {
  it("PB-R18 · K-06 · token của job check A không dùng được cho job B (RS-05) hay không token ⇒ 401, không ghi last_pin", async () => {
    await mkSource(c, "Adm", gitBody("app-repo"));
    await mkSource(c, "Db", gitBody("app-repo"));
    const stub = resolveStub(c, () => "silent");
    const a = c.call("Adm", "POST", "/admin/sources/app-repo/check");
    const b = c.call("Db", "POST", "/admin/sources/app-repo/check");
    await waitFor(
      async () => stub.seen.length,
      (n) => n === 2,
      5000,
    );
    expect(stub.seen.length).toBe(2);
    const [ja, jb] = stub.seen as [(typeof stub.seen)[0], (typeof stub.seen)[0]];
    expect(ja.tenant_id).not.toBe(jb.tenant_id);
    const ok = (j: typeof ja): Json => ({
      results: (j.payload.items as Json[]).map((it) => ({
        status: "ok",
        source_id: it.source_id,
        pin: { kind: "git_remote", url: it.config.url, sha: SHA },
        files: 1,
        bytes: 1,
      })),
    });
    const cross = await postResolved(c, jb.id, ja.token, ok(jb)); // token acme → job beta
    const none = await postResolved(c, jb.id, null, ok(jb));
    const junk = await postResolved(c, jb.id, "pbtok-rac", ok(jb));
    expect([cross.status, none.status, junk.status]).toEqual([401, 401, 401]);
    expect(cross.json).toEqual(none.json); // RS-12: cùng một thân
    expect(cross.json).toEqual(junk.json);
    const betaView = await c.call("Db", "GET", "/admin/sources/app-repo");
    expect(betaView.json.last_pin).toBeNull(); // chưa job nào hoàn tất ⇒ không ghim
    // dọn: cho hai check kết thúc đúng token để request treo không rò sang ca sau
    await postResolved(c, ja.id, ja.token, ok(ja));
    await postResolved(c, jb.id, jb.token, ok(jb));
    await Promise.all([a, b]);
    await stub.stop();
  });

  it("AC-PB-04 · ID-07 · nguồn library acme trỏ document_id của beta (SQL) ⇒ check không 200, không rò nội dung; job-token acme tải document beta ⇒ 401", async () => {
    const betaDoc = await seedLibraryDoc(c.sql, {
      tenant: PA.D.tid,
      userId: PA.D.id,
      name: "beta-secret.md",
    });
    expect(betaDoc).not.toBeNull(); // đỏ nếu schema chưa nhận origin 'library'
    await insertSource(c.sql, {
      tenant: T.acme,
      key: "lib-cross",
      kind: "library",
      config: { kind: "library", document_id: betaDoc },
    });
    const stub = resolveStub(c, () => ({ status: "error", code: "SOURCE_UNRESOLVABLE" }));
    const r = await c.call("Adm", "POST", "/admin/sources/lib-cross/check");
    expect(code(r)).toEqual({ status: 422, code: "SOURCE_UNRESOLVABLE" });
    expect(r.text).not.toContain("beta-secret");
    const job = stub.seen[0];
    await stub.stop();
    if (job) {
      const res = await fetch(`${c.base}/internal/jobs/${job.id}/attachments/${betaDoc}`, {
        headers: { authorization: `Bearer ${job.token}` },
      });
      expect(res.status).toBe(401);
    }
  });
});
