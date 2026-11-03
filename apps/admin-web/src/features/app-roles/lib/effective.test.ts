// CR-112 · ADM-FR-82 · ADM-BR-16 · quyền thực tế theo app: mức cao nhất trong các vai hiệu lực; Kiểm tra quyền tách vai / ngoài vai.
import { describe, expect, test } from "bun:test";
import type { EffectiveAccess } from "@ai/contracts";
import { explainPacks, levelsFromRoles } from "./effective";

describe("levelsFromRoles", () => {
  test("hai vai cùng app ⇒ mức cao nhất; vai vượt trần không tính", () => {
    const out = levelsFromRoles([
      { pack: "contracts", level: "read", ceiling: "write" },
      { pack: "contracts", level: "write", ceiling: "write" },
      { pack: "contracts", level: "admin", ceiling: "write" },
    ]);
    expect(out).toEqual([{ pack: "contracts", level: "write", ineffectiveOnly: false }]);
  });

  test("chỉ có vai vượt trần (hoặc app tắt) ⇒ không hiệu lực", () => {
    const out = levelsFromRoles([
      { pack: "contracts", level: "admin", ceiling: "read" },
      { pack: "knowledge", level: "read", ceiling: null },
    ]);
    expect(out).toEqual([
      { pack: "contracts", level: null, ineffectiveOnly: true },
      { pack: "knowledge", level: null, ineffectiveOnly: true },
    ]);
  });
});

const feat = (key: string, effective: boolean, groups: { id: string; name: string }[]) => ({
  feature: { id: key, key, name: { vi: key } },
  effective,
  reasons: groups.map((g) => ({
    code: "grant_group" as const,
    group: { id: g.id, key: g.id, name: { vi: g.name }, is_beta: false },
  })),
  missing: effective ? [] : ["no_entitlement" as const],
});

describe("explainPacks", () => {
  test("quyền qua vai + 'quyền ngoài vai' từ Group phòng ban; mức = cao nhất hiệu lực", () => {
    const access = {
      features: [
        feat("contracts-read", true, [
          { id: "g-viewer", name: "Chỉ xem" },
          { id: "g-pb", name: "Kế toán" },
        ]),
        feat("contracts-write", true, [{ id: "g-pb", name: "Kế toán" }]),
        feat("contracts-admin", false, [{ id: "g-owner", name: "Toàn quyền" }]),
      ],
    } as unknown as Pick<EffectiveAccess, "features">;
    const [row] = explainPacks(access, ["contracts"], new Set(["g-viewer", "g-owner"]));
    expect(row?.level).toBe("write");
    const by = Object.fromEntries((row?.sources ?? []).map((s) => [s.groupId, s]));
    expect(by["g-viewer"]).toMatchObject({ kind: "role", level: "read", effective: true });
    expect(by["g-pb"]).toMatchObject({ kind: "outside", level: "write", effective: true });
    expect(by["g-owner"]).toMatchObject({ kind: "role", level: "admin", effective: false });
  });

  test("không có feature của gói ⇒ mức null, không nguồn", () => {
    const [row] = explainPacks({ features: [] }, ["contracts"], new Set());
    expect(row).toEqual({ pack: "contracts", level: null, sources: [] });
  });
});
