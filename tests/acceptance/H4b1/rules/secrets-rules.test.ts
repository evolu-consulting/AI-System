// HUB-FR-68 · HUB-FR-69 · HUB-BR-15 · CR-060 · Q1, Q7 · plan §2.1 · test-plan H4b1 §3 R01–R16: luật thuần
// `secrets.rules.ts` — phạm vi theo loại, quyền theo route, tenant đích route tenant, snapshot audit không giá trị,
// entity_name, cursor danh sách. Đỏ trước code: module chưa có ⇒ `fn()` ném "chưa có".
import { describe, expect, it } from "bun:test";
import { fn, loadRules, thrown } from "./_rules";

const A = "a4b10000-0000-4000-8000-000000000001";
const B = "a4b10000-0000-4000-8000-000000000002";
const KINDS = ["provider_api_key", "kh_api_key", "source_credential"] as const;
const ROLES = ["platform_admin", "tenant_admin", "member"] as const;
const user = (role: (typeof ROLES)[number], tenantId = A) => ({ userId: B, tenantId, role });

describe("R01–R03 · secretScopeOk [spec §2 Phạm vi · §3 · Q7]", () => {
  it("HUB-BR-15 · R01 · provider_api_key: null ⇒ true; có tenant ⇒ false", async () => {
    const f = fn(await loadRules(), "secretScopeOk");
    expect([f("provider_api_key", null), f("provider_api_key", A)]).toEqual([true, false]);
  });
  it("HUB-BR-15 · R02 · kh_api_key: null ⇒ true; có tenant ⇒ true (Q7 cả hai)", async () => {
    const f = fn(await loadRules(), "secretScopeOk");
    expect([f("kh_api_key", null), f("kh_api_key", A)]).toEqual([true, true]);
  });
  it("HUB-BR-15 · R03 · source_credential: null ⇒ false; có tenant ⇒ true (CR-060)", async () => {
    const f = fn(await loadRules(), "secretScopeOk");
    expect([f("source_credential", null), f("source_credential", A)]).toEqual([false, true]);
  });
});

describe("R04–R05 · canManageSecret [spec §2 Phạm vi · §3 A/B · Q1]", () => {
  it("HUB-BR-15 · R04 · ma trận 3 role × 3 kind × 2 route: studio chỉ platform_admin (mọi kind); tenant: tenant_admin|platform_admin CHỈ source_credential; member luôn false", async () => {
    const f = fn(await loadRules(), "canManageSecret");
    const got: Record<string, boolean> = {};
    const want: Record<string, boolean> = {};
    for (const role of ROLES)
      for (const kind of KINDS)
        for (const route of ["studio", "tenant"] as const) {
          const k = `${role}/${kind}/${route}`;
          got[k] = f(role, kind, route);
          want[k] =
            route === "studio"
              ? role === "platform_admin"
              : role !== "member" && kind === "source_credential";
        }
    expect(got).toEqual(want);
  });
  it("HUB-BR-15 · AC-H4b1-05 · R05 · tenant_admin không quản lý được provider_api_key/kh_api_key ở bất kỳ route nào", async () => {
    const f = fn(await loadRules(), "canManageSecret");
    const r = ["provider_api_key", "kh_api_key"].flatMap((k) =>
      ["studio", "tenant"].map((route) => f("tenant_admin", k, route)),
    );
    expect(r).toEqual([false, false, false, false]);
  });
});

describe("R06–R09 · credentialTenant [spec §3 B · plan D13]", () => {
  it("HUB-BR-15 · R06 · tenant_admin: vắng ⇒ tenant phiên; trùng ⇒ tenant phiên (read & write)", async () => {
    const f = fn(await loadRules(), "credentialTenant");
    const u = user("tenant_admin");
    expect([
      f(u, undefined, "read"),
      f(u, undefined, "write"),
      f(u, A, "read"),
      f(u, A, "write"),
    ]).toEqual([A, A, A, A]);
  });
  it("HUB-BR-15 · AC-H4b1-05 · R07 · tenant_admin gửi tenant khác ⇒ NOT_FOUND (read & write, không lộ tồn tại)", async () => {
    const f = fn(await loadRules(), "credentialTenant");
    const u = user("tenant_admin");
    expect([thrown(() => f(u, B, "read")), thrown(() => f(u, B, "write"))]).toEqual([
      { code: "NOT_FOUND" },
      { code: "NOT_FOUND" },
    ]);
  });
  it("HUB-BR-15 · R08 · platform_admin: có tenant_id ⇒ dùng đúng tenant đó (read & write)", async () => {
    const f = fn(await loadRules(), "credentialTenant");
    const u = user("platform_admin", B);
    expect([f(u, A, "read"), f(u, A, "write")]).toEqual([A, A]);
  });
  it("HUB-BR-15 · R09 · platform_admin vắng tenant_id: write ⇒ VALIDATION_ERROR path tenant_id; read ⇒ NOT_FOUND", async () => {
    const f = fn(await loadRules(), "credentialTenant");
    const u = user("platform_admin", B);
    expect(thrown(() => f(u, undefined, "write"))).toEqual({
      code: "VALIDATION_ERROR",
      paths: ["tenant_id"],
    });
    expect(thrown(() => f(u, undefined, "read"))).toEqual({ code: "NOT_FOUND" });
  });
});

describe("R10–R12 · audit snapshot + entity_name [spec §3 Audit · HUB-FR-69]", () => {
  it("HUB-FR-69 · R10 · secretAuditSnapshot ⇒ đúng 4 khoá {name, kind, tenant_id, version}", async () => {
    const f = fn(await loadRules(), "secretAuditSnapshot");
    const r = f({ name: "anthropic-main", kind: "provider_api_key", tenantId: null, version: 3 });
    expect(r).toEqual({
      name: "anthropic-main",
      kind: "provider_api_key",
      tenant_id: null,
      version: 3,
    });
  });
  it("HUB-FR-68 · AC-H4b1-01 · R11 · secretAuditSnapshot bỏ mọi trường thừa (value/ciphertext/iv) dù đầu vào có", async () => {
    const f = fn(await loadRules(), "secretAuditSnapshot");
    const r = f({
      name: "kh-acme",
      kind: "kh_api_key",
      tenantId: A,
      version: 1,
      value: "sk-qc-R11-leak-Zx9",
      ciphertext: new Uint8Array(20),
      iv: new Uint8Array(12),
    });
    expect(Object.keys(r).sort()).toEqual(["kind", "name", "tenant_id", "version"]);
    expect(JSON.stringify(r)).not.toContain("sk-qc-R11-leak-Zx9");
  });
  it("HUB-FR-69 · R12 · secretEntityName ⇒ `<kind>:<name>`", async () => {
    const f = fn(await loadRules(), "secretEntityName");
    expect([f("provider_api_key", "anthropic-main"), f("source_credential", "Git_Token")]).toEqual([
      "provider_api_key:anthropic-main",
      "source_credential:Git_Token",
    ]);
  });
});

describe("R13–R16 · cursor danh sách [spec §3 A · plan §2.1]", () => {
  it("HUB-FR-68 · R13 · encode → decode khứ hồi giữ nguyên bộ (kind, lower(name), id)", async () => {
    const m = await loadRules();
    const k: [string, string, string] = ["kh_api_key", "kh-main", A];
    expect(fn(m, "decodeSecretCursor")(fn(m, "encodeSecretCursor")(k))).toEqual(k);
  });
  it("HUB-FR-68 · R14 · cursor là base64url (không `+`, `/`, `=`) và ≤ 512 ký tự với name 64 ký tự", async () => {
    const m = await loadRules();
    const c = fn(m, "encodeSecretCursor")(["source_credential", "a".repeat(64), A]);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c.length).toBeLessThanOrEqual(512);
  });
  it("HUB-FR-68 · R15 · decode undefined / rác / JSON sai hình ⇒ undefined (trang đầu, không ném)", async () => {
    const d = fn(await loadRules(), "decodeSecretCursor");
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    expect([
      d(undefined),
      d("%%%"),
      d(b64({ a: 1 })),
      d(b64(["x", "y"])),
      d(b64([1, 2, 3])),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
  it("HUB-FR-68 · R16 · decode chuỗi base64url hợp lệ do client dựng tay (cùng định dạng) ⇒ bộ 3 chuỗi", async () => {
    const d = fn(await loadRules(), "decodeSecretCursor");
    const raw = Buffer.from(JSON.stringify(["provider_api_key", "x1", A])).toString("base64url");
    expect(d(raw)).toEqual(["provider_api_key", "x1", A]);
  });
});
