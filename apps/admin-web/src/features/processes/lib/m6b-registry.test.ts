// CR-125 · m6b · MOD-FR-06: menu "+", palette và panel đọc node ĐÚNG MỘT nguồn (`MODULES` + sổ panel). Node dựng bằng fixture giống kết quả
// `bun run module:new demo sample` (KHÔNG commit node demo): chỉ khai báo node.ts ⇒ có mặt ở menu "+" với panel chung, không sửa file nào khác.
import { describe, expect, test } from "bun:test";
import type { FeatureModule, FeatureNodeDecl } from "@ai/contracts/modules";
import { nodesOfApp } from "@ai/contracts/modules";
import { z } from "zod";
import { fieldsOf } from "../modules/generic/fields";
import { configPortOf, hasNodePanel, panelRegistry } from "../modules/panel-registry";
import { nodesForApp } from "./flow-def";
import { splitMenu } from "./node-menu";
import { nodeToPatches } from "./palette-node";

const SAMPLE: FeatureNodeDecl = {
  key: "demo.sample",
  label: { vi: "Mẫu", en: "Sample" },
  group: "content",
  kind: "app",
  menu: { section: "business" },
  configPort: {
    schema: z.object({ note: z.string().optional().describe("Ghi chú") }),
    widgets: { note: "text" },
  },
  stages: [{ executor: { kind: "tool", tool_key: "demo-sample", args: {} } }],
  inputs: [],
  outputs: [],
};
const HIDDEN: FeatureNodeDecl = {
  ...SAMPLE,
  key: "demo.hidden",
  menu: { section: "advanced" },
};
const FIXTURE: FeatureModule = { app: "demo", events: [], nodes: [SAMPLE, HIDDEN] };
const palette = nodesOfApp([FIXTURE], "demo");
const keys = (xs: ReturnType<typeof splitMenu>["business"]) =>
  xs.map((x) => (x.kind === "table" ? x.entry.id : x.node.key));

describe("node mới chỉ khai báo ở module vẫn vào menu + panel chung", () => {
  test("palette (từ sổ) có node, giữ `menu`, không lộ phần riêng của sổ", () => {
    expect(palette.map((n) => n.key)).toEqual(["demo.sample", "demo.hidden"]);
    expect(palette[0]?.menu).toEqual({ section: "business" });
    expect(Object.keys(palette[0] ?? {})).not.toContain("configPort");
  });
  test("menu '+' của công ty có node mới (nhóm nghiệp vụ), nhóm Nâng cao chỉ cho quản trị nền tảng", () => {
    const table = nodesForApp("contracts");
    const company = splitMenu({ app: "demo", isPlatform: false, table, modules: palette });
    expect(keys(company.business)).toContain("demo.sample");
    expect(keys(company.business)).not.toContain("demo.hidden");
    expect(company.advanced).toEqual([]);
    const admin = splitMenu({ app: "demo", isPlatform: true, table, modules: palette });
    expect(keys(admin.advanced)).toContain("demo.hidden");
  });
  test("chọn node ⇒ stage mẫu mang khoá node (bước thêm vào sơ đồ)", () => {
    const [p] = nodeToPatches(palette[0] as NonNullable<(typeof palette)[number]>);
    expect(p?.node).toBe("demo.sample");
  });
  test("panel chung dựng từ cổng cấu hình, không cần đăng ký panel riêng", () => {
    const node = palette[0];
    expect(panelRegistry.has("demo.sample")).toBe(false);
    expect(hasNodePanel(node, [FIXTURE])).toBe(true);
    const port = configPortOf("demo.sample", [FIXTURE]);
    expect(fieldsOf(port as NonNullable<typeof port>).map((f) => [f.key, f.label])).toEqual([
      ["note", "Ghi chú"],
    ]);
  });
});

describe("không còn danh sách node cứng: thứ tự + nhóm đọc từ khai báo", () => {
  test("bước cơ bản đọc từ registry loại node (Duyệt, Nếu, Kết thúc ở nghiệp vụ; Ghi giá trị cuối Nâng cao)", () => {
    const t = nodesForApp("contracts");
    expect(t.filter((e) => e.section === "business").map((e) => e.id)).toEqual([
      "approve",
      "if",
      "form", // CR-127 · E9
      "finish",
    ]);
    expect(t.filter((e) => e.section === "advanced").at(-1)?.id).toBe("set");
  });
  test("node cùng nhóm xếp theo order", () => {
    const a = { ...SAMPLE, key: "demo.a", menu: { section: "business" as const, order: 70 } };
    const b = { ...SAMPLE, key: "demo.b", menu: { section: "business" as const, order: 5 } };
    const m = splitMenu({
      app: "demo",
      isPlatform: false,
      table: [],
      modules: nodesOfApp([{ ...FIXTURE, nodes: [a, b] }], "demo"),
    });
    expect(keys(m.business)).toEqual(["demo.b", "demo.a"]);
  });
});
