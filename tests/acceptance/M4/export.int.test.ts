// ADM-FR-54 · M4-R14 · AC-A06 · ADM-BR-04 · M4-AC09 · Export yaml (test-plan-cd-transfer §3.1, T7). Xanh ở T7
// (C-E09 cần dry-run của T8). Parse yaml bằng `Bun.YAML` (thư viện `yaml` của sản phẩm không có ở gốc repo).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  apiSecret,
  auditMark,
  auditSince,
  createM3Env,
  expectErr,
  exportReq,
  importReq,
  LEAK_1,
  type Listener,
  leaked,
  leakForms,
  type M3Env,
  track,
} from "./_cd";
import { loadTransferContract } from "./_cd-modules";
import { TYPES } from "./_transfer-data";

// biome-ignore lint/suspicious/noExplicitAny: yaml đã parse
type Obj = Record<string, any>;
const ALL = `?types=${TYPES.join(",")}`;
let env: M3Env;
let lis: Listener;

beforeAll(async () => {
  env = await createM3Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset3();
});

const parse = (text: string): Obj => Bun.YAML.parse(text) as Obj;
const sortKeyOf = (t: string, e: Obj): string =>
  t === "commands"
    ? e.name
    : t === "groups"
      ? `${e.tenant}/${e.key}`
      : t === "grants"
        ? `${e.tenant}/${e.group}/${e.feature}`
        : e.key;

async function exportAll() {
  const res = await exportReq(env, ALL);
  expect(res.status).toBe(200);
  return { res, body: parse(res.text) };
}

describe("ADM-FR-54 · GET /admin/export", () => {
  it("ADM-FR-54 · C-E01 · M4-AC09 · 200 yaml: header đúng, không BOM, qua ConfigFileSchema, danh sách sắp theo key", async () => {
    const n = await env.cfg();
    const { res, body } = await exportAll();
    expect(res.headers.get("content-type")).toBe("application/yaml; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="config-v${n}.yaml"`);
    expect(res.headers.get("x-config-version")).toBe(String(n));
    expect(res.text.charCodeAt(0)).not.toBe(0xfeff);
    const { ConfigFileSchema } = await loadTransferContract();
    expect(ConfigFileSchema.safeParse(body).success).toBe(true);
    expect(body.config_version).toBe(n);
    for (const t of TYPES) {
      const keys = (body[t] as Obj[]).map((e) => sortKeyOf(t, e));
      expect(keys).toEqual([...keys].sort());
    }
  });

  it("ADM-FR-54 · C-E02 · AC-A06 · ADM-BR-04 · secrets chỉ tên workflow dùng; không giá trị, last4, UUID", async () => {
    await apiSecret(env, "DIFY_LEAK_KEY", LEAK_1);
    const { res, body } = await exportAll();
    expect(body.secrets).toEqual([{ name: "DIFY_INVOICE_KEY" }, { name: "DIFY_TRANSLATE_KEY" }]);
    expect(leaked({ body: res.text }, leakForms(LEAK_1))).toEqual([]);
    for (const l4 of ["7f3a", "91c2", "44aa", LEAK_1.slice(-4)]) expect(res.text).not.toContain(l4);
    expect(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(res.text)).toBe(false);
  });

  it("ADM-FR-54 · C-E03 · plan §3.2 · không tenant platform; grants chỉ cho group (grant user vắng); groups[].tenant là key", async () => {
    const { body } = await exportAll();
    expect((body.tenants as Obj[]).map((t) => t.key)).not.toContain("platform");
    const grants = body.grants as Obj[];
    expect(grants.map((g) => sortKeyOf("grants", g)).sort()).toEqual([
      "acme/beta-testers/bao-cao",
      "acme/ke-toan/ke-toan",
      "globex/ke-toan/ke-toan",
    ]);
    for (const g of body.groups as Obj[]) expect(["acme", "globex", "zeta"]).toContain(g.tenant);
  });

  it("ADM-FR-54 · C-E04 · types=commands → chỉ khoá commands (+ đầu file)", async () => {
    const res = await exportReq(env, "?types=commands");
    expect(res.status).toBe(200);
    const extra = Object.keys(parse(res.text)).filter(
      (k) =>
        ![
          "format",
          "format_version",
          "config_version",
          "exported_at",
          "secrets",
          "commands",
        ].includes(k),
    );
    expect(extra).toEqual([]);
  });

  it("ADM-FR-54 · C-E05 · types rỗng / users / trùng / thiếu → 400 VALIDATION_ERROR ×4", async () => {
    for (const q of ["?types=", "?types=users", "?types=commands,commands", ""]) {
      expectErr(await exportReq(env, q), "VALIDATION_ERROR");
    }
  });

  it("ADM-FR-54 · C-E06 · M4-AC12 · tenant_admin, member → 403 (export + meta); không token → 401", async () => {
    for (const u of ["binh", "an"]) {
      const token = await env.token("acme", u);
      expectErr(await exportReq(env, ALL, token), "FORBIDDEN");
      expectErr(await env.get("/admin/export/meta", { token }), "FORBIDDEN");
    }
    expectErr(await env.get(`/admin/export${ALL}`), "UNAUTHORIZED");
  });

  it("ADM-FR-54 · C-E07 · /admin/export/meta: config_version + counts khớp số phần tử export", async () => {
    const meta = await env.get("/admin/export/meta", { token: await env.admin() });
    expect(meta.status).toBe(200);
    const { body } = await exportAll();
    expect(meta.json.config_version).toBe(await env.cfg());
    const counts = Object.fromEntries(TYPES.map((t) => [t, (body[t] as Obj[]).length]));
    expect(meta.json.counts).toEqual(counts);
  });

  it("ADM-FR-54 · C-E08 · chỉ đọc: config_version, audit_log không đổi; 0 NOTIFY", async () => {
    const mark = await auditMark(env);
    let audit: unknown[] = [];
    const t = await track(env, lis, async () => {
      const r = await exportReq(env, ALL);
      audit = r.status === 200 ? [...(await auditSince(env, mark))] : [];
      return r;
    });
    expect(t.res.status).toBe(200);
    expect(t.v1).toBe(t.v0);
    expect(t.msgs).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it("ADM-FR-54 · C-E09 · round-trip: dry-run đúng body export → valid, added 0, updated 0, items []", async () => {
    const { res } = await exportAll();
    const d = await importReq(env, { file_name: "config-roundtrip.yaml", content: res.text }, "1");
    expect(d.status).toBe(200);
    expect(d.json.valid).toBe(true);
    expect(d.json.summary).toMatchObject({ added: 0, updated: 0 });
    expect(d.json.items).toEqual([]);
  });
});
