import { describe, expect, test } from "bun:test";
import { formatJson, mergeJson3, mergeJsonText, mergeKeyOrder } from "./json-merge.rules";

const merge = (b: object, o: object, t: object) => {
  const r = mergeJsonText(JSON.stringify(b), JSON.stringify(o), JSON.stringify(t));
  return r;
};

describe("json-merge.rules", () => {
  test("hai bên thêm key khác nhau ⇒ gộp, ours trước, theirs chèn sau key đứng trước", () => {
    const r = merge({ a: "1", z: "9" }, { a: "1", x: "X", z: "9" }, { a: "1", y: "Y", z: "9" });
    expect(r.conflicts).toEqual([]);
    expect(Object.keys(JSON.parse(r.text as string))).toEqual(["a", "x", "y", "z"]);
  });

  test("cùng thêm cuối file ⇒ ours rồi theirs", () => {
    const r = merge({ a: "1" }, { a: "1", x: "X" }, { a: "1", y: "Y" });
    expect(Object.keys(JSON.parse(r.text as string))).toEqual(["a", "x", "y"]);
  });

  test("cùng thêm một key với giá trị giống nhau ⇒ không conflict; khác nhau ⇒ conflict", () => {
    expect(merge({}, { k: "v" }, { k: "v" }).conflicts).toEqual([]);
    const r = merge({}, { k: "v1" }, { k: "v2" });
    expect(r.conflicts).toEqual(["k"]);
    expect(r.text).toBeNull();
  });

  test("một bên xoá, bên kia không đụng ⇒ xoá; xoá vs sửa ⇒ conflict", () => {
    const del = merge({ a: "1", b: "2" }, { a: "1" }, { a: "1", b: "2", c: "3" });
    expect(JSON.parse(del.text as string)).toEqual({ a: "1", c: "3" });
    const clash = merge({ a: "1", b: "2" }, { a: "1" }, { a: "1", b: "2x" });
    expect(clash.conflicts).toEqual(["b"]);
  });

  test("một bên sửa giá trị, bên kia thêm key ⇒ gộp cả hai", () => {
    const r = merge({ a: "1" }, { a: "1!" }, { a: "1", b: "2" });
    expect(JSON.parse(r.text as string)).toEqual({ a: "1!", b: "2" });
  });

  test("object lồng nhau gộp đệ quy; conflict báo path đầy đủ", () => {
    const base = { login: { title: "T" }, common: { ok: "OK" } };
    const ours = { login: { title: "T", a: "A" }, common: { ok: "OK" } };
    const theirs = { login: { title: "T", b: "B" }, common: { ok: "OK", c: "C" } };
    const r = merge(base, ours, theirs);
    expect(JSON.parse(r.text as string)).toEqual({
      login: { title: "T", a: "A", b: "B" },
      common: { ok: "OK", c: "C" },
    });
    const bad = merge({ x: { y: { z: "0" } } }, { x: { y: { z: "1" } } }, { x: { y: { z: "2" } } });
    expect(bad.conflicts).toEqual(["x.y.z"]);
  });

  test("hai bên cùng thêm object cùng tên (base không có) ⇒ gộp key bên trong", () => {
    const r = merge({}, { g: { a: "A" } }, { g: { b: "B" } });
    expect(JSON.parse(r.text as string)).toEqual({ g: { a: "A", b: "B" } });
  });

  test("mảng coi là nguyên khối", () => {
    expect(merge({ l: [1] }, { l: [1, 2] }, { l: [1] }).text).not.toBeNull();
    expect(merge({ l: [1] }, { l: [1, 2] }, { l: [1, 3] }).conflicts).toEqual(["l"]);
  });

  test("định dạng: 2 dấu cách, LF, newline cuối, giữ unicode", () => {
    const r = merge({ a: "Đăng nhập" }, { a: "Đăng nhập", b: "x" }, { a: "Đăng nhập" });
    expect(r.text).toBe('{\n  "a": "Đăng nhập",\n  "b": "x"\n}\n');
    expect(formatJson({})).toBe("{}\n");
  });

  test("base rỗng (add/add file) coi như {}; JSON hỏng ⇒ error, không throw", () => {
    const r = mergeJsonText("", '{"a":"1"}', '{"b":"2"}');
    expect(JSON.parse(r.text as string)).toEqual({ a: "1", b: "2" });
    const bad = mergeJsonText("{}", "{oops", "{}");
    expect(bad.text).toBeNull();
    expect(bad.error).toContain("JSON không hợp lệ");
  });

  test("mergeJson3 / mergeKeyOrder: key đứng trước bị ours xoá ⇒ key mới vẫn có mặt", () => {
    expect(mergeKeyOrder({ a: "1" }, {}, { a: "1", n: "N" })).toContain("n");
    expect(mergeJson3({ a: "1" }, {}, { a: "1", n: "N" }).value).toEqual({ n: "N" });
    expect(mergeJson3({ a: 1 }, { a: 1 }, { a: 1 }).conflicts).toEqual([]);
  });
});
