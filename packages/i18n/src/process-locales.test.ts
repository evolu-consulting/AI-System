// CR-056 · P-a: chuỗi `process.*` — đủ phần, vi/en cùng tập khoá + tham số, đổi cú pháp tham số cho Admin.
import { describe, expect, test } from "bun:test";
import { loadProcessLocale, PROCESS_LOCALE_PARTS, toSingleBrace } from "./process-locales";

type Tree = { [k: string]: string | Tree };
function flat(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === "string") out[`${prefix}${k}`] = v;
    else Object.assign(out, flat(v, `${prefix}${k}.`));
  }
  return out;
}
const params = (s: string) =>
  [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();

describe("process-locales", () => {
  test("vi và en cùng khoá, cùng tham số, không rỗng", async () => {
    const vi = flat((await loadProcessLocale("vi")) as Tree);
    const en = flat((await loadProcessLocale("en")) as Tree);
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(vi)) {
      expect(params(vi[k] ?? "")).toEqual(params(en[k] ?? ""));
      expect((vi[k] ?? "").trim()).not.toBe("");
    }
  });
  test("khoá nguyên văn e2e có mặt (VI)", async () => {
    const vi = flat((await loadProcessLocale("vi")) as Tree);
    expect(vi["process.composer.button"]).toBe("Quy trình");
    expect(vi["process.inbox.todo.title"]).toBe("Chờ tôi kiểm");
    expect(vi["process.run.review.pass"]).toBe("Đạt");
    expect(vi["process.thread.err.noAgent"]).toContain("@");
    expect(vi["process.common.status.needs_decision"]).toBe("Cần người quyết");
  });
  test("khoá nguyên văn e2e của Nguồn (VI)", async () => {
    const vi = flat((await loadProcessLocale("vi", ["sources", "inputs"])) as Tree);
    expect(vi["process.sources.title"]).toBe("Nguồn tham chiếu");
    expect(vi["process.sources.add"]).toBe("Thêm nguồn");
    expect(vi["process.sources.field.path"]).toBe("Đường dẫn trên máy Runtime");
    expect(vi["process.sources.delete.title"]).toBe("Xoá nguồn {{key}}?");
    expect(vi["process.inputs.form.start"]).toBe("Bắt đầu quy trình");
  });
  test("chọn phần: chỉ common + admin", async () => {
    const t = (await loadProcessLocale("en", ["common", "admin"])) as { process: Tree };
    expect(Object.keys(t.process)).toEqual(["common", "admin"]);
    expect(PROCESS_LOCALE_PARTS).toHaveLength(11);
  });
  test("toSingleBrace: {{x}} → {x} đệ quy", () => {
    expect(toSingleBrace({ a: { b: "Chào {{name}}, {{n}}/{{max}}" }, c: 1 })).toEqual({
      a: { b: "Chào {name}, {n}/{max}" },
      c: 1,
    });
  });
});
