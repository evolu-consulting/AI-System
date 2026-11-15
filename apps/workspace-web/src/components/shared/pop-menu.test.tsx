// CR-162: vạch ngăn trong PopMenu — mục đầu không có vạch dù là danger/divider.
import { describe, expect, test } from "bun:test";
import { showDivider } from "./pop-menu";

describe("showDivider", () => {
  test("menu chỉ một mục danger ⇒ không vạch", () => {
    expect(showDivider([{ danger: true }], 0)).toBe(false);
  });
  test("mục divider đứng đầu ⇒ không vạch; đứng sau ⇒ có vạch", () => {
    expect(showDivider([{ divider: true }, {}], 0)).toBe(false);
    expect(showDivider([{}, { divider: true }], 1)).toBe(true);
  });
  test("danger sau mục thường ⇒ có vạch; mục thường ⇒ không", () => {
    expect(showDivider([{}, { danger: true }], 1)).toBe(true);
    expect(showDivider([{}, {}], 1)).toBe(false);
  });
  test("chỉ số ngoài phạm vi ⇒ false", () => {
    expect(showDivider([], 0)).toBe(false);
  });
});
