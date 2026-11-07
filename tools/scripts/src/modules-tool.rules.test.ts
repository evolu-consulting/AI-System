// CR-125 · m3 · MOD-FR-06 · unit luật công cụ sổ module.
import { describe, expect, test } from "bun:test";
import { MODULES, moduleIssues } from "@ai/contracts/modules";
import {
  addNodeToModule,
  moduleSource,
  nameError,
  nodeSource,
  renderIndex,
  scanNodePaths,
  staticBound,
  staticIssues,
} from "./modules-tool.rules";

const CURRENT = `// CR-125 · m3 · TỰ SINH bởi \`bun run module:index\` — KHÔNG sửa tay. SỔ MODULE: danh sách node DUY NHẤT (MOD-FR-06),
// sinh từ thư mục \`modules/<app>/<node>/node.ts\`.
import { COMMUNITY_MODULE } from "./community/module";
import { CONTRACTS_MODULE } from "./contracts/module";
import { CORE_MODULE } from "./core";
import type { FeatureModule } from "./types";

export const MODULES: readonly FeatureModule[] = [CORE_MODULE, CONTRACTS_MODULE, COMMUNITY_MODULE];
`;

describe("renderIndex", () => {
  test("thứ tự cố định core contracts rồi bảng chữ cái", () => {
    expect(renderIndex(["community", "contracts"])).toBe(CURRENT);
  });
  test("tất định: thứ tự đầu vào và trùng không đổi kết quả", () => {
    expect(renderIndex(["b", "a", "b"])).toBe(renderIndex(["a", "b"]));
  });
});

describe("scanNodePaths", () => {
  test("chỉ nhận <app>/<node>/node.ts", () => {
    const m = scanNodePaths(["a/x/node.ts", "a/b/node.ts", "a/module.ts", "a/x/node.test.ts"]);
    expect(m.get("a")).toEqual(["b", "x"]);
    expect(m.size).toBe(1);
  });
});

describe("staticIssues", () => {
  const nodes = new Map([["demo", ["sample"]]]);
  const okIdx = renderIndex(["demo"]);
  const okSrc = new Map([["demo", moduleSource("demo", "sample")]]);
  test("sạch khi index mới và module.ts đủ", () => {
    expect(staticIssues({ nodes, moduleSrc: okSrc, currentIndex: okIdx })).toEqual([]);
  });
  test("MOD_INDEX_STALE khi index cũ, câu tiếng Việt theo spec", () => {
    const r = staticIssues({ nodes, moduleSrc: okSrc, currentIndex: "cũ" });
    expect(r[0]?.code).toBe("MOD_INDEX_STALE");
    expect(r[0]?.message).toBe(
      "Danh sách module tự sinh đã cũ — chạy bun run module:index rồi commit.",
    );
  });
  test("thiếu module.ts hoặc node chưa liệt kê thì lỗi", () => {
    expect(staticIssues({ nodes, moduleSrc: new Map(), currentIndex: okIdx })).toHaveLength(1);
    const src = new Map([["demo", "export const x = 1;"]]);
    expect(staticIssues({ nodes, moduleSrc: src, currentIndex: okIdx })[0]?.key).toBe(
      "demo.sample",
    );
  });
});

describe("module:new", () => {
  test("nameError từ chối tên xấu", () => {
    expect(nameError("app", "Demo")).toContain("không hợp lệ");
    expect(nameError("node", "show-post")).toBeNull();
  });
  test(
    "node.ts khung có menu nghiệp vụ ⇒ node mới hiện ở menu " + " với panel chung (CR-125 m6b)",
    () => {
      expect(nodeSource("demo", "sample")).toContain('menu: { section: "business" }');
    },
  );
  test("addNodeToModule thêm import + nodes[], idempotent", () => {
    const once = addNodeToModule(moduleSource("demo", "sample"), "other-one");
    expect(once).toContain('import { OTHER_ONE_NODE } from "./other-one/node";');
    expect(once).toContain("nodes: [SAMPLE_NODE, OTHER_ONE_NODE]");
    expect(addNodeToModule(once, "other-one")).toBe(once);
  });
});

describe("module:new · cổng vào/ra (CR-125 m8)", () => {
  test("node.ts sinh ra có khối inputs + outputs với nhãn vi/en, đầu ra mẫu pending", () => {
    const src = nodeSource("demo", "sample");
    expect(src).toContain("outputs: [");
    expect(src).toContain('label: { vi: "Kết quả", en: "Result" }');
    expect(src).toContain("pending: true");
    expect(src).toContain('label: { vi: "Bản ghi", en: "Record" }');
  });
  test("check:modules tĩnh: sổ thật không lỗi (đầu ra không pending được coi là đã ghi)", () => {
    expect(moduleIssues(MODULES, staticBound(MODULES))).toEqual([]);
  });
});
