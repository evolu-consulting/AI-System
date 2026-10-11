// P-b · PF-S3 · HUB-FR-124 · ADM-FR-68 · AC-H37 · C2 · C3 · C19 · CW-01…CW-03, LD-01…LD-05.
// (1) Wiring chat: `GET /processes` (ProcessCatalogItem) trả `inputs[]` (C2); `POST /process-runs` (CreateProcessRunRequest) nhận `inputs`
//     (C19) mà vẫn tương thích P-a (không `inputs`).
// (2) `GET /admin/sources/library-documents` (C3, route hoãn từ S1): `{items:[{id,name,version,updated_at}], next_cursor}` theo tenant.
// Đỏ trước code S3: catalog chưa có `inputs`; `POST /process-runs` có `inputs` ⇒ 400 (contract strict); library-documents ⇒ 404.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { anon, seedLibraryDoc } from "../pfs1/_local";
import {
  type Ctx3,
  code,
  type Json,
  mkDef,
  PA,
  SRC,
  seedSources,
  settle,
  start3,
  startRun,
  T,
  vcode,
} from "./_local";

const INPUT_DEFS: Json[] = [
  { key: "repo", label: "Repo + branch", type: "source_ref", required: true },
  { key: "goal", label: "Mục tiêu", type: "text", required: false },
  { key: "env", label: "Môi trường", type: "select", required: false, options: ["dev", "stg"] },
];

let c: Ctx3;
let betaDoc: string;
beforeAll(async () => {
  c = await start3();
  await seedSources(c); // acme: quy-dinh.md (library); beta-repo
  await mkDef(c, "pbx-in", {
    sources: ["app-repo"],
    inputs: INPUT_DEFS,
    stages: [{ key: "i0", sources: [SRC("app-repo", "src/**")], after: "auto" }],
  });
  await mkDef(c, "pbx-plain", { stages: [{ key: "p0", after: "auto" }] });
  const hd = await seedLibraryDoc(c.sql, {
    tenant: T.acme,
    userId: PA.Adm.id,
    name: "huong-dan.md",
  });
  const bd = await seedLibraryDoc(c.sql, {
    tenant: T.beta,
    userId: PA.D.id,
    name: "beta-secret.md",
  });
  if (!hd || !bd) throw new Error("FIXTURE SAI: seedLibraryDoc null");
  betaDoc = bd;
}, 90_000);
afterEach(async () => {
  if (c) await settle(c);
});
afterAll(async () => {
  await c?.stop();
});

describe("CW-01…03 · wiring chat inputs [C2, C19]", () => {
  it("HUB-FR-124 · C2 · CW-01 · GET /processes: def có inputs ⇒ items[].inputs đúng; def không inputs ⇒ []", async () => {
    const r = await c.call("A", "GET", "/processes");
    expect(r.status).toBe(200);
    const items = r.json.items as Json[];
    expect(items.find((i) => i.key === "pbx-in")?.inputs).toEqual(INPUT_DEFS);
    expect(items.find((i) => i.key === "pbx-plain")?.inputs).toEqual([]);
    expect(items.find((i) => i.key === "hoa-don-t")?.inputs).toEqual([]); // def P-a có sẵn
    for (const i of items) expect(Array.isArray(i.inputs)).toBe(true);
  }, 30_000);

  it("HUB-FR-124 · C2 · CW-02 · catalog chỉ trả inputs của tenant mình (beta không thấy pbx-in)", async () => {
    const a = await c.call("A", "GET", "/processes");
    expect(
      ((a.json.items as Json[]).find((i) => i.key === "pbx-in")?.inputs as Json[])?.length,
    ).toBe(3);
    const r = await c.call("D", "GET", "/processes");
    expect(r.status).toBe(200);
    expect((r.json.items as Json[]).map((i) => i.key)).not.toContain("pbx-in");
  }, 30_000);

  it("AC-H37 · C19 · CW-03 · POST /process-runs: có inputs hợp lệ ⇒ 201; inputs=[] / vắng ⇒ 201 (tương thích P-a); trường lạ ⇒ 4xx; def không khai inputs mà gửi ⇒ 422", async () => {
    const withInputs = await startRun(c, "pbx-in", {
      inputs: [
        { type: "source_ref", key: "repo", source_key: "app-repo", branch: "main" },
        { type: "select", key: "env", value: "dev" },
      ],
    });
    expect(withInputs.res.status).toBe(201);
    await settle(c);
    expect((await startRun(c, "pbx-plain", { inputs: [] })).res.status).toBe(201);
    expect((await startRun(c, "pbx-plain")).res.status).toBe(201);
    const extra = await c.call("A", "POST", "/process-runs", {
      process_key: "pbx-plain",
      input: "x",
      origin: { kind: "none" },
      pinned_sources: [], // KHÔNG được nhận từ client
    });
    expect(extra.status).toBeGreaterThanOrEqual(400);
    expect(extra.status).toBeLessThan(500);
    const lạ = await startRun(c, "pbx-plain", {
      inputs: [{ type: "text", key: "goal", text: "x" }],
    });
    expect(vcode(lạ.res)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
  }, 45_000);
});

describe("LD-01…05 · GET /admin/sources/library-documents [C3]", () => {
  const list = (role: "Adm" | "Db" | "A" | "P", qs = "") =>
    c.call(role, "GET", `/admin/sources/library-documents${qs}`);
  const names = (r: { json: Json }) =>
    ((r.json?.items ?? []) as Json[]).map((i) => i.name as string).sort();

  it("ADM-FR-68 · LD-01 · tenant_admin ⇒ 200 {items,next_cursor}; mỗi item đúng {id,name,version,updated_at}; chỉ tài liệu tenant mình", async () => {
    const r = await list("Adm");
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["items", "next_cursor"]);
    expect(names(r)).toEqual(["huong-dan.md", "quy-dinh.md"]);
    for (const it of r.json.items as Json[]) {
      expect(Object.keys(it).sort()).toEqual(["id", "name", "updated_at", "version"]);
      expect(typeof it.version).toBe("string");
      expect(Number.isNaN(Date.parse(it.updated_at))).toBe(false);
    }
    expect(r.text).not.toContain(betaDoc);
    expect(r.text).not.toContain("beta-secret");
    expect(r.json.next_cursor).toBeNull();
  }, 30_000);

  it("ADM-FR-68 · LD-02 · phân trang limit=1 + cursor ⇒ duyệt hết 2 tài liệu, không trùng", async () => {
    const p1 = await list("Adm", "?limit=1");
    expect(p1.status).toBe(200);
    expect(p1.json.items).toHaveLength(1);
    expect(typeof p1.json.next_cursor).toBe("string");
    const p2 = await list("Adm", `?limit=1&cursor=${encodeURIComponent(p1.json.next_cursor)}`);
    expect(p2.status).toBe(200);
    expect(p2.json.items).toHaveLength(1);
    expect(p2.json.items[0].id).not.toBe(p1.json.items[0].id);
    expect([p1.json.items[0].name, p2.json.items[0].name].sort()).toEqual([
      "huong-dan.md",
      "quy-dinh.md",
    ]);
    expect(p2.json.next_cursor).toBeNull();
  }, 30_000);

  it("ADM-FR-68 · LD-03 · q lọc theo tên (không phân biệt hoa-thường)", async () => {
    expect(names(await list("Adm", "?q=QUY"))).toEqual(["quy-dinh.md"]);
    expect(names(await list("Adm", "?q=khong-co-tai-lieu-nay"))).toEqual([]);
  }, 30_000);

  it("ADM-FR-68 · LD-04 · cách ly tenant: tenant_admin beta chỉ thấy tài liệu beta; member ⇒ 403; không token ⇒ 401; limit=101 ⇒ 4xx", async () => {
    const beta = await list("Db");
    expect(beta.status).toBe(200);
    expect(names(beta)).toEqual(["beta-secret.md"]);
    expect(beta.text).not.toContain("quy-dinh");
    expect(code(await list("A"))).toEqual({ status: 403, code: "FORBIDDEN" });
    expect((await anon(c as never, "GET", "/admin/sources/library-documents")).status).toBe(401);
    const big = await list("Adm", "?limit=101");
    expect(big.status).toBeGreaterThanOrEqual(400);
    expect(big.status).toBeLessThan(500);
  }, 30_000);

  it("ADM-FR-68 · LD-05 · platform_admin + ?tenant_id=acme ⇒ tài liệu acme", async () => {
    const r = await list("P", `?tenant_id=${T.acme}`);
    expect(r.status).toBe(200);
    expect(names(r)).toEqual(["huong-dan.md", "quy-dinh.md"]);
  }, 30_000);
});
