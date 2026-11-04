import { describe, expect, test } from "bun:test";
import { caseCollisions, formatCollisions } from "./check-case.rules";

describe("check:case caseCollisions", () => {
  test("file khác hoa/thường va nhau", () => {
    expect(caseCollisions(["src/A.ts", "src/a.ts"])).toEqual([{ a: "src/A.ts", b: "src/a.ts" }]);
  });

  test("tiền tố thư mục khác hoa/thường va nhau (tests/acceptance/cr118 vs CR118)", () => {
    expect(
      caseCollisions([
        "tests/acceptance/CR118/capabilities.int.test.ts",
        "tests/acceptance/cr118/form-node.int.test.ts",
      ]),
    ).toEqual([{ a: "tests/acceptance/CR118", b: "tests/acceptance/cr118" }]);
  });

  test("thư mục và file trùng tên khác hoa/thường cũng va", () => {
    expect(caseCollisions(["lib/util/x.ts", "Lib/y.ts"])).toEqual([{ a: "Lib", b: "lib" }]);
  });

  test("đường dẫn trùng nhau tuyệt đối không tạo cặp", () => {
    expect(caseCollisions(["a/b/c.ts", "a/b/c.ts", "a/b/d.ts", "a/b/c.ts"])).toEqual([]);
  });

  test("khác tên hẳn hoặc chỉ khác tiền tố chung không phải va chạm", () => {
    expect(
      caseCollisions(["apps/web/a.ts", "apps/web-api/a.ts", "docs/A.md", "docs/B.md"]),
    ).toEqual([]);
  });

  test("tách biệt đúng: chỉ liệt kê cặp thực sự va", () => {
    expect(caseCollisions(["x/Foo.ts", "x/foo.ts", "y/bar.ts"])).toEqual([
      { a: "x/Foo.ts", b: "x/foo.ts" },
    ]);
  });
});

describe("check:case formatCollisions", () => {
  test("không có va chạm → chuỗi rỗng", () => {
    expect(formatCollisions([])).toBe("");
  });

  test("liệt kê từng cặp và nêu lý do", () => {
    const msg = formatCollisions([{ a: "tests/acceptance/CR118", b: "tests/acceptance/cr118" }]);
    expect(msg).toContain("1 cặp");
    expect(msg).toContain('"tests/acceptance/CR118"  ↔  "tests/acceptance/cr118"');
  });
});
