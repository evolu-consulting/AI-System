// ADM-NFR-06, ADM-FR-60 · vi và en phải dùng cùng tập tham số `{x}` cho mỗi key (tránh thiếu biến ở một ngôn ngữ).
import { describe, expect, test } from "bun:test";
import { resources } from "./index";

type Tree = { [k: string]: string | Tree };

function flat(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out[`${prefix}${k}`] = v;
    else Object.assign(out, flat(v, `${prefix}${k}.`));
  }
  return out;
}

// So theo tập (bỏ lặp): một ngôn ngữ có thể dùng cùng tham số hai lần (vd vi `access.reason.noGrant` lặp {user}).
const params = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

describe("ADM-NFR-06 · tham số nội suy vi/en", () => {
  test("mỗi key có cùng tập {tham số} ở hai ngôn ngữ", () => {
    const vi = flat(resources.vi.translation as Tree);
    const en = flat(resources.en.translation as Tree);
    const diff = Object.keys(vi).filter(
      (k) => JSON.stringify(params(vi[k] ?? "")) !== JSON.stringify(params(en[k] ?? "")),
    );
    expect(diff).toEqual([]);
  });

  test("không có giá trị rỗng", () => {
    const vi = flat(resources.vi.translation as Tree);
    const en = flat(resources.en.translation as Tree);
    const empty = [...Object.entries(vi), ...Object.entries(en)].filter(([, v]) => v.trim() === "");
    expect(empty).toEqual([]);
  });
});
