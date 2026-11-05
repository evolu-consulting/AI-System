import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asyncChunkSizes, checkBundle, initialAssets, JS_BUDGET_BYTES } from "./check-bundle";

const JS_KB = JS_BUDGET_BYTES / 1024;
const OVER_KB = Math.ceil(JS_KB) + 10;
const HALF_KB = Math.ceil(OVER_KB / 2);

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

  test("thuộc tính nháy đơn và không nháy", () => {
    const html =
      "<html><head><link rel='stylesheet' href='/s.css'><link rel=stylesheet href=/b.css>" +
      "<link rel=preload href=/p.js><script defer src='/a.js'></script>" +
      "<script type=module src=/b.js></script><script>inline()</script></head></html>";
    expect(initialAssets(html)).toEqual({ js: ["/a.js", "/b.js"], css: ["/s.css", "/b.css"] });
  });

  test("dưới ngưỡng → không lỗi", () => {
    const dir = makeDist(page(["/static/js/a.js"], ["/static/css/a.css"]), {
      "static/js/a.js": "console.log(1);",
      "static/css/a.css": "a{color:red}",
    });
    expect(checkBundle(dir).errors).toEqual([]);
  });

  test("JS vượt ngưỡng → lỗi đúng câu", () => {
    const dir = makeDist(page(["/static/js/big.js"]), { "static/js/big.js": noise(OVER_KB) });
    const { errors } = checkBundle(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(new RegExp(`^check:bundle js \\d+\\.\\d KB > ${JS_KB} KB$`));
  });

  test("zod trong JS tải ban đầu → lỗi (hằng số phải qua @ai/contracts/light)", () => {
    const dir = makeDist(page(["/static/js/a.js"]), {
      "static/js/a.js": 'x({code:"invalid_type"});',
    });
    expect(checkBundle(dir).errors).toEqual([
      "check:bundle zod nằm trong JS ban đầu (/static/js/a.js)",
    ]);
  });

  test("2 script cộng dồn vượt dù từng file dưới ngưỡng", () => {
    const dir = makeDist(page(["/a.js", "/b.js"]), {
      "a.js": noise(HALF_KB),
      "b.js": noise(HALF_KB),
    });
    expect(checkBundle(dir).errors[0]).toMatch(
      new RegExp(`^check:bundle js \\d+\\.\\d KB > ${JS_KB} KB$`),
    );
  });

  test("CSS vượt ngưỡng → lỗi css, JS trước CSS", () => {
    const dir = makeDist(page(["/a.js"], ["/a.css"]), {
      "a.js": noise(OVER_KB),
      "a.css": noise(30),
    });
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

describe("ADM-NFR-06 · M2 · ngân sách chunk route", () => {
  const withChunks = (files: Record<string, Uint8Array | string>) =>
    makeDist(page(["/static/js/a.js"]), { "static/js/a.js": "x", ...files });

  test("chunk bất đồng bộ ≤ 50 KB → không lỗi và báo chunk lớn nhất", () => {
    const dir = withChunks({ "static/js/async/r.js": noise(20) });
    const r = checkBundle(dir);
    expect(r.errors).toEqual([]);
    expect(Number(r.maxChunkKb)).toBeGreaterThan(19);
  });

  test("chunk vượt 50 KB → lỗi nêu tên chunk", () => {
    const dir = withChunks({ "static/js/async/big.js": noise(60), "static/js/async/ok.js": "1" });
    expect(checkBundle(dir).errors).toEqual([expect.stringContaining("chunk big.js")]);
  });

  test("CR-106: chunk canvas-* được 80 KB, vượt 80 KB vẫn lỗi; chunk khác vẫn 50 KB", () => {
    const ok = withChunks({ "static/js/async/canvas-xyflow.a1.js": noise(60) });
    expect(checkBundle(ok).errors).toEqual([]);
    const big = withChunks({ "static/js/async/canvas-xyflow.a1.js": noise(90) });
    expect(checkBundle(big).errors).toEqual([expect.stringContaining("> 80 KB")]);
  });

  test("không có thư mục async → bỏ qua; chỉ đọc file .js", () => {
    expect(asyncChunkSizes(withChunks({}))).toEqual([]);
    const dir = withChunks({ "static/js/async/a.js.LICENSE.txt": noise(80) });
    expect(asyncChunkSizes(dir)).toEqual([]);
  });
});
