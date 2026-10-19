// M1D-FR-02 · ứng viên cấp quản lý loại chính mình và cấp dưới mọi tầng (tránh vòng); dữ liệu có vòng không treo.
import { describe, expect, test } from "bun:test";
import type { OrgMember } from "@ai/contracts";
import { managerOptions, reportsOf } from "./org";

const m = (id: string, manager: string | null): OrgMember => ({
  user_id: id,
  username: id,
  display_name: id,
  manager_id: manager,
});
const tree = [m("a", null), m("b", "a"), m("c", "b"), m("d", null)];

describe("org rules", () => {
  test("cấp dưới mọi tầng", () => {
    expect([...reportsOf(tree, "a")].sort()).toEqual(["b", "c"]);
    expect([...reportsOf(tree, "c")]).toEqual([]);
  });
  test("ứng viên quản lý của a = d (không a, b, c); của c = a, b, d", () => {
    expect(managerOptions(tree, "a").map((x) => x.user_id)).toEqual(["d"]);
    expect(managerOptions(tree, "c").map((x) => x.user_id)).toEqual(["a", "b", "d"]);
  });
  test("dữ liệu vòng không treo", () => {
    expect([...reportsOf([m("x", "y"), m("y", "x")], "x")]).toEqual(["y"]);
  });
});
