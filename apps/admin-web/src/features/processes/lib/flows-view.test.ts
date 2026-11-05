// CR-120 · unit: "Một trang Quy trình" — dựng dòng, câu "khi nào chạy", lọc chip, nhóm theo app.
import { describe, expect, test } from "bun:test";
import type { ProcessRouting } from "@ai/contracts/hub-admin";
import {
  appOfSlot,
  appsOf,
  assignedRows,
  companyRows,
  filterFlows,
  GENERAL_APP,
  groupByApp,
  NO_FILTER,
  ruleParts,
  SLOT_PURPOSE,
  slotsOfCaps,
} from "./flows-view";

const slot = (s: string) => ({
  slot: s,
  def_id: null,
  def_name: null,
  version: null,
  is_default: true,
});
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
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
const REF = { slot: "contracts.approval", app: "contracts" };

describe("slotsOfCaps", () => {
  test("gom khe các app kèm app chủ, bỏ trùng, theo tên", () => {
    const apps = [
      { key: "community", slots: [slot("community.x")] },
      { key: "contracts", slots: [slot("contracts.approval"), slot("contracts.approval")] },
    ];
    expect(slotsOfCaps({ apps } as never)).toEqual([
      { slot: "community.x", app: "community" },
      { slot: "contracts.approval", app: "contracts" },
    ]);
  });
});

describe("assignedRows", () => {
  test("không luật: quy trình đang dùng ⇒ Đang dùng; còn lại chưa dùng ⇒ Tắt", () => {
    const rows = assignedRows(REF, R({ current_def_id: "a" }));
    expect(rows.map((r) => [r.id, r.status, r.when.kind, r.source])).toEqual([
      ["a", "on", "current", "platform"],
      ["b", "off", "unused", "platform"],
    ]);
  });
  test("có luật trỏ tới ⇒ Đang dùng, mang điều kiện của luật", () => {
    const rows = assignedRows(
      REF,
      R({
        rules: [
          {
            id: D1,
            priority: 0,
            condition: { departmentIds: [D2], contractKinds: ["buy"] },
            def_id: "b",
            is_default: false,
          },
        ],
      }),
    );
    const b = rows.find((r) => r.id === "b");
    expect(b?.status).toBe("on");
    expect(b?.when).toEqual({
      kind: "rules",
      rules: [{ isDefault: false, deptIds: [D2], kinds: ["buy"] }],
    });
  });
  test("đang dùng = mặc định khe ngoài tập gán ⇒ thêm một dòng riêng (không xem sơ đồ)", () => {
    const rows = assignedRows(REF, R({ current_def_id: "z", current_def_name: "Mặc định" }));
    expect(rows.at(-1)).toMatchObject({ id: "z", name: "Mặc định", outside: true, status: "on" });
  });
});

describe("ruleParts", () => {
  test("tên phòng ban tra được / chưa tra được", () => {
    const names: Record<string, string> = { [D1]: "Phòng Kinh doanh" };
    const p = ruleParts(
      { isDefault: false, deptIds: [D1, D2], kinds: ["buy"] },
      (id) => names[id] ?? "",
    );
    expect(p).toEqual({
      isDefault: false,
      kinds: ["buy"],
      depts: ["Phòng Kinh doanh"],
      unknown: 1,
    });
  });
});

describe("companyRows / lọc / nhóm", () => {
  const item = (id: string, over: Record<string, unknown>) =>
    ({
      id,
      key: id,
      name: `Q ${id}`,
      enabled: true,
      is_template: false,
      stage_count: 1,
      version: 1,
      updated_at: "2026-11-01T00:00:00Z",
      active_runs: 0,
      slot: null,
      published_version: null,
      ...over,
    }) as never;
  test("app theo tiền tố khe; không khe ⇒ Chung; bỏ id đã có ở platform gán", () => {
    expect(appOfSlot("community.moderate")).toBe("community");
    expect(appOfSlot(null)).toBe(GENERAL_APP);
    const rows = companyRows(
      [item("x", {}), item("y", { slot: "community.moderate", enabled: false }), item("a", {})],
      new Set(["a"]),
    );
    expect(rows.map((r) => [r.id, r.app, r.status, r.source])).toEqual([
      ["x", "general", "on", "company"],
      ["y", "community", "off", "company"],
    ]);
  });
  test("lọc theo app · nguồn · trạng thái; nhóm: Sổ Hợp Tác, Community, … Chung cuối", () => {
    const all = [
      ...assignedRows(REF, R({ current_def_id: "a" })),
      ...companyRows(
        [item("x", {}), item("y", { slot: "community.moderate", enabled: false })],
        new Set(),
      ),
    ];
    expect(appsOf(all)).toEqual(["contracts", "community", "general"]);
    expect(filterFlows(all, { ...NO_FILTER, source: "company" }).map((r) => r.id)).toEqual([
      "x",
      "y",
    ]);
    expect(filterFlows(all, { ...NO_FILTER, status: "off" }).map((r) => r.id)).toEqual(["b", "y"]);
    expect(
      filterFlows(all, { ...NO_FILTER, app: "contracts", status: "on" }).map((r) => r.id),
    ).toEqual(["a"]);
    const g = groupByApp(all);
    expect(g.map((x) => x.app)).toEqual(["contracts", "community", "general"]);
    expect(g[0]?.rows.map((r) => r.id)).toEqual(["a", "b"]); // Đang dùng trước
  });
});

describe("cr120-handson-fixes · khe opt-in tắt", () => {
  test("active=false ⇒ một dòng Đang tắt, không có dòng Đang dùng", () => {
    const rows = assignedRows(
      { slot: "community.post-moderation", app: "community" },
      R({ processes: [], current_def_id: D1, current_def_name: "Mặc định", active: false }),
    );
    expect(rows.map((r) => [r.id, r.status, r.when.kind])).toEqual([[D1, "off", "off"]]);
  });
  test("mọi khe của manifest có tên việc (không lộ mã khe)", () => {
    for (const s of [
      "contracts.approval",
      "contracts.intake",
      "community.post-moderation",
      "community.partner-join",
      "community.report",
    ])
      expect(SLOT_PURPOSE[s]).toBeTruthy();
  });
});
