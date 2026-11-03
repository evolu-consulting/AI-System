import { describe, expect, test } from "bun:test";
import {
  canBuild,
  missingNames,
  POOL_DEFAULT_SIZE,
  parsePoolSize,
  pickReady,
} from "./slice.pool.rules";

describe("slice:pool · luật thuần", () => {
  test("parsePoolSize: mặc định 3, --size N / --size=N, sai ⇒ lỗi", () => {
    expect(parsePoolSize([])).toEqual({ size: POOL_DEFAULT_SIZE });
    expect(parsePoolSize(["", "--size", "5"])).toEqual({ size: 5 });
    expect(parsePoolSize(["--size=2"])).toEqual({ size: 2 });
    for (const bad of [["--size"], ["--size", "0"], ["--size", "x"], ["--size=9"], ["--size=1.5"]])
      expect("error" in parsePoolSize(bad)).toBe(true);
  });

  test("pickReady: chỉ mục đã .ready + đã đăng ký; số nhỏ nhất (so số, không so chuỗi)", () => {
    const names = ["10", "2", "3", "x", "4"];
    expect(pickReady(names, new Set(["10", "2", "3", "x"]), new Set(["10", "3", "x", "4"]))).toBe(
      "3",
    );
    expect(pickReady(names, new Set(["10", "2"]), new Set(["10", "2"]))).toBe("2");
    expect(pickReady(names, new Set(["10"]), new Set(["10"]))).toBe("10");
    expect(pickReady(names, new Set(), new Set(names))).toBeUndefined(); // chưa .ready (đang dựng)
    expect(pickReady(names, new Set(["2"]), new Set())).toBeUndefined(); // đã bị git gỡ
    expect(pickReady([], new Set(), new Set())).toBeUndefined();
  });

  test("missingNames: bù đúng số còn thiếu bằng số nguyên dương nhỏ nhất chưa dùng", () => {
    expect(missingNames(3, [])).toEqual(["1", "2", "3"]);
    expect(missingNames(3, ["1", "2", "3"])).toEqual([]);
    expect(missingNames(3, ["2"])).toEqual(["1", "3"]); // lấy mất 1 ⇒ dựng lại 1
    expect(missingNames(2, ["1", "2", "3"])).toEqual([]); // thừa: không dựng, không xoá
    expect(missingNames(3, ["1", "abc"])).toEqual(["2", "3"]); // tên lạ không tính
  });

  test("canBuild: đĩa < 30 GB hoặc không đo được ⇒ không dựng", () => {
    expect(canBuild(30)).toEqual({ ok: true });
    expect(canBuild(120)).toEqual({ ok: true });
    expect(canBuild(29.9)).toMatchObject({ ok: false });
    expect(canBuild(undefined)).toMatchObject({ ok: false });
  });
});
