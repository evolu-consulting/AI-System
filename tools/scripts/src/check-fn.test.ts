import { describe, expect, test } from "bun:test";
import { analyzeSource, applyAllow, formatViolation, inScope, violationsOf } from "./check-fn";

/** Hàm có tổng `n` dòng (chữ ký + thân + dấu đóng). */
const fnOf = (name: string, n: number, params = "") =>
  `function ${name}(${params}) {\n${"  x();\n".repeat(n - 2)}}\n`;

describe("ADM-NFR-06 · check:fn phạm vi (plan M3 §7)", () => {
  test.each([
    ["apps/admin-api/src/app.ts", true],
    ["apps/admin-web/src/features/x/A.tsx", true],
    ["packages/db/src/scope.ts", true],
    ["tools/scripts/src/check-fn.test.ts", true],
    ["tests/acceptance/M2/x.test.ts", false],
    ["e2e/smoke.spec.ts", false],
    ["apps/admin-web/src/components/ui/button.tsx", false],
    ["tools/scripts/src/__fixtures__/a/b.ts", false],
    ["apps/admin-web/src/routeTree.gen.ts", false],
    ["apps/admin-web/rsbuild.config.ts", false],
    ["packages/x/src/types.d.ts", false],
    ["docs/a.md", false],
  ])("%s → %p", (path, want) => {
    expect(inScope(path)).toBe(want);
  });
});

describe("ADM-NFR-06 · check:fn đo dòng và tham số", () => {
  test("50 dòng qua, 51 dòng vi phạm", () => {
    const fns = analyzeSource("a.ts", fnOf("ok", 50) + fnOf("bad", 51));
    expect(fns.map((f) => [f.name, f.lines])).toEqual([
      ["ok", 50],
      ["bad", 51],
    ]);
    expect(violationsOf("a.ts", fns).map((v) => v.name)).toEqual(["bad"]);
  });

  test("4 tham số qua, 5 vi phạm; `this` không tính; destructuring = 1", () => {
    const src = [
      "function a(p: number, q: number, r: number, s: number) {}",
      "function b(p: number, q: number, r: number, s: number, t: number) {}",
      "function c(this: Window, p: number, q: number, r: number, s: number) {}",
      "const d = ({ p, q, r, s, t }: Record<string, number>) => p;",
    ].join("\n");
    const v = violationsOf("a.ts", analyzeSource("a.ts", src));
    expect(v.map((x) => [x.name, x.params, x.overParams])).toEqual([["b", 5, true]]);
  });

  test("component PascalCase trong .tsx giới hạn 200; hàm thường trong .tsx vẫn 50", () => {
    const src = fnOf("Page", 200) + fnOf("Big", 201) + fnOf("helper", 51);
    const v = violationsOf("A.tsx", analyzeSource("A.tsx", src));
    expect(v.map((x) => [x.name, x.limit])).toEqual([
      ["Big", 200],
      ["helper", 50],
    ]);
  });

  test("PascalCase trong .ts không phải component", () => {
    expect(violationsOf("a.ts", analyzeSource("a.ts", fnOf("Page", 51)))[0]?.limit).toBe(50);
  });
});

describe("ADM-NFR-06 · check:fn tên hàm và hàm lồng", () => {
  test("hàm lồng tính riêng; tên theo biến, method, callback", () => {
    const src = [
      "const outer = () => { const inner = function () {}; return inner; };",
      "class K { m(a: number) { return a; } constructor() {} }",
      'describe("ADM-FR-01 · một mô tả rất dài vượt quá bốn mươi ký tự cho chắc", () => {});',
      "const Card = memo((p: unknown) => p);",
      "[1].map((x) => x);",
    ].join("\n");
    expect(analyzeSource("a.tsx", src).map((f) => f.name)).toEqual([
      "outer",
      "inner",
      "m",
      "constructor",
      'describe("ADM-FR-01 · một mô tả rất dài vượt quá b")',
      "Card",
      "[1].map(…)",
    ]);
  });

  test("khai báo không thân (overload) bỏ qua", () => {
    expect(analyzeSource("a.ts", "declare function f(a, b, c, d, e): void;")).toEqual([]);
  });
});

describe("ADM-NFR-06 · check:fn allowlist", () => {
  const v = violationsOf("a.ts", analyzeSource("a.ts", fnOf("bad", 60) + fnOf("worse", 70)));

  test("mục allowlist khớp file + tên thì không đỏ; mục thừa trong file đã kiểm → stale", () => {
    const r = applyAllow(
      v,
      [
        { file: "a.ts", name: "bad", reason: "nợ cũ" },
        { file: "a.ts", name: "gone", reason: "đã sửa" },
        { file: "b.ts", name: "x", reason: "file không kiểm" },
      ],
      new Set(["a.ts"]),
    );
    expect(r.failing.map((x) => x.name)).toEqual(["worse"]);
    expect(r.stale.map((x) => x.name)).toEqual(["gone"]);
  });

  test("định dạng báo lỗi có path:dòng, tên, lý do", () => {
    expect(formatViolation(v[0] as (typeof v)[number])).toBe("a.ts:1 bad (60 dòng > 50)");
  });
});
