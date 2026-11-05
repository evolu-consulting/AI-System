import { describe, expect, test } from "bun:test";
import { slotActive } from "./routing-active.rules";

describe("slotActive", () => {
  test("khe thường luôn bật", () => expect(slotActive(false, 0, 0)).toBe(true));
  test("opt-in chưa luật chưa gán ⇒ tắt", () => expect(slotActive(true, 0, 0)).toBe(false));
  test("opt-in có gán ⇒ bật", () => expect(slotActive(true, 0, 1)).toBe(true));
  test("opt-in có luật ⇒ bật", () => expect(slotActive(true, 1, 0)).toBe(true));
});
