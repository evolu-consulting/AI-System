// ADM-FR-32 · M3-R08, R09 · toRows/viewRows/planBatch: hàng core, entitled, revoked (khoá), none (ẩn); batch chỉ gồm thay đổi.
import { describe, expect, test } from "bun:test";
import type { GrantMatrix } from "@ai/contracts";
import { type GrantRow, planBatch, toRows, viewRows } from "./grants";

const G = "g1";
const feat = (id: string, state: string, granted: string[] = []) => ({
  feature: { id, key: id, name: { vi: id }, status: "on", is_core: state === "core" },
  state,
  command_names: ["a"],
  command_count: 1,
  granted_group_ids: granted,
});
const matrix = {
  tenant_id: "t",
  group_total: 1,
  groups: [],
  features: [
    feat("core", "core"),
    feat("kt", "entitled", [G]),
    feat("dich", "entitled"),
    feat("rev", "revoked", [G]),
    feat("none", "none"),
  ],
} as unknown as GrantMatrix;

describe("ADM-FR-32 · tab Feature của group", () => {
  const rows = toRows(matrix, G);

  test("toRows bỏ hàng chưa mở; granted theo group", () => {
    expect(rows.map((r) => r.id)).toEqual(["core", "kt", "dich", "rev"]);
    expect(rows.filter((r) => r.granted).map((r) => r.id)).toEqual(["kt", "rev"]);
  });

  test("viewRows: core + feature đang được cấp (kể cả đã thu hồi entitlement)", () => {
    expect(viewRows(rows).map((r) => r.id)).toEqual(["core", "kt", "rev"]);
  });

  test("planBatch: chỉ thay đổi trên hàng sửa được; không đổi gì → rỗng; hàng revoked/core bị bỏ qua", () => {
    const keep = new Set(["kt"]);
    expect(planBatch(rows, keep, G)).toEqual({ add: [], remove: [] });
    const plan = planBatch(rows, new Set(["dich"]), G);
    expect(plan.add).toEqual([{ feature_id: "dich", group_id: G }]);
    expect(plan.remove).toEqual([{ feature_id: "kt", group_id: G }]);
    const all = planBatch(rows as GrantRow[], new Set(["core", "rev"]), G);
    expect(all.add).toEqual([]);
    expect(all.remove).toEqual([{ feature_id: "kt", group_id: G }]);
  });
});
