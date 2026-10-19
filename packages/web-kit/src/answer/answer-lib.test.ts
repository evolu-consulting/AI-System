// F12 · splitBlocks, resolveLanguage, copyText, highlightToHtml.
import { afterEach, describe, expect, test } from "bun:test";
import { splitBlocks } from "./blocks";
import { copyText } from "./clipboard";
import { highlightToHtml, resolveLanguage } from "./highlight";

describe("splitBlocks", () => {
  test("tách ở dòng trống, giữ dòng trống trong khối code", () => {
    expect(splitBlocks("a\n\nb")).toEqual(["a\n", "b"]);
    const code = "```\nx\n\ny\n```\n\nz";
    expect(splitBlocks(code)).toEqual(["```\nx\n\ny\n```\n", "z"]);
  });
  test("danh sách rời không bị cắt", () => {
    expect(splitBlocks("1. a\n\n2. b")).toHaveLength(1);
  });
  test("khối code chưa đóng nằm trọn ở khối cuối", () => {
    const b = splitBlocks("p\n\n```py\nx = 1\n\ny = 2");
    expect(b).toHaveLength(2);
    expect(b[1]).toContain("y = 2");
  });
});

describe("resolveLanguage", () => {
  test("alias và ngôn ngữ lạ", () => {
    expect(resolveLanguage("TS")).toBe("typescript");
    expect(resolveLanguage("sh")).toBe("bash");
    expect(resolveLanguage("rust")).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
  });
});

describe("highlightToHtml", () => {
  test("tô màu và escape HTML", async () => {
    const out = await highlightToHtml('const s = "<b>";', "ts");
    expect(out).toContain("hljs-keyword");
    expect(out).not.toContain("<b>");
  });
  test("review C1 #6 · điều kiện an toàn của innerHTML: chỉ có thẻ <span class=hljs-*|language-*>, mọi `<` khác đã escape", async () => {
    const payload =
      '<img src=x onerror="alert(1)"><script>alert(2)</script>\n```\n<a href="javascript:x">l</a>';
    for (const lang of ["html", "md", "ts", "bash"]) {
      const out = (await highlightToHtml(payload, lang)) ?? "";
      const rest = out.replace(/<span class="(hljs|language)-[\w .-]+">|<\/span>/g, "");
      expect(rest).not.toContain("<");
    }
  });
  test("ngôn ngữ lạ → null", async () => {
    expect(await highlightToHtml("fn main() {}", "rust")).toBeNull();
  });
});

describe("copyText", () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    if (orig) Object.defineProperty(globalThis, "navigator", orig);
  });
  const setNav = (value: unknown) =>
    Object.defineProperty(globalThis, "navigator", { value, configurable: true });
  test("thành công", async () => {
    let got = "";
    setNav({
      clipboard: {
        writeText: async (t: string) => {
          got = t;
        },
      },
    });
    expect(await copyText("hi")).toBe(true);
    expect(got).toBe("hi");
  });
  test("bị từ chối hoặc thiếu API → false, không ném", async () => {
    setNav({ clipboard: { writeText: async () => Promise.reject(new Error("denied")) } });
    expect(await copyText("hi")).toBe(false);
    setNav({});
    expect(await copyText("hi")).toBe(false);
  });
});
