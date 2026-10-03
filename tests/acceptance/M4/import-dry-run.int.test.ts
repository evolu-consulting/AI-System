// ADM-FR-54 · M4-R14 · M4-R15 · M4-AC09 · ADM-BR-04 · Import xem trước (test-plan-cd-transfer §3.2, T8). Xanh ở T8.
// Dry-run không ghi gì: so checksum mọi bảng admin.*, config_version, audit_log; 0 NOTIFY.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  auditSince,
  captureLogs,
  checksumAdmin,
  createM3Env,
  expectErr,
  importReq,
  LEAK_1,
  LEAK_2,
  type Listener,
  leaked,
  leakForms,
  type M3Env,
  scanDatabase,
  track,
} from "./_cd";
import {
  BROKEN_LINE3,
  baseFile,
  baseObject,
  bomAlias,
  commandEl,
  DUP_KEYS,
  FILE_NAME,
  FROM_VERSION,
  header,
  MAX_BYTES,
  multiByte,
  ONE_ALIAS,
  padTo,
  tenantEl,
  toYaml,
} from "./_transfer-data";

// biome-ignore lint/suspicious/noExplicitAny: JSON response
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

const req = (content: string, extra: Obj = {}) => ({ file_name: FILE_NAME, content, ...extra });
const dry = (content: string, extra: Obj = {}) => importReq(env, req(content, extra), "1");
const errorsOf = (r: Obj) => r.json.errors as Obj[];

/** Chạy `run`, chứng minh không ghi gì: checksum bảng, config_version, audit_log, NOTIFY. */
async function expectNoWrite(run: () => Promise<Obj>): Promise<Obj> {
  const sum0 = await checksumAdmin(env);
  const mark = await auditMark(env);
  let audit: unknown[] = [];
  let sum1: Record<string, string> = {};
  const t = await track(env, lis, async () => {
    const r = await run();
    sum1 = await checksumAdmin(env);
    audit = [...(await auditSince(env, mark))];
    return r as never;
  });
  expect(t.res.status).toBe(200);
  expect(sum1).toEqual(sum0);
  expect(t.v1).toBe(t.v0);
  expect(t.msgs).toHaveLength(0);
  expect(audit).toHaveLength(0);
  return t.res;
}

describe("ADM-FR-54 · POST /admin/import?dry_run=1", () => {
  it("ADM-FR-54 · C-I01 · M4-AC09 · baseFile → valid, summary {2,3,0}, items đúng op, missing_secrets, base/from version", async () => {
    const n = await env.cfg();
    const res = await dry(baseFile());
    expect(res.status).toBe(200);
    expect(res.json.valid).toBe(true);
    expect(res.json.summary).toEqual({ added: 2, updated: 3, unchanged: 0 });
    const ops = (res.json.items as Obj[]).map((i) => `${i.type}:${i.key}:${i.op}`).sort();
    expect(ops).toEqual([
      "command:bao-cao-moi:add",
      "feature:bao-cao:update",
      "tenant:acme:update",
      "workflow:report-new:add",
      "workflow:translate:update",
    ]);
    expect(res.json.missing_secrets).toEqual([
      { name: "DIFY_REPORT_KEY", used_by: ["report-new"] },
    ]);
    expect(res.json.base_config_version).toBe(n);
    expect(res.json.from_config_version).toBe(FROM_VERSION);
    expect(res.json.errors).toEqual([]);
  });

  it("ADM-FR-54 · C-I02 · M4-R14 · dry-run không ghi: checksum admin.*, config_version, audit_log không đổi; 0 NOTIFY", async () => {
    await expectNoWrite(() => dry(baseFile()));
  });

  it("ADM-FR-54 · C-I03 · plan §3.3 · không gửi dry_run → mặc định xem trước, không ghi", async () => {
    const res = await expectNoWrite(() => importReq(env, req(baseFile())));
    expect(res.json.valid).toBe(true);
    expect(res.json.summary).toEqual({ added: 2, updated: 3, unchanged: 0 });
  });

  it("ADM-FR-54 · C-I04 · yaml hỏng dòng 3 → valid false, YAML_SYNTAX có line 3 + col", async () => {
    const res = await dry(BROKEN_LINE3);
    expect(res.status).toBe(200);
    expect(res.json.valid).toBe(false);
    expect(errorsOf(res)[0]).toMatchObject({ code: "YAML_SYNTAX", line: 3 });
    expect(typeof errorsOf(res)[0]?.col).toBe("number");
  });

  it("ADM-FR-54 · C-I05 · command thiếu workflow → SCHEMA tại commands[2].workflow; workflow 'translat' → REF_NOT_FOUND tại commands[0].workflow", async () => {
    const { workflow: _w, ...noWf } = commandEl("kiemtra-hoadon");
    const r1 = await dry(
      toYaml({ ...header(), commands: [commandEl("dich"), commandEl("tom-tat"), noWf] }),
    );
    expect(r1.status).toBe(200);
    expect(errorsOf(r1)).toContainEqual(
      expect.objectContaining({ code: "SCHEMA", path: "commands[2].workflow" }),
    );
    const r2 = await dry(
      toYaml({ ...header(), commands: [{ ...commandEl("dich"), workflow: "translat" }] }),
    );
    expect(errorsOf(r2)).toContainEqual(
      expect.objectContaining({ code: "REF_NOT_FOUND", path: "commands[0].workflow" }),
    );
  });

  it("ADM-FR-54 · C-I06 · Q11 · tenant newco → TENANT_NOT_FOUND; không tạo tenant", async () => {
    const newco = {
      key: "newco",
      name: "New Co",
      max_concurrent_sub: null,
      entitlements: [],
      quotas: [],
    };
    const res = await dry(toYaml({ ...header(), tenants: [newco] }));
    expect(res.status).toBe(200);
    expect(errorsOf(res).map((e) => e.code)).toContain("TENANT_NOT_FOUND");
    const [r] = await env.owner`select count(*)::int as n from admin.tenants where key = 'newco'`;
    expect(r?.n).toBe(0);
  });

  it("ADM-FR-54 · C-I07 · ADM-BR-04 · file có secrets[].value → SCHEMA; response không chứa giá trị", async () => {
    const f = { ...baseObject(), secrets: [{ name: "DIFY_REPORT_KEY", value: LEAK_1 }] };
    const res = await dry(toYaml(f));
    expect(res.status).toBe(200);
    expect(res.json.valid).toBe(false);
    expect(errorsOf(res).map((e) => e.code)).toContain("SCHEMA");
    expect(leaked({ res: res.text }, leakForms(LEAK_1))).toEqual([]);
  });

  it("ADM-FR-54 · C-I08 · M4-R15 · dry-run có secrets{} → bỏ qua: không tạo secret; LEAK_2 không ở response, DB, log", async () => {
    const cap = captureLogs();
    let text = "";
    let status = 0;
    try {
      const res = await dry(baseFile(), { secrets: { DIFY_REPORT_KEY: LEAK_2 } });
      text = res.text;
      status = res.status;
    } finally {
      cap.restore();
    }
    expect(status).toBe(200);
    const [r] =
      await env.owner`select count(*)::int as n from admin.secrets where name = 'DIFY_REPORT_KEY'`;
    expect(r?.n).toBe(0);
    expect(leaked({ res: text, log: cap.text() }, leakForms(LEAK_2))).toEqual([]);
    expect(await scanDatabase(env.owner, leakForms(LEAK_2))).toEqual([]);
  });

  it("ADM-FR-54 · C-I09 · D7 · alias (1 anchor + 1 alias; bom 9 tầng) → YAML_SYNTAX, trả trong 5 s; request kế vẫn 200", async () => {
    for (const content of [ONE_ALIAS, bomAlias(9)]) {
      const t0 = performance.now();
      const res = await dry(content);
      expect(performance.now() - t0).toBeLessThan(5000);
      expect(res.status).toBe(200);
      expect(res.json.valid).toBe(false);
      expect(errorsOf(res)[0]?.code).toBe("YAML_SYNTAX");
    }
    expect((await env.get("/auth/me", { token: await env.admin() })).status).toBe(200);
  });

  it("ADM-FR-54 · C-I10 · M4-R14 · > 1 MiB → 413 {max_bytes}; đúng 1 MiB → 200; đa byte > 1 MiB → 413; body thô > 2 MiB → 413", async () => {
    const over = await dry(padTo(baseFile(), MAX_BYTES + 1));
    expectErr(over, "PAYLOAD_TOO_LARGE");
    expect(over.json.error.details).toEqual({ max_bytes: MAX_BYTES });
    expect((await dry(padTo(baseFile(), MAX_BYTES))).status).toBe(200);
    const mb = multiByte(baseFile(), MAX_BYTES + 2);
    expect(mb.length).toBeLessThan(MAX_BYTES);
    expectErr(await dry(mb), "PAYLOAD_TOO_LARGE");
    const raw = JSON.stringify(req(`#${"x".repeat(2 * MAX_BYTES + 10)}`));
    const big = await env.post("/admin/import?dry_run=1", { token: await env.admin(), raw });
    expectErr(big, "PAYLOAD_TOO_LARGE");
  });

  it("ADM-FR-54 · C-I11 · file_name x.json / khoá lạ → 400 VALIDATION_ERROR", async () => {
    expectErr(
      await importReq(env, { file_name: "x.json", content: baseFile() }, "1"),
      "VALIDATION_ERROR",
    );
    expectErr(await importReq(env, { ...req(baseFile()), extra: 1 }, "1"), "VALIDATION_ERROR");
  });

  it("ADM-FR-54 · C-I12 · M4-AC12 · tenant_admin, member → 403 (dry-run + áp dụng); DB không đổi", async () => {
    const sum0 = await checksumAdmin(env);
    const n = await env.cfg();
    for (const u of ["binh", "an"]) {
      const token = await env.token("acme", u);
      expectErr(await importReq(env, req(baseFile()), "1", token), "FORBIDDEN");
      const apply = req(baseFile(), {
        base_config_version: n,
        secrets: { DIFY_REPORT_KEY: LEAK_2 },
      });
      expectErr(await importReq(env, apply, "0", token), "FORBIDDEN");
    }
    expect(await checksumAdmin(env)).toEqual(sum0);
  });

  it("ADM-FR-54 · C-I13 · khoá map trùng → YAML_SYNTAX", async () => {
    const res = await dry(DUP_KEYS);
    expect(res.status).toBe(200);
    expect(res.json.valid).toBe(false);
    expect(errorsOf(res)[0]?.code).toBe("YAML_SYNTAX");
  });

  it("ADM-FR-54 · C-I14 · M4-R14 · quota mọi giới hạn null → SCHEMA tại tenants[0].quotas[0]", async () => {
    const acme = tenantEl("acme", {
      quotas: [{ feature: null, max_runs: null, max_tokens: null, max_usd: null }],
    });
    const res = await dry(toYaml({ ...header(), tenants: [acme] }));
    expect(res.status).toBe(200);
    expect(res.json.valid).toBe(false);
    expect(errorsOf(res)).toContainEqual(
      expect.objectContaining({ code: "SCHEMA", path: "tenants[0].quotas[0]" }),
    );
  });
});
