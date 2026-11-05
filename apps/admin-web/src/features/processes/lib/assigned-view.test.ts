// hub-routing-backfill · unit: mục "Được platform gán" của /processes.
import { describe, expect, test } from "bun:test";
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import { assignedView, slotsOfCaps } from "./assigned-view";

const slot = (s: string) => ({
  slot: s,
  def_id: null,
  def_name: null,
  version: null,
  is_default: true,
});
const R = (over: Partial<ProcessRouting>): ProcessRouting => ({
  slot: "contracts.approval",
  version: 0,
  rules: [],
  processes: [
    { def_id: "a", name: "QT A", rel_version: 2 },
    { def_id: "b", name: "QT B", rel_version: null },
  ],
  ...over,
});

describe("assigned-view", () => {
  test("slotsOfCaps: gom khe các app, bỏ trùng, theo tên", () => {
    const apps = [
      { slots: [slot("x.b"), slot("contracts.approval")] },
      { slots: [slot("contracts.approval")] },
    ];
    expect(slotsOfCaps({ apps } as never)).toEqual(["contracts.approval", "x.b"]);
  });
  test("gán cũ đang dùng ⇒ hàng đó 'Đang dùng'", () => {
    const v = assignedView(R({ current_def_id: "a" }));
    expect(v.rows).toEqual([
      { defId: "a", name: "QT A", version: 2, inUse: true },
      { defId: "b", name: "QT B", version: null, inUse: false },
    ]);
    expect(v.outside).toBeNull();
  });
  test("đang dùng = mặc định khe ngoài tập ⇒ dòng riêng; vắng ⇒ không nhãn", () => {
    expect(assignedView(R({ current_def_id: "d", current_def_name: "Mặc định" })).outside).toEqual({
      defId: "d",
      name: "Mặc định",
    });
    expect(assignedView(R({})).rows.some((r) => r.inUse)).toBe(false);
  });
});
