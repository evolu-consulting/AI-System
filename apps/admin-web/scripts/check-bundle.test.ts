import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBundle, initialAssets } from "./check-bundle";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Byte ngẫu nhiên gần như không nén được → kích thước gzip ≈ kích thước gốc. */
const noise = (kb: number): Uint8Array => {
  const out = new Uint8Array(kb * 1024);
  for (let i = 0; i < out.length; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, out.length)));
  }
  return out;
};

function makeDist(html: string, files: Record<string, Uint8Array | string>): string {
  const dir = mkdtempSync(join(tmpdir(), "check-bundle-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), html);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const page = (js: string[], css: string[] = []) =>
  `<html><head>${css.map((h) => `<link href="${h}" rel="stylesheet">`).join("")}` +
  `<link rel="preload" href="/static/js/async/x.js">` +
  `${js.map((s) => `<script defer src="${s}"></script>`).join("")}</head></html>`;

describe("ADM-NFR-06 · M0-AC19 · check:bundle", () => {
  test("lấy script/stylesheet, bỏ preload", () => {
    expect(initialAssets(page(["/a.js"], ["/a.css"]))).toEqual({ js: ["/a.js"], css: ["/a.css"] });
  });

  test("dưới ngưỡng → không lỗi", () => {
    const dir = makeDist(page(["/static/js/a.js"], ["/static/css/a.css"]), {
      "static/js/a.js": "console.log(1);",
      "static/css/a.css": "a{color:red}",
    });
    expect(checkBundle(dir).errors).toEqual([]);
  });

  test("JS vượt ngưỡng → lỗi đúng câu", () => {
    const dir = makeDist(page(["/static/js/big.js"]), { "static/js/big.js": noise(160) });
    const { errors } = checkBundle(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^check:bundle js \d+\.\d KB > 150 KB$/);
  });

  test("2 script cộng dồn vượt dù từng file dưới ngưỡng", () => {
    const dir = makeDist(page(["/a.js", "/b.js"]), { "a.js": noise(80), "b.js": noise(80) });
    expect(checkBundle(dir).errors[0]).toMatch(/^check:bundle js \d+\.\d KB > 150 KB$/);
  });

  test("CSS vượt ngưỡng → lỗi css, JS trước CSS", () => {
    const dir = makeDist(page(["/a.js"], ["/a.css"]), { "a.js": noise(160), "a.css": noise(30) });
    const { errors } = checkBundle(dir);
    expect(errors[0]).toStartWith("check:bundle js ");
    expect(errors[1]).toMatch(/^check:bundle css \d+\.\d KB > 25 KB$/);
  });

  test("thiếu index.html hoặc file tham chiếu → lỗi thiếu", () => {
    const empty = mkdtempSync(join(tmpdir(), "check-bundle-"));
    dirs.push(empty);
    expect(checkBundle(empty).errors).toEqual(["check:bundle: thiếu dist/index.html"]);
    const dir = makeDist(page(["/static/js/none.js"]), {});
    expect(checkBundle(dir).errors).toEqual(["check:bundle: thiếu dist/static/js/none.js"]);
  });
});
