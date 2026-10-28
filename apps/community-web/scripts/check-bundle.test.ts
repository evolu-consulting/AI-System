// Review Thấp-12: check:bundle báo lỗi khi bản build chứa adapter mock / dữ liệu mẫu.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockLeaks } from "./check-bundle";

const dir = mkdtempSync(join(tmpdir(), "cw-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("check:bundle · không chứa mock", () => {
  it("file JS (kể cả async) có dấu dữ liệu mẫu ⇒ bị nêu; sạch ⇒ rỗng", () => {
    mkdirSync(join(dir, "static", "js", "async"), { recursive: true });
    writeFileSync(join(dir, "static", "js", "index.js"), "console.log('ok')");
    expect(mockLeaks(dir)).toEqual([]);
    writeFileSync(join(dir, "static", "js", "async", "1.js"), 'const o={id:"tanphat"}');
    expect(mockLeaks(dir)).toEqual(["1.js"]);
  });
});
