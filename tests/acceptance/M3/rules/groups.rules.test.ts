// ADM-FR-62, ADM-FR-55 · luật thuần groups (plan.md §4 `groups.rules.ts`; M3-R01…R05; test-plan R3). Không DB.
import { describe, expect, it } from "bun:test";
import { loadGroupsRules } from "../_modules";

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    for (const v of Object.values(o as object)) deepFreeze(v);
    Object.freeze(o);
  }
  return o;
};

describe("ADM-FR-62 · beta-testers (M3-R02)", () => {
  it("ADM-FR-62 · M3-R02 · BETA_GROUP_KEY = beta-testers; isBetaGroup chỉ đúng key (phân biệt hoa thường)", async () => {
    const r = await loadGroupsRules();
    expect(r.BETA_GROUP_KEY).toBe("beta-testers");
    expect(r.isBetaGroup({ key: "beta-testers" })).toBe(true);
    expect(r.isBetaGroup({ key: "ke-toan" })).toBe(false);
    expect(r.isBetaGroup({ key: "Beta-Testers" })).toBe(false);
  });

  it("ADM-FR-62 · M3-R02 · checkGroupDelete: beta → BETA_GROUP_PROTECTED không details; group khác → null", async () => {
    const r = await loadGroupsRules();
    const err = r.checkGroupDelete({ key: "beta-testers" });
    expect(err).toMatchObject({ code: "BETA_GROUP_PROTECTED" });
    expect(err.details).toBeUndefined();
    expect(r.checkGroupDelete({ key: "ke-toan" })).toBeNull();
    expect(r.checkGroupDelete({ key: "beta-testers-2" })).toBeNull();
  });
});

describe("ADM-FR-55 · changedGroupFields (M3-R01, R05)", () => {
  const base = {
    name: { vi: "Kế toán", en: "Accounting" },
    description: "Phòng kế toán" as string | null,
  };

  it("ADM-FR-55 · M3-R01 · giống hệt → []; khoá name đổi chỗ vẫn []", async () => {
    const r = await loadGroupsRules();
    expect(r.changedGroupFields(base, { ...base })).toEqual([]);
    expect(
      r.changedGroupFields(base, { ...base, name: { en: "Accounting", vi: "Kế toán" } }),
    ).toEqual([]);
  });

  it("ADM-FR-55 · M3-R01 · đổi name.vi / thêm / bỏ name.en → ['name']", async () => {
    const r = await loadGroupsRules();
    expect(r.changedGroupFields(base, { ...base, name: { vi: "KT", en: "Accounting" } })).toEqual([
      "name",
    ]);
    expect(r.changedGroupFields(base, { ...base, name: { vi: "Kế toán" } })).toEqual(["name"]);
    expect(
      r.changedGroupFields(
        { ...base, name: { vi: "Kế toán" } },
        { ...base, name: { vi: "Kế toán", en: "A" } },
      ),
    ).toEqual(["name"]);
  });

  it("ADM-FR-55 · M3-R01 · description null ↔ chuỗi → ['description']; đổi cả hai → cả hai", async () => {
    const r = await loadGroupsRules();
    expect(r.changedGroupFields(base, { ...base, description: null })).toEqual(["description"]);
    expect(r.changedGroupFields({ ...base, description: null }, base)).toEqual(["description"]);
    const both = r.changedGroupFields(base, { name: { vi: "X" }, description: null });
    expect([...both].sort()).toEqual(["description", "name"]);
  });
});

describe("ADM-FR-62 · planMemberAdd (M3-R03)", () => {
  const found = [
    { username: "lan", id: "u-3" },
    { username: "thu", id: "u-1" },
    { username: "dung", id: "u-2" },
  ];

  it("ADM-FR-62 · M3-R03 · added/already/not_found theo thứ tự input; toInsert = id của added SẮP TĂNG (không theo input)", async () => {
    const r = await loadGroupsRules();
    const out = r.planMemberAdd(["lan", "ghost", "thu", "dung"], found, new Set(["u-2"]));
    expect(out.added).toEqual(["lan", "thu"]);
    expect(out.already).toEqual(["dung"]);
    expect(out.not_found).toEqual(["ghost"]);
    expect(out.toInsert).toEqual(["u-1", "u-3"]);
  });

  it("ADM-FR-62 · M3-R03 · username sai định dạng nằm trong not_found dù có trong found", async () => {
    const r = await loadGroupsRules();
    const out = r.planMemberAdd(
      ["a", "x y", "ab!", "lan"],
      [{ username: "a", id: "u-9" }, { username: "ab!", id: "u-8" }, ...found],
      new Set(),
    );
    expect(out.not_found).toEqual(["a", "x y", "ab!"]);
    expect(out.added).toEqual(["lan"]);
  });

  it("ADM-FR-62 · M3-R03 · found thừa user không có trong input bị bỏ qua; input rỗng → mọi mảng rỗng", async () => {
    const r = await loadGroupsRules();
    const out = r.planMemberAdd(["lan"], found, new Set());
    expect(out.added).toEqual(["lan"]);
    expect(out.toInsert).toEqual(["u-3"]);
    expect(r.planMemberAdd([], found, new Set())).toEqual({
      toInsert: [],
      added: [],
      not_found: [],
      already: [],
    });
  });

  it("ADM-FR-62 · M3-R03 · không có ai mới (toàn already) → toInsert rỗng", async () => {
    const r = await loadGroupsRules();
    const out = r.planMemberAdd(["lan", "thu"], found, new Set(["u-3", "u-1"]));
    expect(out.toInsert).toEqual([]);
    expect(out.already).toEqual(["lan", "thu"]);
  });

  it("ADM-FR-62 · M3-R03 · hàm không đổi input/found/existing (đóng băng sâu)", async () => {
    const r = await loadGroupsRules();
    const input = deepFreeze(["lan", "ghost"]);
    const f = deepFreeze(found.map((x) => ({ ...x })));
    const existing = new Set(["u-2"]);
    expect(() => r.planMemberAdd(input, f, existing)).not.toThrow();
    expect([...existing]).toEqual(["u-2"]);
  });

  it("ADM-FR-62 · M3-R03 · username khớp user nhưng viết khác chuỗi (đã chuẩn hoá ở schema) vẫn so khớp chính xác theo username", async () => {
    const r = await loadGroupsRules();
    const out = r.planMemberAdd(["lan"], [{ username: "lan", id: "u-3" }], new Set());
    expect(out.added).toEqual(["lan"]);
    const none = r.planMemberAdd(["lan"], [{ username: "lan2", id: "u-4" }], new Set());
    expect(none.not_found).toEqual(["lan"]);
  });
});
