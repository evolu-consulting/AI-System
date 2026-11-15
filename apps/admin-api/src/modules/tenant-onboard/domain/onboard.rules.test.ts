// niti-onboard · luật thuần onboarding: file NitiGroup thật hợp lệ, cây phòng ban, thành viên, marker importer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OnboardSpecSchema, parseSpec } from "../adapters/onboard.schema";
import {
  bindDecision,
  deptRows,
  memberPairs,
  type OnboardSpec,
  planUsers,
  sameJson,
  splitProfile,
  usernameOf,
  wantDirectory,
} from "./onboard.rules";

const NITI = join(import.meta.dir, "../../../../../../deploy/tenants/nitigroup.yaml");
const spec = (x: Record<string, unknown>): OnboardSpec =>
  OnboardSpecSchema.parse({ key: "t-x", name: "T X", root: { key: "pb-root", vi: "Gốc" }, ...x });

describe("niti-onboard · file deploy/tenants/nitigroup.yaml", () => {
  test("hợp lệ: hồ sơ đủ, 1 gốc + 4 phòng dưới gốc theo thứ tự, gói contracts + Bảng tin, 6 người dùng, không import (CR-159)", () => {
    const p = parseSpec(readFileSync(NITI, "utf8"));
    if (!p.ok) throw new Error(JSON.stringify(p.issues));
    const s = p.spec;
    expect(s.key).toBe("nitigroup");
    expect(s.profile).toMatchObject({
      tax_id: "0318938091",
      email: "nitigroupvn@gmail.com",
      zalo_oa: "NitiGroup",
      websites: ["https://nitigroupvn.com/", "https://annamtax.com/"],
    });
    expect(s.profile.phones?.map((x) => x.number)).toEqual(["076.99.55.688", "0768.139.688"]);
    const { rows, issues } = deptRows(s);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      key: "pb-giam-doc",
      name: { vi: "Phòng Giám đốc", en: "Board of Directors" },
      parent: null,
      sort: 0,
    });
    expect(rows.slice(1).every((r) => r.parent === "pb-giam-doc")).toBe(true);
    expect(rows[4]?.name).toEqual({ vi: "Phòng Kế toán", en: "Accounting" });
    expect(s.packs).toEqual(["contracts"]);
    expect(s.addons).toEqual(["contracts-community"]);
    expect(s.users).toHaveLength(6);
    expect(s.users.filter((u) => u.role === "admin").map((u) => u.email)).toEqual([
      "thuytien.le@nitigroupvn.com",
      "admin@nitigroupvn.com",
    ]);
    expect(s.import).toBeUndefined();
  });

  test("ba file CR-159 evolu nitigroup preschool hợp lệ và mọi người trong phòng ban đều có trong users", () => {
    for (const k of ["evolu", "nitigroup", "preschool"]) {
      const p = parseSpec(readFileSync(join(NITI, `../${k}.yaml`), "utf8"));
      if (!p.ok) throw new Error(`${k}: ${JSON.stringify(p.issues)}`);
      const emails = new Set(p.spec.users.map((u) => u.email));
      const { members } = memberPairs(p.spec);
      expect(members.length).toBeGreaterThan(0);
      for (const m of members) expect(emails.has(m.email)).toBe(true);
      expect(deptRows(p.spec).issues).toEqual([]);
      expect(p.spec.addons).toEqual(["contracts-community"]);
    }
  });

  test("--mgmt-org ghi đè org_id, giữ source (file có import)", () => {
    const p = parseSpec(readFileSync(join(NITI, "../demo.yaml"), "utf8"), { mgmtOrg: "org-123" });
    expect(p.ok && p.spec.import).toEqual({ source: "mgmt-prod", org_id: "org-123" });
  });
});

describe("CR-165b · hồ sơ công ty evolu / preschool trong yaml", () => {
  const dir = join(NITI, "..");
  test.each([
    ["evolu", "Công ty EvoluConsultants", "8888888888"],
    ["preschool", "Công ty preschool", "9999999999"],
  ])("%s: CLI nhận hồ sơ, tách đúng cột legal_name + tax_code", (key, legal, tax) => {
    const p = parseSpec(readFileSync(join(dir, `${key}.yaml`), "utf8"));
    if (!p.ok) throw new Error(JSON.stringify(p.issues));
    expect(p.spec.profile).toMatchObject({ legal_name: legal, tax_id: tax });
    expect(splitProfile(p.spec.profile).cols).toEqual({ legal_name: legal, tax_code: tax });
  });
});

describe("niti-onboard · kiểm đầu vào", () => {
  test("MST sai, key Group sai, gói cấm, trường lạ ⇒ không hợp lệ", () => {
    const bad = [
      { profile: { tax_id: "12345" } },
      { departments: [{ key: "PB_X", vi: "X" }] },
      { packs: ["public"] },
      { extra: 1 },
    ];
    for (const b of bad)
      expect(OnboardSpecSchema.safeParse({ ...spec({}), ...b }).success).toBe(false);
  });

  test("cây: trùng khoá, cha chưa khai (hoặc khai SAU) ⇒ báo, không vòng được", () => {
    const s = spec({
      departments: [
        { key: "pb-a", vi: "A" },
        { key: "pb-b", vi: "B", parent: "pb-c" },
        { key: "pb-c", vi: "C", parent: "pb-a" },
        { key: "pb-a", vi: "A2" },
      ],
    });
    const { rows, issues } = deptRows(s);
    expect(issues).toEqual([
      { code: "PARENT_UNKNOWN", ref: "pb-b" },
      { code: "DUP_DEPT_KEY", ref: "pb-a" },
    ]);
    expect(rows.map((r) => [r.key, r.parent])).toEqual([
      ["pb-root", null],
      ["pb-a", "pb-root"],
      ["pb-c", "pb-a"],
    ]);
  });

  test("thành viên: trưởng phòng cũng là thành viên, email thường hoá, không trùng", () => {
    const s = spec({
      departments: [{ key: "pb-a", vi: "A", head: "Lan@X.vn", members: ["lan@x.vn", "Tam@x.vn"] }],
    });
    expect(memberPairs(s)).toEqual({
      members: [
        { key: "pb-a", email: "lan@x.vn" },
        { key: "pb-a", email: "tam@x.vn" },
      ],
      heads: [{ key: "pb-a", email: "lan@x.vn" }],
    });
  });
});

describe("niti-onboard · marker importer", () => {
  const want = { source: "mgmt-prod", orgId: "o1" };
  test("chưa khai ⇒ không đụng; chưa có ⇒ đặt; trùng ⇒ giữ; khác ⇒ ORG_REBIND", () => {
    expect(bindDecision(null, { source: "x", orgId: "y" })).toEqual({ kind: "none" });
    expect(bindDecision(want, { source: null, orgId: null })).toEqual({ kind: "set", b: want });
    expect(bindDecision(want, { source: "mgmt-prod", orgId: "o1" })).toEqual({ kind: "keep" });
    expect(bindDecision(want, { source: "mgmt-prod", orgId: "o2" }).kind).toBe("error");
    expect(bindDecision(want, { source: "other", orgId: "o1" }).kind).toBe("error");
  });

  test("sameJson: thứ tự khoá không tính, undefined bỏ, mảng theo thứ tự", () => {
    expect(sameJson({ a: 1, b: [1, 2], c: undefined }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameJson({ b: [2, 1] }, { b: [1, 2] })).toBe(false);
  });
});

describe("CR-159 · users: parse + validate", () => {
  const u = { email: "A.B@X.test", name: " An ", title: "Giám đốc", role: "admin" };
  const base = { key: "t-x", name: "T X", root: { key: "pb-root", vi: "Gốc" } };

  test("chuẩn hoá email thường, tên cắt khoảng trắng; role mặc định member; addons mặc định rỗng", () => {
    const p = parseSpec(
      JSON.stringify({ ...base, users: [u, { ...u, email: "cc@x.test", role: undefined }] }),
      {
        json: true,
      },
    );
    if (!p.ok) throw new Error(JSON.stringify(p.issues));
    expect(p.spec.users.map((x) => [x.email, x.name, x.role])).toEqual([
      ["a.b@x.test", "An", "admin"],
      ["cc@x.test", "An", "member"],
    ]);
    expect(p.spec.addons).toEqual([]);
    expect(usernameOf("a.b@x.test")).toBe("a.b");
  });

  test("sai: thiếu chức vụ, vai lạ, email sai, trường lạ, chức vụ quá 80, tên đăng nhập suy ra không hợp lệ", () => {
    const bad = [
      { ...u, title: undefined },
      { ...u, role: "owner" },
      { ...u, email: "khong-phai-email" },
      { ...u, extra: 1 },
      { ...u, title: "x".repeat(81) },
      { ...u, email: "a+b@x.test" },
    ];
    for (const b of bad)
      expect(parseSpec(JSON.stringify({ ...base, users: [b] }), { json: true }).ok).toBe(false);
  });

  test("trùng email hoặc trùng tên đăng nhập ⇒ báo mã", () => {
    const run = (users: unknown[]) => parseSpec(JSON.stringify({ ...base, users }), { json: true });
    const dupMail = run([u, { ...u }]);
    expect(!dupMail.ok && dupMail.issues[0]?.code).toBe("DUP_USER_EMAIL");
    const dupName = run([u, { ...u, email: "a.b@y.test" }]);
    expect(!dupName.ok && dupName.issues[0]?.code).toBe("DUP_USERNAME");
  });

  test("planUsers: chưa có ⇒ tạo; có và khớp ⇒ không làm gì; khác tên/vai/chức vụ ⇒ cập nhật đúng trường", () => {
    const w = (email: string, name: string, title: string, role: "admin" | "member") => ({
      email,
      name,
      title,
      role,
    });
    const now = [
      {
        id: "1",
        email: "a@x.test",
        display_name: "A",
        role: "tenant_admin",
        version: 3,
        job_title: "GĐ",
      },
      {
        id: "2",
        email: "b@x.test",
        display_name: "B",
        role: "member",
        version: 1,
        job_title: null,
      },
      {
        id: "3",
        email: "c@x.test",
        display_name: "C",
        role: "member",
        version: 2,
        job_title: "NV",
      },
    ];
    const plan = planUsers(
      [
        w("a@x.test", "A", "GĐ", "admin"),
        w("b@x.test", "B2", "NV", "admin"),
        w("c@x.test", "C", "TP", "member"),
        w("d@x.test", "D", "NV", "member"),
      ],
      now,
    );
    expect(plan.create.map((x) => x.email)).toEqual(["d@x.test"]);
    expect(plan.unchanged).toBe(1);
    expect(plan.update).toEqual([
      {
        id: "2",
        email: "b@x.test",
        version: 1,
        set: { display_name: "B2", role: "tenant_admin" },
        title: "NV",
      },
      { id: "3", email: "c@x.test", version: 2, set: {}, title: "TP" },
    ]);
  });
});

describe("CR-159 · wantDirectory", () => {
  const full = { legal_name: "Cty", tax_id: "0312345678" };
  test("đủ tên pháp lý + MST ⇒ bật; thiếu một ⇒ không; unlisted ⇒ không", () => {
    expect(wantDirectory({ profile: full })).toBe(true);
    expect(wantDirectory({ profile: full, directory: "listed" })).toBe(true);
    expect(wantDirectory({ profile: { legal_name: "Cty" } })).toBe(false);
    expect(wantDirectory({ profile: { tax_id: "0312345678" } })).toBe(false);
    expect(wantDirectory({ profile: {} })).toBe(false);
    expect(wantDirectory({ profile: full, directory: "unlisted" })).toBe(false);
  });
});
