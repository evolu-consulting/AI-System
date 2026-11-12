import { describe, expect, test } from "bun:test";
import { blockedReasons } from "./blocked-reasons";

const t = (k: string) => `T:${k}`;
describe("blockedReasons", () => {
  test("dịch, bỏ trùng, tối đa 3 câu", () => {
    const r = blockedReasons({ a: "k1", b: "k1", c: "k2", d: "k3", e: "k4" }, t);
    expect(r).toEqual(["T:k1", "T:k2", "T:k3"]);
  });
  test("không lỗi ⇒ rỗng", () => expect(blockedReasons({}, t)).toEqual([]));
});
