// HUB-FR-104 · P-b2 (plan-frontend FB8): ánh xạ phím trên node stage.
import { describe, expect, test } from "bun:test";
import { type KeyLike, stageKeyAction } from "./canvas-keys";

const k = (key: string, o: Partial<KeyLike> = {}): KeyLike => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...o,
});

describe("stageKeyAction", () => {
  test("Alt+mũi tên ⇒ đổi bước / thứ tự", () => {
    expect(stageKeyAction(k("ArrowLeft", { altKey: true }))).toBe("prevStep");
    expect(stageKeyAction(k("ArrowRight", { altKey: true }))).toBe("nextStep");
    expect(stageKeyAction(k("ArrowUp", { altKey: true }))).toBe("up");
    expect(stageKeyAction(k("ArrowDown", { altKey: true }))).toBe("down");
  });
  test("Enter mở, Delete xoá; có phím bổ trợ khác ⇒ bỏ qua", () => {
    expect(stageKeyAction(k("Enter"))).toBe("open");
    expect(stageKeyAction(k("Delete"))).toBe("remove");
    expect(stageKeyAction(k("Delete", { ctrlKey: true }))).toBeNull();
    expect(stageKeyAction(k("ArrowRight"))).toBeNull();
    expect(stageKeyAction(k("ArrowRight", { altKey: true, shiftKey: true }))).toBeNull();
  });
});
