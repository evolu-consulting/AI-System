// CR-120 · unit: công tắc "Duyệt theo quy trình" (feature contracts-approval-engine) chuyển từ "Tính năng thêm" sang khối Quy trình.
import { describe, expect, test } from "bun:test";
import { addonsWithoutEngine, ENGINE_KEY, engineOf } from "./engine-toggle";

const A = [{ key: "contracts-cks" }, { key: ENGINE_KEY }, { key: "contracts-esign" }];

describe("engineOf", () => {
  test("thẻ có feature ⇒ công tắc theo bản nháp, khoá theo `locked`, đổi qua onSet", () => {
    const calls: boolean[] = [];
    const e = engineOf(A, new Set([ENGINE_KEY]), true, (on) => calls.push(on));
    expect(e).toMatchObject({ on: true, disabled: true });
    e?.onChange(false);
    expect(calls).toEqual([false]);
    expect(engineOf(A, new Set(), false, () => {})).toMatchObject({ on: false, disabled: false });
  });
  test("thẻ không có feature ⇒ null (giữ như cũ)", () => {
    expect(engineOf([{ key: "contracts-cks" }], new Set(), false, () => {})).toBeNull();
  });
});

describe("addonsWithoutEngine", () => {
  test("bỏ đúng feature engine, giữ thứ tự các feature khác", () => {
    expect(addonsWithoutEngine(A).map((f) => f.key)).toEqual(["contracts-cks", "contracts-esign"]);
  });
});
