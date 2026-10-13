// HUB-FR-128 · currentAutofix: chỉ trả kết quả khi round khớp vòng của stage.
import { describe, expect, test } from "bun:test";
import { currentAutofix } from "./autofix-view";

const af = (round: number) => ({ round }) as never;
const st = (idx: number, round: number, autofix?: unknown) => ({ idx, round, autofix }) as never;

describe("currentAutofix", () => {
  test("khớp vòng ⇒ trả autofix", () => {
    const a = af(2);
    expect(currentAutofix([st(0, 2, a)], 0)).toBe(a);
  });
  test("lệch vòng ⇒ undefined", () => {
    expect(currentAutofix([st(0, 3, af(2))], 0)).toBeUndefined();
  });
  test("không có autofix / không có stage ⇒ undefined", () => {
    expect(currentAutofix([st(0, 1)], 0)).toBeUndefined();
    expect(currentAutofix([st(0, 1, af(1))], 5)).toBeUndefined();
  });
});
