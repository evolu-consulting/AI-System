// N5-FR-02, N5-FR-03, N5-FR-04, N5-FR-07 · luật thuần chuyển user mgmt-app (viết trước code — làn đầy đủ).
import { describe, expect, test } from "bun:test";
import type { ExistingUser, UserIn } from "./import";
import {
  adminRoleOf,
  chunk,
  classifyHash,
  fnv8,
  planOrgs,
  planUsers,
  tenantKeyFor,
  usernameBase,
  usernameFallback,
} from "./import.rules";

const ARGON_OK =
  "$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2FsdA$YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo0NTY3ODk";
const u = (email: string, over: Partial<UserIn> = {}): UserIn => ({
  email,
  name: email.split("@")[0] ?? "x",
  orgId: "o1",
  orgRole: "editor",
  passwordHash: null,
  locale: "vi",
  ...over,
});

describe("N5-FR-04 · classifyHash", () => {
  test("N5-FR-04 · argon2id v19 m≥19456 t≥2 ⇒ import", () => {
    expect(classifyHash(ARGON_OK)).toBe("import");
    expect(classifyHash(ARGON_OK.replace("m=19456,t=2", "m=65536,t=3"))).toBe("import");
  });
  test("N5-FR-04 · scrypt/bcrypt/argon2i/yếu/rỗng/rác ⇒ reset", () => {
    for (const h of [
      null,
      "",
      "scrypt:32768:8:1$abc$def",
      "$scrypt$ln=15,r=8,p=1$c2FsdA$aGFzaA",
      "$2b$12$abcdefghijklmnopqrstuuMyJ1pX1W0z9a3l8oQh2bE0bW3oV4a1e",
      ARGON_OK.replace("argon2id", "argon2i"),
      ARGON_OK.replace("m=19456", "m=4096"),
      ARGON_OK.replace("t=2", "t=1"),
      ARGON_OK.replace("v=19", "v=16"),
      ARGON_OK.replace("m=19456", "m=4194304"), // trần chặn DoS bộ nhớ (readiness R7)
      ARGON_OK.replace("t=2", "t=11"),
      ARGON_OK.replace("p=1", "p=8"),
      `${ARGON_OK}${"A".repeat(200)}`,
      `${ARGON_OK}$extra`,
      "$argon2id$v=19$m=19456,t=2,p=1$$",
    ])
      expect(classifyHash(h)).toBe("reset");
  });
});

describe("N5-FR-02 · tenantKeyFor", () => {
  test("N5-FR-02 · tenant_key cho sẵn thắng; slug bỏ dấu; không ra slug ⇒ org-<fnv8>", () => {
    expect(tenantKeyFor({ id: "x", name: "Công ty A", tenantKey: "cty-a" })).toBe("cty-a");
    expect(tenantKeyFor({ id: "x", name: "Công ty Đông Á  (HN)", tenantKey: null })).toBe(
      "cong-ty-dong-a-hn",
    );
    expect(tenantKeyFor({ id: "abc", name: "!!!", tenantKey: null })).toBe(`org-${fnv8("abc")}`);
    const long = tenantKeyFor({ id: "x", name: "a".repeat(80), tenantKey: null });
    expect(long).toMatch(/^[a-z0-9-]{2,32}$/);
  });
  test("N5-FR-02 · fnv8 tất định, 8 hex", () => {
    expect(fnv8("abc")).toBe(fnv8("abc"));
    expect(fnv8("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(fnv8("abc")).not.toBe(fnv8("abd"));
  });
});

describe("N5-FR-03 · username + vai", () => {
  test("N5-FR-03 · phần trước @, chuẩn hoá [a-z0-9._-]{2,32}", () => {
    expect(usernameBase("Lan.Nguyen+x@Example.com")).toBe("lan.nguyen-x");
    expect(usernameBase("a@x.vn")).toBe("a-u");
    expect(usernameBase(`${"b".repeat(50)}@x.vn`)).toHaveLength(32);
    expect(usernameFallback("lan@x.vn")).toBe(`lan-${fnv8("lan@x.vn")}`);
    expect(usernameFallback(`${"c".repeat(40)}@x.vn`)).toMatch(/^c{23}-[0-9a-f]{8}$/);
  });
  test("N5-FR-03 · owner ⇒ tenant_admin, editor/viewer ⇒ member, lạ ⇒ null (không bao giờ platform_admin)", () => {
    expect(adminRoleOf("owner")).toBe("tenant_admin");
    expect(adminRoleOf("editor")).toBe("member");
    expect(adminRoleOf("viewer")).toBe("member");
    expect(adminRoleOf("admin")).toBeNull();
    expect(adminRoleOf("platform_admin")).toBeNull();
  });
});

describe("N5-FR-02 · planOrgs", () => {
  test("N5-FR-02 · khớp mgmt_org_id ⇒ dùng lại; key trống ⇒ tạo; key thuộc tenant khác ⇒ ORG_KEY_TAKEN; trùng key trong file ⇒ DUPLICATE_KEY", () => {
    const p = planOrgs(
      [
        { id: "o1", name: "A", tenantKey: "aaa" },
        { id: "o2", name: "B", tenantKey: "bbb" },
        { id: "o3", name: "C", tenantKey: "taken" },
        { id: "o4", name: "D", tenantKey: "bbb" },
        { id: "o5", name: "E", tenantKey: "eee" },
        { id: "o1", name: "A again", tenantKey: "zzz" },
      ],
      [
        { id: "t1", key: "aaa-old", mgmtOrgId: "o1", active: true },
        { id: "t9", key: "taken", mgmtOrgId: null, active: true },
        { id: "t5", key: "eee", mgmtOrgId: "o5", active: false },
      ],
    );
    expect(p.reuse).toEqual([{ orgId: "o1", tenantId: "t1", key: "aaa-old" }]);
    expect(p.creates).toEqual([{ orgId: "o2", key: "bbb", name: "B" }]);
    expect(p.issues).toEqual([
      { kind: "org", ref: "o3", code: "ORG_KEY_TAKEN" },
      { kind: "org", ref: "o4", code: "DUPLICATE_KEY" },
      { kind: "org", ref: "o5", code: "TENANT_INACTIVE" },
      { kind: "org", ref: "o1", code: "DUP_ORG" },
    ]);
    expect(p.failed).toEqual(["o3", "o4", "o5"]);
  });
});

describe("N5-FR-03 · N5-FR-07 · planUsers", () => {
  const tenantOf = new Map<string, string | null>([
    ["o1", "t1"],
    ["o2", "t2"],
    ["bad", null],
  ]);
  test("N5-FR-07 · user mới ⇒ tenant của org mình; đã có (email, tenant) ⇒ existing, không đổi mật khẩu", () => {
    const existing: ExistingUser[] = [
      { tenantId: "t1", id: "u-old", email: "old@x.vn", username: "old", roles: [] },
    ];
    const p = planUsers(
      [u("new@x.vn"), u("OLD@x.vn", { orgRole: "viewer" }), u("b@y.vn", { orgId: "o2" })],
      tenantOf,
      existing,
    );
    expect(p.inserts.map((r) => [r.tenantId, r.email, r.username, r.role])).toEqual([
      ["t1", "new@x.vn", "new", "member"],
      ["t2", "b@y.vn", "b-u", "member"],
    ]);
    expect(p.links).toEqual([{ tenantId: "t1", userId: "u-old", role: "viewer" }]);
    expect(p.existing).toBe(1);
  });
  test("N5-FR-03 · username trùng (người khác) ⇒ fallback; cả hai trùng ⇒ USERNAME_TAKEN", () => {
    const existing: ExistingUser[] = [
      { tenantId: "t1", id: "u1", email: "lan@other.vn", username: "lan", roles: [] },
      { tenantId: "t1", id: "u2", email: "hoa@other.vn", username: "hoa", roles: [] },
      {
        tenantId: "t1",
        id: "u3",
        email: "z@other.vn",
        username: usernameFallback("hoa@x.vn"),
        roles: [],
      },
    ];
    const p = planUsers([u("lan@x.vn"), u("hoa@x.vn")], tenantOf, existing);
    expect(p.inserts.map((r) => r.username)).toEqual([usernameFallback("lan@x.vn")]);
    expect(p.issues).toEqual([{ kind: "user", ref: "hoa@x.vn", code: "USERNAME_TAKEN" }]);
  });
  test("N5-FR-03 · cùng username trong một lô ⇒ người sau dùng fallback; trùng email trong file ⇒ DUPLICATE_EMAIL", () => {
    const p = planUsers([u("lan@a.vn"), u("lan@b.vn"), u("LAN@a.vn")], tenantOf, []);
    expect(p.inserts.map((r) => r.username)).toEqual(["lan", usernameFallback("lan@b.vn")]);
    expect(p.issues).toEqual([{ kind: "user", ref: "lan@a.vn", code: "DUPLICATE_EMAIL" }]);
  });
});

describe("N5-FR-07 · planUsers với user đã có", () => {
  const tenantOf = new Map<string, string | null>([
    ["o1", "t1"],
    ["o2", "t2"],
    ["bad", null],
  ]);
  test("N5-FR-07 · user đã có: cùng vai ⇒ không thêm; vai khác của gói ⇒ ROLE_CONFLICT (không nâng quyền ngầm)", () => {
    const existing: ExistingUser[] = [
      { tenantId: "t1", id: "a", email: "same@x.vn", username: "same", roles: ["editor"] },
      { tenantId: "t1", id: "b", email: "other@x.vn", username: "other", roles: ["viewer"] },
    ];
    const p = planUsers(
      [u("same@x.vn"), u("other@x.vn", { orgRole: "owner" })],
      tenantOf,
      existing,
    );
    expect(p.links).toEqual([]);
    expect(p.existing).toBe(2);
    expect(p.issues).toEqual([{ kind: "user", ref: "other@x.vn", code: "ROLE_CONFLICT" }]);
  });
});

describe("N5-FR-01 · N5-FR-03 · N5-FR-04 · planUsers lỗi hàng và mật khẩu", () => {
  const tenantOf = new Map<string, string | null>([
    ["o1", "t1"],
    ["o2", "t2"],
    ["bad", null],
  ]);
  test("N5-FR-01 · email sai ⇒ INVALID_EMAIL; tên rỗng ⇒ phần trước @, cắt 64", () => {
    const p = planUsers(
      [u("không-email"), u("x@y.vn", { name: "  " }), u("z@y.vn", { name: "N".repeat(90) })],
      tenantOf,
      [],
    );
    expect(p.issues).toEqual([{ kind: "user", ref: "không-email", code: "INVALID_EMAIL" }]);
    expect(p.inserts.map((r) => r.displayName.length)).toEqual([1, 64]);
    expect(p.inserts[0]?.displayName).toBe("x");
  });
  test("N5-FR-03 · không org / org lỗi / org lạ / vai lạ ⇒ lỗi hàng", () => {
    const p = planUsers(
      [
        u("a@x.vn", { orgId: null }),
        u("b@x.vn", { orgId: "bad" }),
        u("c@x.vn", { orgId: "nope" }),
        u("d@x.vn", { orgRole: "admin" }),
      ],
      tenantOf,
      [],
    );
    expect(p.inserts).toEqual([]);
    expect(p.issues.map((i) => i.code)).toEqual([
      "NO_ORG",
      "ORG_FAILED",
      "UNKNOWN_ORG",
      "BAD_ROLE",
    ]);
  });
  test("N5-FR-04 · mật khẩu: argon2id đủ mạnh ⇒ giữ hash, không buộc đổi; còn lại ⇒ reset, buộc đổi", () => {
    const p = planUsers(
      [u("a@x.vn", { passwordHash: ARGON_OK }), u("b@x.vn", { passwordHash: "scrypt:1:2:3$a$b" })],
      tenantOf,
      [],
    );
    expect(p.inserts.map((r) => [r.password, r.importedHash === ARGON_OK])).toEqual([
      ["import", true],
      ["reset", false],
    ]);
    expect(p.inserts.every((r) => r.password === "import" || r.importedHash === null)).toBe(true);
  });
});

describe("N5-NFR-01 · chunk", () => {
  test("N5-NFR-01 · chia lô đúng cỡ, không mất hàng", () => {
    const xs = Array.from({ length: 1001 }, (_, i) => i);
    const c = chunk(xs, 500);
    expect(c.map((x) => x.length)).toEqual([500, 500, 1]);
    expect(c.flat()).toEqual(xs);
  });
});
