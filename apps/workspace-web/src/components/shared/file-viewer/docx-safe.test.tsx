// fix-review-r1 (XSS) · DOCX có liên kết javascript: ⇒ bị gỡ; khung xem là iframe sandbox KHÔNG allow-scripts / allow-same-origin.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocxFrame } from "./DocxFrame";
import { buildSrcdoc, type DomEl, safeHref, sanitizeDocxDom } from "./docx-safe";

/** DOM giả tối thiểu: phần tử có tên thẻ + thuộc tính; `querySelectorAll` chỉ hiểu danh sách thẻ, "*" và "a". */
class El implements DomEl {
  removed = false;
  constructor(
    readonly tag: string,
    readonly attrs: Record<string, string> = {},
  ) {}
  getAttributeNames = () => Object.keys(this.attrs);
  getAttribute = (n: string) => this.attrs[n] ?? null;
  setAttribute = (n: string, v: string) => {
    this.attrs[n] = v;
  };
  removeAttribute = (n: string) => {
    delete this.attrs[n];
  };
  remove = () => {
    this.removed = true;
  };
}
const rootOf = (els: El[]) => ({
  querySelectorAll: (sel: string) =>
    els.filter(
      (e) => !e.removed && (sel === "*" || sel.split(",").includes(e.tag)),
    ) as Iterable<DomEl>,
});

describe("safeHref", () => {
  test("chỉ http(s):, mailto:, #", () => {
    for (const ok of ["https://a.vn/x", "http://a.vn", "mailto:a@b.vn", "#muc-1", " https://a.vn"])
      expect(safeHref(ok)).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1)",
      "java\nscript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:x",
      "file:///c:/x",
      "//evil.com",
      "/tuong-doi",
      "",
    ])
      expect(safeHref(bad)).toBe(false);
  });
});

describe("sanitizeDocxDom", () => {
  test("liên kết javascript: bị gỡ href; liên kết https giữ + rel/target an toàn", () => {
    const bad = new El("a", { href: "javascript:alert(document.cookie)" });
    const good = new El("a", { href: "https://evolu.vn" });
    const anchor = new El("a", { href: "#muc" });
    sanitizeDocxDom(rootOf([bad, good, anchor]));
    expect(bad.getAttribute("href")).toBeNull();
    expect(good.attrs).toMatchObject({
      href: "https://evolu.vn",
      rel: "noopener noreferrer",
      target: "_blank",
    });
    expect(anchor.getAttribute("href")).toBe("#muc");
  });
  test("gỡ script/iframe/object/meta/form + mọi thuộc tính on*", () => {
    const els = [
      new El("script"),
      new El("iframe"),
      new El("object"),
      new El("meta"),
      new El("form"),
    ];
    const p = new El("p", { onclick: "x()", OnMouseOver: "y()", class: "c" });
    sanitizeDocxDom(rootOf([...els, p]));
    expect(els.every((e) => e.removed)).toBe(true);
    expect(p.attrs).toEqual({ class: "c" });
  });
});

describe("khung xem Word", () => {
  test("iframe sandbox rỗng: không allow-scripts, không allow-same-origin", () => {
    const html = renderToStaticMarkup(<DocxFrame srcDoc="<p>x</p>" title="Word" />);
    expect(html).toContain('sandbox=""');
    expect(html).not.toContain("allow-scripts");
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain("srcDoc");
  });
  test("srcdoc có CSP chặn mọi nguồn trừ ảnh/font data:", () => {
    const d = buildSrcdoc("<p>a</p>", "<style>p{}</style>");
    expect(d).toContain("Content-Security-Policy");
    expect(d).toContain("default-src 'none'");
    expect(d).not.toContain("script-src");
    expect(d.indexOf("Content-Security-Policy")).toBeLessThan(d.indexOf("<style>"));
  });
});
