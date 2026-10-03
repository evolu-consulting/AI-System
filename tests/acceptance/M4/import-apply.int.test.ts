// ADM-FR-54 · M4-R14 · M4-R15 · M4-AC10 · AC-A09 · Import áp dụng (test-plan-cd-transfer §3.3, T8). Xanh ở T8.
// Một transaction, một audit `import`, một NOTIFY, không xoá; config đổi sau dry-run → 409.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  auditSince,
  checksumAdmin,
  createM3Env,
  expectErr,
  exportReq,
  ID,
  importReq,
  LEAK_1,
  LEAK_2,
  type Listener,
  leakForms,
  type M3Env,
  type Res,
  scanDatabase,
  TENANT_ID,
  track,
} from "./_cd";
import {
  baseFile,
  commandEl,
  FILE_NAME,
  FROM_VERSION,
  grantEl,
  groupEl,
  header,
  NEW_DESC,
  TYPES,
  tenantEl,
  toYaml,
} from "./_transfer-data";

// biome-ignore lint/suspicious/noExplicitAny: JSON / hàng DB
type Obj = Record<string, any>;
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

const apply = async (content: string, extra: Obj = {}): Promise<Res> =>
  importReq(
    env,
    { file_name: FILE_NAME, content, base_config_version: await env.cfg(), ...extra },
    "0",
  );
const applyBase = () => apply(baseFile(), { secrets: { DIFY_REPORT_KEY: LEAK_2 } });
const one = async (q: string): Promise<Obj | undefined> =>
  (await env.owner.unsafe(q))[0] as Obj | undefined;
const count = async (q: string): Promise<number> => Number((await one(q))?.n ?? -1);
const adminId = async () => (await one("select id from admin.users where username = 'admin'"))?.id;
const tenantFile = (t: Obj) => toYaml({ ...header(), tenants: [t] });

describe("ADM-FR-54 · secrets khi áp dụng (M4-R15)", () => {
  it("ADM-FR-54 · C-A01 · M4-AC10 · thiếu giá trị secret → 400 SECRETS_REQUIRED {missing}; DB không đổi", async () => {
    const sum0 = await checksumAdmin(env);
    const res = await apply(baseFile());
    expectErr(res, "SECRETS_REQUIRED");
    expect(res.json.error.details).toEqual({ missing: ["DIFY_REPORT_KEY"] });
    expect(await checksumAdmin(env)).toEqual(sum0);
  });

  it("ADM-FR-54 · C-A02 · secrets có tên đã tồn tại → 400 VALIDATION_ERROR fields.secrets; ciphertext cũ giữ nguyên", async () => {
    const q =
      "select encode(ciphertext, 'hex') as h from admin.secrets where name = 'DIFY_TRANSLATE_KEY'";
    const before = (await one(q))?.h;
    const res = await apply(baseFile(), {
      secrets: { DIFY_TRANSLATE_KEY: LEAK_1, DIFY_REPORT_KEY: LEAK_2 },
    });
    expectErr(res, "VALIDATION_ERROR");
    expect(res.json.error.details.fields.secrets).toEqual(["DIFY_TRANSLATE_KEY"]);
    expect((await one(q))?.h).toBe(before);
  });

  it("ADM-FR-54 · C-A03 · áp dụng thiếu base_config_version → 400 VALIDATION_ERROR", async () => {
    const body = {
      file_name: FILE_NAME,
      content: baseFile(),
      secrets: { DIFY_REPORT_KEY: LEAK_2 },
    };
    expectErr(await importReq(env, body, "0"), "VALIDATION_ERROR");
  });
});

describe("ADM-FR-54 · áp dụng thành công", () => {
  it("ADM-FR-54 · C-A04 · M4-AC10 · 200 {n+1, summary, secrets_created 1}; translate version+1, report-new trỏ secret mới, bao-cao-moi ∈ bao-cao", async () => {
    const n = await env.cfg();
    const res = await applyBase();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      config_version: n + 1,
      summary: { added: 2, updated: 3, unchanged: 0 },
      secrets_created: 1,
    });
    const tr = await one(
      "select description, version, updated_by from admin.workflows where key = 'translate'",
    );
    expect(tr).toMatchObject({ description: NEW_DESC, version: 2, updated_by: await adminId() });
    const rn =
      await one(`select s.name, s.last4 from admin.workflows w join admin.secrets s on s.id = w.secret_id
      where w.key = 'report-new'`);
    expect(rn).toEqual({ name: "DIFY_REPORT_KEY", last4: LEAK_2.slice(-4) });
    const member = await count(`select count(*)::int as n from admin.feature_commands fc
      join admin.features f on f.id = fc.feature_id join admin.commands c on c.id = fc.command_id
      where f.key = 'bao-cao' and c.name = 'bao-cao-moi'`);
    expect(member).toBe(1);
    expect((await one("select name from admin.tenants where key = 'acme'"))?.name).toBe(
      "Acme Corporation",
    );
    expect(await env.cfg()).toBe(n + 1);
  });

  it("ADM-FR-54 · C-A05 · M4-R14 · M4-R10 · đúng 1 dòng audit import (entity config), after allowlist; không rò LEAK_2", async () => {
    const n = await env.cfg();
    const mark = await auditMark(env);
    expect((await applyBase()).status).toBe(200);
    const rows = (await auditSince(env, mark)) as Obj[];
    expect(rows).toHaveLength(1);
    const a = rows[0] as Obj;
    expect(a).toMatchObject({
      action: "import",
      entity: "config",
      entity_id: null,
      entity_name: FILE_NAME,
      tenant_id: null,
      config_version: n + 1,
    });
    const pairs = (xs: Obj[]) => xs.map((x) => `${x.type}:${x.key}`).sort();
    expect(pairs(a.after.added)).toEqual(["command:bao-cao-moi", "workflow:report-new"]);
    expect(pairs(a.after.updated)).toEqual([
      "feature:bao-cao",
      "tenant:acme",
      "workflow:translate",
    ]);
    expect(a.after.secrets_created).toEqual(["DIFY_REPORT_KEY"]);
    expect(a.after.from_config_version).toBe(FROM_VERSION);
    const allowed = ["from_config_version", "added", "updated", "secrets_created", "truncated"];
    for (const k of Object.keys(a.after)) expect(allowed).toContain(k);
    expect(await scanDatabase(env.owner, leakForms(LEAK_2))).toEqual([]);
  });

  it("ADM-FR-54 · C-A06 · M4-R14 · đúng 1 NOTIFY v = n+1 (sau commit)", async () => {
    const t = await track(env, lis, applyBase);
    expect(t.res.status).toBe(200);
    expect(t.msgs).toHaveLength(1);
    expect(t.msgs[0]?.payload.v).toBe(t.v0 + 1);
    expect(t.v1).toBe(t.v0 + 1);
  });

  it("ADM-FR-54 · C-A07 · M4-R14 không xoá · workflow/feature/entitlement/grant ngoài file còn nguyên", async () => {
    const grants0 = await count("select count(*)::int as n from admin.feature_grants");
    const ent0 = await count(
      "select count(*)::int as n from admin.feature_entitlements where revoked_at is null",
    );
    expect((await applyBase()).status).toBe(200);
    expect(
      await count(
        "select count(*)::int as n from admin.workflows where key in ('summarize','report-tax')",
      ),
    ).toBe(2);
    const keToan =
      await env.owner`select c.name from admin.feature_commands fc join admin.features f on f.id = fc.feature_id
      join admin.commands c on c.id = fc.command_id where f.key = 'ke-toan' order by 1`;
    expect(keToan.map((r) => r.name)).toEqual(["kiemtra-hoadon"]);
    expect(await count("select count(*)::int as n from admin.feature_grants")).toBe(grants0);
    expect(
      await count(
        "select count(*)::int as n from admin.feature_entitlements where revoked_at is null",
      ),
    ).toBe(ent0);
  });
});

describe("ADM-FR-54 · xung đột + không đổi + lỗi", () => {
  it("ADM-FR-54 · C-A08 · plan D8 · config đổi sau dry-run → 409 VERSION_CONFLICT {current}; rollback toàn bộ", async () => {
    const n = await env.cfg();
    const d = await importReq(env, { file_name: FILE_NAME, content: baseFile() }, "1");
    expect(d.status).toBe(200);
    const p = await env.patch(`/admin/commands/${ID.command.trNhanh}`, {
      token: await env.admin(),
      body: { version: 1, enabled: true },
    });
    expect(p.status).toBe(200);
    const mark = await auditMark(env);
    const t = await track(env, lis, () =>
      importReq(
        env,
        {
          file_name: FILE_NAME,
          content: baseFile(),
          base_config_version: n,
          secrets: { DIFY_REPORT_KEY: LEAK_2 },
        },
        "0",
      ),
    );
    expectErr(t.res, "VERSION_CONFLICT");
    expect(t.res.json.error.details).toEqual({ current: n + 1 });
    expect(t.msgs).toHaveLength(0);
    expect(
      (await one("select description from admin.workflows where key = 'translate'"))?.description,
    ).not.toBe(NEW_DESC);
    expect(
      await count("select count(*)::int as n from admin.secrets where name = 'DIFY_REPORT_KEY'"),
    ).toBe(0);
    const imports = ((await auditSince(env, mark)) as Obj[]).filter((r) => r.action === "import");
    expect(imports).toHaveLength(0);
  });

  it("ADM-FR-54 · C-A09 · 2 áp dụng song song cùng base → 1 × 200, 1 × 409", async () => {
    const n = await env.cfg();
    const body = {
      file_name: FILE_NAME,
      content: baseFile(),
      base_config_version: n,
      secrets: { DIFY_REPORT_KEY: LEAK_2 },
    };
    const res = await Promise.all([importReq(env, body, "0"), importReq(env, body, "0")]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("ADM-FR-54 · C-A10 · file không có thay đổi (body export) → 200 config_version hiện tại; 0 audit, 0 NOTIFY", async () => {
    const ex = await exportReq(env, `?types=${TYPES.join(",")}`);
    expect(ex.status).toBe(200);
    const mark = await auditMark(env);
    let audit: unknown[] = [];
    const t = await track(env, lis, async () => {
      const r = await apply(ex.text);
      audit = r.status === 200 ? [...(await auditSince(env, mark))] : [];
      return r;
    });
    expect(t.res.status).toBe(200);
    expect(t.res.json.config_version).toBe(t.v0);
    expect(t.v1).toBe(t.v0);
    expect(t.msgs).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it("ADM-FR-54 · C-A11 · file lỗi (REF_NOT_FOUND) áp dụng → 400 IMPORT_INVALID {errors}; DB không đổi", async () => {
    const sum0 = await checksumAdmin(env);
    const res = await apply(
      toYaml({ ...header(), commands: [{ ...commandEl("dich"), workflow: "translat" }] }),
    );
    expectErr(res, "IMPORT_INVALID");
    expect((res.json.error.details.errors as Obj[]).map((e) => e.code)).toContain("REF_NOT_FOUND");
    expect(await checksumAdmin(env)).toEqual(sum0);
  });

  it("ADM-FR-54 · C-A12 · Q11 · tenant acme đổi tên/slot + quota cả tenant → 200; tenant version +1; số tenant không đổi", async () => {
    const tenants0 = await count("select count(*)::int as n from admin.tenants");
    const v0 = await count("select version::int as n from admin.tenants where key = 'acme'");
    const acme = tenantEl("acme", {
      name: "Acme Mới",
      max_concurrent_sub: 3,
      quotas: [{ feature: null, max_runs: 1000 }],
    });
    expect((await apply(tenantFile(acme))).status).toBe(200);
    expect(
      await one("select name, max_concurrent_sub from admin.tenants where key = 'acme'"),
    ).toEqual({
      name: "Acme Mới",
      max_concurrent_sub: 3,
    });
    expect(await count("select version::int as n from admin.tenants where key = 'acme'")).toBe(
      v0 + 1,
    );
    expect(
      await count(
        `select count(*)::int as n from admin.tenant_quotas where tenant_id = '${TENANT_ID.acme}'`,
      ),
    ).toBe(1);
    expect(await count("select count(*)::int as n from admin.tenants")).toBe(tenants0);
  });

  it("ADM-FR-54 · C-A13 · grant mới + entitlement cùng file → 200; không entitlement → 400 IMPORT_INVALID NOT_ENTITLED", async () => {
    const acme = tenantEl("acme", {
      entitlements: ["bao-cao", "dich-thuat", "ke-toan", "phap-che"],
    });
    const ok = await apply(
      toYaml({ ...header(), tenants: [acme], grants: [grantEl("acme", "kinh-doanh", "phap-che")] }),
    );
    expect(ok.status).toBe(200);
    expect(
      await count(`select count(*)::int as n from admin.feature_grants g join admin.groups gr on gr.id = g.group_id
        join admin.features f on f.id = g.feature_id where gr.key = 'kinh-doanh' and f.key = 'phap-che'`),
    ).toBe(1);
    const bad = await apply(
      toYaml({ ...header(), grants: [grantEl("globex", "ke-toan", "phap-che")] }),
    );
    expectErr(bad, "IMPORT_INVALID");
    expect((bad.json.error.details.errors as Obj[]).map((e) => e.code)).toContain("NOT_ENTITLED");
  });

  it("ADM-FR-54 · C-A15 · M4-R14 · quota upsert theo (tenant, feature): áp 2 lần → đúng 2 hàng, hàng null max_runs 2000, ke-toan giữ", async () => {
    const q = (runs: number) =>
      tenantEl("acme", {
        quotas: [
          { feature: null, max_runs: runs },
          { feature: "ke-toan", max_usd: "300.00" },
        ],
      });
    expect((await apply(tenantFile(q(1000)))).status).toBe(200);
    expect((await apply(tenantFile(q(2000)))).status).toBe(200);
    const rows =
      await env.owner`select f.key, q.max_runs, q.max_usd::text as usd from admin.tenant_quotas q
      left join admin.features f on f.id = q.feature_id where q.tenant_id = ${TENANT_ID.acme} order by f.key nulls first`;
    expect(rows.map((r) => [r.key, r.max_runs, r.usd])).toEqual([
      [null, 2000, null],
      ["ke-toan", null, "300.00"],
    ]);
  });

  it("ADM-FR-54 · C-A14 · AC-A09 · group/grant tenant globex → tenant_id globex; binh (acme) không thấy group mới", async () => {
    const globex = tenantEl("globex", { entitlements: ["dich-thuat"] });
    const res = await apply(
      toYaml({
        ...header(),
        tenants: [globex],
        groups: [groupEl("globex", "phap-ly", "Pháp lý")],
        grants: [grantEl("globex", "phap-ly", "dich-thuat")],
      }),
    );
    expect(res.status).toBe(200);
    const g = await one("select id, tenant_id from admin.groups where key = 'phap-ly'");
    expect(g?.tenant_id).toBe(TENANT_ID.globex);
    const gr = await one(`select tenant_id from admin.feature_grants where group_id = '${g?.id}'`);
    expect(gr?.tenant_id).toBe(TENANT_ID.globex);
    const list = await env.get("/admin/groups", { token: await env.token("acme", "binh") });
    expect(list.status).toBe(200);
    expect((list.json.items as Obj[]).map((x) => x.key)).not.toContain("phap-ly");
  });
});
