import { describe, expect, test } from "bun:test";
import { decodeCursor, encodeCursor, type PageKey, paginate } from "./cursor";

const keys: PageKey[] = [
  [3, "c"],
  [2, "b"],
  [2, "a"],
  [1, "z"],
];

describe("CHAT-AC-19 · cursor mock chat", () => {
  test("mã hoá ↔ giải mã; chuỗi rác / sai dạng → null", () => {
    expect(decodeCursor(encodeCursor([5, "x"]))).toEqual([5, "x"]);
    for (const bad of ["rac-khong-hop-le", "", encodeCursor([1, "a"]).slice(1)]) {
      expect(decodeCursor(bad)).toBeNull();
    }
    const raw = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    for (const v of [[1], ["1", "a"], [1.5, "a"], [1, 2], { a: 1 }]) {
      expect(decodeCursor(raw(v))).toBeNull();
    }
  });

  test("desc limit=1 đi hết theo next: đủ, không lặp, hết thì null", () => {
    const seen: PageKey[] = [];
    let after: PageKey | undefined;
    for (let i = 0; i < 10; i++) {
      const p = paginate(keys, (k) => k, { after, limit: 1, dir: "desc" });
      seen.push(...p.items);
      if (p.next === null) break;
      after = decodeCursor(p.next) ?? undefined;
    }
    expect(seen).toEqual(keys);
  });

  test("asc: bỏ tới hết cursor, next null ở trang cuối", () => {
    const asc = [...keys].reverse();
    const p = paginate(asc, (k) => k, { after: [2, "a"], limit: 5, dir: "asc" });
    expect(p.items).toEqual([
      [2, "b"],
      [3, "c"],
    ]);
    expect(p.next).toBeNull();
  });
});
