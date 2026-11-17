import { describe, expect, test } from "bun:test";
import { isInsideStage } from "./stage-target";

describe("CR-181 · isInsideStage", () => {
  const inside = {};
  const portal = {};
  const stage = { contains: (n: unknown) => n === inside };
  test("đích trong sân khấu ⇒ xử lý", () => expect(isInsideStage(stage, inside)).toBe(true));
  test("đích là mục menu trong portal ⇒ bỏ qua (không đóng menu)", () =>
    expect(isInsideStage(stage, portal)).toBe(false));
  test("chưa có sân khấu ⇒ bỏ qua", () => expect(isInsideStage(null, inside)).toBe(false));
});
