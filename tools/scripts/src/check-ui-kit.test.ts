// CR-177 U4 · hàm đếm của check:ui-kit.
import { describe, expect, test } from "bun:test";
import { compare, emptyCounts, findHits } from "./check-ui-kit.rules";

const n = (src: string, m: string) => findHits(src).filter((h) => h.metric === m).length;

describe("findHits", () => {
  test("đếm button/select trần, không đếm component viết hoa", () => {
    const s = `<button onClick={a}>x</button><Button>y</Button><select><option/></select>`;
    expect(n(s, "button")).toBe(1);
    expect(n(s, "select")).toBe(1);
  });
  test("input trần trừ hidden/file/checkbox/radio", () => {
    const s = `<input />\n<input type="hidden" />\n<input type="file"/><input type="checkbox" checked={a => a} /><input type="radio"/><input type="text"/><Input />`;
    expect(n(s, "input")).toBe(2);
  });
  test("title= chỉ trên thẻ HTML thường", () => {
    const s = `<button title="Xoá">x</button><Dialog title="Hợp đồng" /><span title={t("a")}>y</span>\nconst o = { title: "a" }`;
    expect(n(s, "title")).toBe(2);
  });
  test("cỡ chữ/bo góc tuỳ ý, không đếm lớp chuẩn hay màu", () => {
    const s = `<p className="text-[13px] rounded-[9px] rounded-t-[4px] text-sm rounded-md text-[#fff] text-[var(--x)]">`;
    expect(n(s, "arbitrary")).toBe(3);
  });
  test("ghi đúng số dòng", () => {
    expect(findHits("a\nb\n<button>").map((h) => h.line)).toEqual([3]);
  });
});

describe("compare", () => {
  test("vượt mốc / thấp hơn mốc", () => {
    const base = { ...emptyCounts(), button: 5, input: 2 };
    const cur = { ...emptyCounts(), button: 6, input: 1 };
    expect(compare(cur, base)).toEqual({ over: ["button"], under: ["input"] });
  });
  test("app chưa có mốc coi như 0", () => {
    expect(compare({ ...emptyCounts(), select: 1 }, undefined).over).toEqual(["select"]);
  });
});
