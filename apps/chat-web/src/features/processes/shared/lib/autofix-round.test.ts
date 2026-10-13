// HUB-FR-128 · stageAutofix: tìm theo idx từ view đầy đủ hoặc view task; current chỉ khi khớp vòng.
import { describe, expect, test } from "bun:test";
import { stageAutofix } from "./autofix-view";

const af = (round: number) => ({ round }) as never;
const view = (stages: unknown[]) => ({ stages }) as never;
const st = (idx: number, round: number, autofix?: unknown) => ({ idx, round, autofix });

describe("stageAutofix", () => {
  test("khớp vòng ⇒ current = autofix", () => {
    const a = af(2);
    const r = stageAutofix(view([st(0, 2, a)]), undefined, 0);
    expect(r.autofix).toBe(a);
    expect(r.current).toBe(a);
  });
  test("lệch vòng ⇒ có autofix nhưng current undefined", () => {
    const a = af(1);
    const r = stageAutofix(view([st(0, 2, a)]), undefined, 0);
    expect(r.autofix).toBe(a);
    expect(r.current).toBeUndefined();
  });
  test("không có stage ⇒ cả hai undefined", () => {
    const r = stageAutofix(view([st(0, 1, af(1))]), undefined, 9);
    expect(r.autofix).toBeUndefined();
    expect(r.current).toBeUndefined();
  });
  test("view task (view full undefined) ⇒ dùng taskView", () => {
    const a = af(3);
    const r = stageAutofix(undefined, view([st(1, 3, a)]), 1);
    expect(r.current).toBe(a);
  });
});
