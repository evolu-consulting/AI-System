// CR-158 · favicon theo logo công ty (DOM giả tối thiểu, không cần happy-dom).
import { describe, expect, test } from "bun:test";
import { applyFavicon } from "./brand";

type El = {
  rel?: string;
  href?: string;
  dataset: Record<string, string | undefined>;
  attrs: Record<string, string>;
  removed?: boolean;
  removeAttribute(k: string): void;
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
  remove(): void;
};
const mk = (href?: string): El => {
  const e: El = {
    dataset: {},
    attrs: href === undefined ? {} : { href },
    removeAttribute: (k) => {
      delete e.attrs[k];
    },
    getAttribute: (k) => e.attrs[k] ?? null,
    setAttribute: (k, v) => {
      e.attrs[k] = v;
    },
    remove: () => {
      e.removed = true;
      doc.list = doc.list.filter((x) => x !== e);
    },
  };
  Object.defineProperty(e, "href", {
    get: () => e.attrs.href,
    set: (v: string) => {
      e.attrs.href = v;
    },
  });
  return e;
};
const doc = {
  list: [] as El[],
  querySelector() {
    return this.list[0] ?? null;
  },
  createElement: () => mk(),
  head: {
    appendChild: (e: El) => {
      doc.list.push(e);
    },
  },
};
const d = doc as unknown as Document;

describe("applyFavicon", () => {
  test("logo: tạo link icon theo logo, đổi logo thì thay href, hết logo thì gỡ", () => {
    doc.list = [];
    applyFavicon("/logo-a.png", d);
    expect(doc.list).toHaveLength(1);
    expect(doc.list[0]?.attrs.href).toBe("/logo-a.png");
    applyFavicon("/logo-b.png", d);
    expect(doc.list).toHaveLength(1);
    expect(doc.list[0]?.attrs.href).toBe("/logo-b.png");
    applyFavicon(null, d);
    expect(doc.list).toHaveLength(0);
  });
  test("có sẵn icon mặc định: logo thay href, hết logo trả về href gốc", () => {
    doc.list = [mk("/evolu-icon.svg")];
    applyFavicon("/x.png", d);
    expect(doc.list[0]?.attrs.href).toBe("/x.png");
    applyFavicon(null, d);
    expect(doc.list[0]?.attrs.href).toBe("/evolu-icon.svg");
  });
  test("chưa đăng nhập, không logo: không đụng gì", () => {
    doc.list = [mk("/evolu-icon.svg")];
    applyFavicon(null, d);
    expect(doc.list[0]?.attrs.href).toBe("/evolu-icon.svg");
  });
});
