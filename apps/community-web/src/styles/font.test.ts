// Trang Đăng nhập nằm ngoài .app ⇒ phông phải đặt ở body, không thì trình duyệt hiện Times New Roman.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("phông community-web", () => {
  it("body dùng Be Vietnam Pro", () => {
    const css = readFileSync(join(import.meta.dir, "mockup.css"), "utf8");
    const body = css.match(/(^|\n)body\s*\{[^}]*\}/)?.[0] ?? "";
    expect(body).toContain('font-family: "Be Vietnam Pro"');
  });
});
