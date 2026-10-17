// T3a · test-plan P-d §7 (CONVENTIONS §10): tự kiểm helper nạp module — module vắng phải BÁO RÕ (không `{}` lặng lẽ),
// module có thật trả export bình thường, `loadAnyOf` gộp module có thật và ném khi không module nào có.
import { describe, expect, it } from "bun:test";
import { absentModule, loadAnyOf, loadDomain, PROC, tryLoad } from "../_support/modules";

const NONE = `${PROC}/domain/__khong-co__.rules.ts`;
const REAL = `${PROC}/core/process-state.rules.ts`; // P-a, có sẵn tới T7s (dời) — dùng làm module có thật
const STEP = `${PROC}/core/step.rules.ts`;

describe("T3a · tryLoad báo rõ khi module vắng [test-plan §7]", () => {
  it("T3a · tryLoad đường dẫn vắng ⇒ truy cập export ném 'module vắng: <rel>'; await được (then = undefined)", async () => {
    const m = await tryLoad(NONE);
    expect(() => m.classifyJobError).toThrow(`module vắng: ${NONE}`);
    expect(m.then).toBeUndefined();
  });
  it("T3a · loadDomain đường dẫn vắng ⇒ thông điệp chứa đúng đường dẫn lớp 1", async () => {
    const m = await loadDomain("__khong-co__.rules.ts");
    expect(() => m.x).toThrow(`module vắng: ${PROC}/domain/__khong-co__.rules.ts`);
  });
  it("T3a · absentModule: Symbol không ném (in ấn/so khớp được), thuộc tính thường ném", () => {
    const m = absentModule("a/b.ts");
    expect(Reflect.get(m, Symbol.iterator)).toBeUndefined();
    expect(() => m.foo).toThrow("module vắng: a/b.ts");
  });
  it("T3a · module có thật (hiện có ở core/ hoặc đã dời) ⇒ export bình thường", async () => {
    const m = await loadAnyOf([`${PROC}/domain/runs/run-state.rules.ts`, REAL]);
    expect(typeof m.transition).toBe("function");
  });
  it("T3a · loadAnyOf gộp module có thật, đầu danh sách thắng; module vắng bị bỏ qua", async () => {
    const m = await loadAnyOf([NONE, `${PROC}/domain/runs/step.rules.ts`, STEP]);
    expect(typeof m.runStatusOf).toBe("function");
  });
  it("T3a · loadAnyOf không module nào có ⇒ ném 'module vắng: a | b'", async () => {
    await expect(loadAnyOf([NONE, `${NONE}.x`])).rejects.toThrow(
      `module vắng: ${NONE} | ${NONE}.x`,
    );
  });
});
