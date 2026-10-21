// niti-onboard · luật thuần onboarding: file NitiGroup thật hợp lệ, cây phòng ban, thành viên, marker importer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OnboardSpecSchema, parseSpec } from "../adapters/onboard.schema";
import { bindDecision, deptRows, memberPairs, type OnboardSpec, sameJson } from "./onboard.rules";

const NITI = join(import.meta.dir, "../../../../../../deploy/tenants/nitigroup.yaml");
const spec = (x: Record<string, unknown>): OnboardSpec =>
  OnboardSpecSchema.parse({ key: "t-x", name: "T X", root: { key: "pb-root", vi: "Gốc" }, ...x });

describe("niti-onboard · file deploy/tenants/nitigroup.yaml", () => {
  test("hợp lệ: hồ sơ đủ, 1 gốc + 22 phòng dưới gốc theo thứ tự, gói contracts, chưa gắn org", () => {
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
    expect(rows).toHaveLength(23);
    expect(rows[0]).toEqual({
      key: "pb-giam-doc",
      name: { vi: "Phòng Giám đốc", en: "Board of Directors" },
      parent: null,
      sort: 0,
    });
    expect(rows.slice(1).every((r) => r.parent === "pb-giam-doc")).toBe(true);
    expect(rows.map((r) => r.name.vi)).not.toContain("Bộ phận / Phòng ban trong công ty");
    expect(rows[22]?.name).toEqual({ vi: "Cửa hàng bán sỉ", en: "Wholesaler" });
    expect(s.packs).toEqual(["contracts"]);
    expect(s.import).toEqual({ source: "mgmt-prod", org_id: null });
  });

  test("--mgmt-org ghi đè org_id, giữ source", () => {
    const p = parseSpec(readFileSync(NITI, "utf8"), { mgmtOrg: "org-123" });
    expect(p.ok && p.spec.import).toEqual({ source: "mgmt-prod", org_id: "org-123" });
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
