// ADM-BR-04 · ADM-FR-51 · M4-R10 · audit không chứa mật khẩu / secret / khoá nhạy cảm (test-plan AS1–AS2; M4-AC05).
// Quét `row_to_json` mọi dòng `seq > mark` (owner) — không đọc qua API để không phụ thuộc lọc DTO. Xanh ở T1c.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  createM4Env,
  LEAK_1,
  LEAK_2,
  leakForms,
  type M4Env,
  PW,
  parse4,
  resetNow,
  TENANT_ID,
} from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const FORBIDDEN_KEYS = ["password_hash", "totp_secret", "ciphertext", "iv", "last4", "token_hash"];
const SELF_PW = "Leak-M4-Pw-1";

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const rawSince = async (mark: string): Promise<string[]> =>
  (
    await env.owner<{ j: string }[]>`select row_to_json(a)::text as j from admin.audit_log a
      where seq > ${mark}::bigint order by seq`
  ).map((r) => r.j);

/** Mọi khoá (mọi tầng) của một giá trị JSON. */
function keysDeep(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  return out;
}

describe("ADM-BR-04 · M4-AC05 · audit không rò", () => {
  it("ADM-BR-04 · M4-AC05 · AS1 · tạo user, reset, tự đổi pw, secret LEAK_1 → LEAK_2: audit không chứa mật khẩu/temp/secret (mọi dạng) và không có khoá password_hash/totp_secret/ciphertext/iv/last4/token_hash", async () => {
    const admin = await env.admin();
    const mark = await auditMark(env.owner);
    const created = await env.post(`/admin/users?tenant_id=${A}`, {
      token: admin,
      body: { username: "as1", display_name: "AS1", role: "member" },
    });
    expect(created.status).toBe(201);
    const temps: string[] = [created.json.temp_password];
    const reset = await env.post(
      `/admin/users/${created.json.user?.id ?? created.json.id}/reset-password`,
      {
        token: admin,
      },
    );
    expect(reset.status).toBe(200);
    temps.push(reset.json.temp_password);
    const an = await env.token("acme", "an");
    const ch = await env.post("/auth/change-password", {
      token: an,
      body: { current_password: PW, new_password: SELF_PW },
    });
    expect(ch.status).toBe(204);
    expect(
      (
        await env.post("/admin/secrets", {
          token: admin,
          body: { name: "DIFY_AS1", value: LEAK_1 },
        })
      ).status,
    ).toBe(201);
    expect(
      (await env.put("/admin/secrets/DIFY_AS1", { token: admin, body: { value: LEAK_2 } })).status,
    ).toBe(200);
    const rows = await rawSince(mark);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    const text = rows.join("\n");
    const forms = [
      ...leakForms(LEAK_1),
      ...leakForms(LEAK_2),
      SELF_PW,
      PW,
      ...temps.filter(Boolean),
    ];
    for (const f of forms) expect([f, text.includes(f)]).toEqual([f, false]);
    const keys = new Set<string>();
    for (const r of rows) keysDeep(JSON.parse(r), keys);
    for (const k of FORBIDDEN_KEYS) expect([k, keys.has(k)]).toEqual([k, false]);
  });

  it("ADM-BR-04 · AS2 · GET /audit/:id dòng secret: before/after chỉ name, note", async () => {
    const admin = await env.admin();
    const mark = await auditMark(env.owner);
    expect(
      (
        await env.post("/admin/secrets", {
          token: admin,
          body: { name: "DIFY_AS2", value: LEAK_1, note: "n1" },
        })
      ).status,
    ).toBe(201);
    expect(
      (await env.patch("/admin/secrets/DIFY_AS2", { token: admin, body: { note: "n2" } })).status,
    ).toBe(200);
    const [row] = await env.owner<{ id: string }[]>`select id from admin.audit_log
      where seq > ${mark}::bigint and entity = 'secret' and action = 'update' order by seq desc limit 1`;
    const res = await env.get(`/admin/audit/${row?.id}`, { token: admin });
    expect(res.status).toBe(200);
    const d = parse4("AuditDetailSchema", res.json);
    expect(Object.keys(d.before).sort()).toEqual(["name", "note"]);
    expect(d.after).toEqual({ name: "DIFY_AS2", note: "n2" });
    expect(res.text).not.toContain(LEAK_1);
  });
});
