import { describe, expect, test } from "bun:test";
import type { StageDraft } from "./draft-types";
import { defaultReviewSlot, engineStepOf, normalizeSlotStages } from "./slot-canvas";
import { emptyStage } from "./stage-convert";

const tool = (key: string, step: number, p: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  name: key,
  executor: "tool",
  tool: { key: "contracts-route", args: {} },
  ...p,
  key: p.key ?? key,
  step,
});
const review = (i: number, name: string, slot: Record<string, unknown> = {}): StageDraft =>
  tool(`s${i}`, engineStepOf(i), {
    name,
    after: "review",
    slotRaw: { ...defaultReviewSlot(name), key: `lv${i}`, ...slot },
  });
const route = () => tool("route", 1);
const finalize = () =>
  tool("finalize", 3, { tool: { key: "contracts-finalize", args: {} }, key: "finalize" });
const base = () => [
  review(0, "A"),
  route(),
  review(1, "B", { when: { op: "and", conds: [] } }),
  finalize(),
];

describe("normalizeSlotStages", () => {
  test("giữ nguyên dạng s0 → route → s1 → finalize; đánh lại step; bước đầu không có điều kiện", () => {
    const out = normalizeSlotStages(base());
    expect(out.map((s) => [s.key, s.step])).toEqual([
      ["s0", 0],
      ["route", 1],
      ["s1", 2],
      ["finalize", 3],
    ]);
    expect(out[0]?.slotRaw?.when).toBeNull();
    expect(out[2]?.backTo).toEqual([0]);
  });
  test("sửa bước duyệt: tên stage ⇒ slot.name; trường khác của slot giữ", () => {
    const stages = base();
    stages[2] = {
      ...(stages[2] as StageDraft),
      name: "Duyệt cấp 2 mới",
      slotRaw: { ...(stages[2]?.slotRaw ?? {}), due_h: 24, department_group_key: "pb-a" },
    };
    const b = normalizeSlotStages(stages)[2];
    expect(b?.slotRaw).toMatchObject({
      name: "Duyệt cấp 2 mới",
      due_h: 24,
      department_group_key: "pb-a",
      key: "lv1",
    });
  });
  test("thêm stage mới (cuối mảng, sau finalize) ⇒ thành bước duyệt mặc định, route/finalize đúng chỗ", () => {
    const added = emptyStage(9);
    const stages = [...base(), { ...added, name: "Pháp chế" }];
    const out = normalizeSlotStages(stages);
    expect(out.map((s) => s.key)).toEqual(["s0", "route", "s1", "s2", "finalize"]);
    expect(out.at(-1)?.step).toBe(4);
    const n = out[3];
    expect(n).toMatchObject({ name: "Pháp chế", executor: "tool", after: "review" });
    expect(n?.slotRaw).toMatchObject({ kind: "review", name: "Pháp chế", due_h: 72 });
    expect(n?.tool.key).toBe("contracts-route");
  });
  test("xoá bước giữa ⇒ nén khoá/bước", () => {
    const stages = [review(0, "A"), route(), review(1, "B"), review(2, "C"), finalize()];
    const out = normalizeSlotStages([stages[0], stages[1], stages[3], stages[4]] as StageDraft[]);
    expect(out.map((s) => [s.key, s.step])).toEqual([
      ["s0", 0],
      ["route", 1],
      ["s1", 2],
      ["finalize", 3],
    ]);
    expect(out[2]?.name).toBe("C");
  });
  test("thiếu route/finalize hoặc không có bước người dùng ⇒ không đụng (Hub báo)", () => {
    const only = [review(0, "A")];
    expect(normalizeSlotStages(only)).toEqual(only);
  });
});

describe("repairSlot", () => {
  test("mã nằm ở *_group_id (seed 0069) ⇒ chuyển sang *_group_key; uuid ⇒ bỏ", async () => {
    const { repairSlot } = await import("./slot-canvas");
    expect(
      repairSlot({
        department_group_id: "contracts-editor",
        escalate_group_id: "9d1c2c9e-8f0a-4e3b-9c1d-2f7d7a1b2c3d",
        due_h: 72,
      }),
    ).toMatchObject({
      department_group_key: "contracts-editor",
      department_group_id: null,
      escalate_group_id: null,
      due_h: 72,
    });
    expect(repairSlot({ department_group_key: "a", department_group_id: null })).toMatchObject({
      department_group_key: "a",
    });
  });
});

describe("normalizeSlotStages · stage mới đã có slotRaw (gõ ở form bước)", () => {
  test("executor còn trống ⇒ khung tool route lấy từ bước mẫu, slot người dùng gõ giữ nguyên", () => {
    const fresh = {
      ...emptyStage(9),
      name: "Pháp chế",
      slotRaw: { ...defaultReviewSlot("Pháp chế"), department_group_key: "pb-pc" },
    };
    const out = normalizeSlotStages([review(0, "A"), route(), review(1, "B"), finalize(), fresh]);
    const n = out[3];
    expect(n).toMatchObject({ key: "s2", executor: "tool", after: "review" });
    expect(n?.tool.key).toBe("contracts-route");
    expect(n?.slotRaw).toMatchObject({ name: "Pháp chế", department_group_key: "pb-pc" });
  });
});
