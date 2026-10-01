// ADM-FR-32, ADM-FR-35, ADM-BR-12 · luật thuần grants (plan.md §4 `grants.rules.ts`; M3-R07…R10; test-plan R4). Không DB.
import { describe, expect, it } from "bun:test";
import { loadGrantsRules } from "../_modules";

const F = { core: "f-0", a: "f-1", b: "f-2", c: "f-3" };
const feat = (id: string, key: string, entitled: boolean) => ({ id, key, entitled });

describe("ADM-FR-35 · comparePairs / pairId (M3 ràng buộc khoá)", () => {
  it("ADM-FR-35 · comparePairs: featureId trước rồi groupId; so chuỗi chữ thường; ổn định", async () => {
    const r = await loadGrantsRules();
    const p = (featureId: string, groupId: string) => ({ featureId, groupId });
    expect(r.comparePairs(p("a", "z"), p("b", "a"))).toBeLessThan(0);
    expect(r.comparePairs(p("b", "a"), p("a", "z"))).toBeGreaterThan(0);
    expect(r.comparePairs(p("a", "a"), p("a", "b"))).toBeLessThan(0);
    expect(r.comparePairs(p("a", "b"), p("a", "b"))).toBe(0);
    const sorted = [p("b", "a"), p("a", "z"), p("a", "b")].sort(r.comparePairs);
    expect(sorted).toEqual([p("a", "b"), p("a", "z"), p("b", "a")]);
  });

  it("ADM-FR-35 · pairId = featureId:groupId", async () => {
    const r = await loadGrantsRules();
    expect(r.pairId({ featureId: "f", groupId: "g" })).toBe("f:g");
  });
});

describe("ADM-FR-32 · checkGrantFeatures (M3-R07)", () => {
  it("ADM-FR-32 · M3-R07 · core nằm trong add → CORE_FEATURE_PROTECTED", async () => {
    const r = await loadGrantsRules();
    const fs = [feat(F.core, "core", true), feat(F.a, "ke-toan", true)];
    expect(r.checkGrantFeatures(fs, new Set([F.core, F.a]))).toMatchObject({
      code: "CORE_FEATURE_PROTECTED",
    });
  });

  it("ADM-FR-32 · M3-R07 · core chỉ nằm trong remove (không ở addIds) vẫn CORE_FEATURE_PROTECTED (đồng nhất DELETE)", async () => {
    const r = await loadGrantsRules();
    const fs = [feat(F.core, "core", true), feat(F.a, "ke-toan", true)];
    expect(r.checkGrantFeatures(fs, new Set([F.a]))).toMatchObject({
      code: "CORE_FEATURE_PROTECTED",
    });
  });

  it("ADM-FR-32 · M3-R07 · feature !entitled trong addIds → NOT_ENTITLED {feature_ids} sắp tăng, không trùng", async () => {
    const r = await loadGrantsRules();
    const fs = [feat(F.c, "c", false), feat(F.a, "a", false), feat(F.b, "b", true)];
    const err = r.checkGrantFeatures(fs, new Set([F.c, F.a, F.b]));
    expect(err).toMatchObject({ code: "NOT_ENTITLED" });
    expect(err.details).toEqual({ feature_ids: [F.a, F.c] });
  });

  it("ADM-FR-32 · M3-R07 · !entitled chỉ ở remove → null (remove không cần entitlement)", async () => {
    const r = await loadGrantsRules();
    const fs = [feat(F.a, "a", false), feat(F.b, "b", true)];
    expect(r.checkGrantFeatures(fs, new Set([F.b]))).toBeNull();
  });

  it("ADM-FR-32 · M3-R07 · core ưu tiên trước NOT_ENTITLED; hợp lệ hết → null", async () => {
    const r = await loadGrantsRules();
    const fs = [feat(F.core, "core", true), feat(F.a, "a", false)];
    expect(r.checkGrantFeatures(fs, new Set([F.core, F.a]))).toMatchObject({
      code: "CORE_FEATURE_PROTECTED",
    });
    expect(r.checkGrantFeatures([feat(F.a, "a", true)], new Set([F.a]))).toBeNull();
  });
});

describe("ADM-FR-35 · planBatch (M3-R08)", () => {
  const p = (featureId: string, groupId: string) => ({ featureId, groupId });

  it("ADM-FR-35 · M3-R08 · insert = add ∖ existing; delete = remove ∩ existing; unchanged đếm đúng", async () => {
    const r = await loadGrantsRules();
    const existing = new Set(["f-1:g-1", "f-2:g-2"]);
    const out = r.planBatch(
      existing,
      [p("f-1", "g-1"), p("f-3", "g-3")],
      [p("f-2", "g-2"), p("f-9", "g-9")],
    );
    expect(out.insert).toEqual([p("f-3", "g-3")]);
    expect(out.delete).toEqual([p("f-2", "g-2")]);
    expect(out.unchanged).toBe(2);
  });

  it("ADM-FR-35 · M3-R08 · insert/delete sắp theo comparePairs, KHÔNG theo thứ tự input", async () => {
    const r = await loadGrantsRules();
    const out = r.planBatch(
      new Set(["f-5:g-1", "f-1:g-2"]),
      [p("f-9", "g-1"), p("f-2", "g-2"), p("f-2", "g-1")],
      [p("f-5", "g-1"), p("f-1", "g-2")],
    );
    expect(out.insert).toEqual([p("f-2", "g-1"), p("f-2", "g-2"), p("f-9", "g-1")]);
    expect(out.delete).toEqual([p("f-1", "g-2"), p("f-5", "g-1")]);
  });

  it("ADM-FR-35 · M3-R08 · tập rỗng → insert/delete rỗng, unchanged 0; thêm toàn cặp đã có → unchanged = |add|", async () => {
    const r = await loadGrantsRules();
    expect(r.planBatch(new Set(), [], [])).toEqual({ insert: [], delete: [], unchanged: 0 });
    const out = r.planBatch(
      new Set(["f-1:g-1", "f-2:g-1"]),
      [p("f-1", "g-1"), p("f-2", "g-1")],
      [],
    );
    expect(out).toEqual({ insert: [], delete: [], unchanged: 2 });
  });

  it("ADM-FR-35 · M3-R08 · không đổi existing; bớt cặp không có → unchanged", async () => {
    const r = await loadGrantsRules();
    const existing = new Set(["f-1:g-1"]);
    const out = r.planBatch(existing, [], [p("f-7", "g-7")]);
    expect(out).toEqual({ insert: [], delete: [], unchanged: 1 });
    expect([...existing]).toEqual(["f-1:g-1"]);
  });
});

describe("ADM-FR-35 · matrixRowState (M3-R09, BR-12)", () => {
  const row = (key: string, entitled: boolean, revoked: boolean, grantCount: number) => ({
    key,
    entitled,
    revoked,
    grantCount,
  });

  it("ADM-FR-35 · M3-R09 · core → core; entitled → entitled (kể cả có grant)", async () => {
    const r = await loadGrantsRules();
    expect(r.matrixRowState(row("core", false, false, 0))).toBe("core");
    expect(r.matrixRowState(row("core", true, false, 3))).toBe("core");
    expect(r.matrixRowState(row("ke-toan", true, false, 0))).toBe("entitled");
    expect(r.matrixRowState(row("ke-toan", true, false, 4))).toBe("entitled");
  });

  it("ADM-BR-12 · M3-R09 · đã thu hồi còn grant → revoked; đã thu hồi hết grant → none", async () => {
    const r = await loadGrantsRules();
    expect(r.matrixRowState(row("ke-toan", false, true, 2))).toBe("revoked");
    expect(r.matrixRowState(row("ke-toan", false, true, 0))).toBe("none");
  });

  it("ADM-FR-35 · M3-R09 · chưa từng mở → none (kể cả grantCount bất thường > 0 nếu chưa thu hồi)", async () => {
    const r = await loadGrantsRules();
    expect(r.matrixRowState(row("phap-che", false, false, 0))).toBe("none");
    expect(r.matrixRowState(row("phap-che", false, false, 1))).toBe("none");
  });
});
