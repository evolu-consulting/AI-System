// CR-123 · u8 · kéo mũi tên tới node đứng riêng: tự đặt thành bước mới ngay sau nguồn (không phải nghĩ tới "bước"), "Bắt đầu khi" nối được.
import { describe, expect, test } from "bun:test";
import { emptyStage } from "./def-form";
import {
  clearFree,
  connectToTrigger,
  isFree,
  markFree,
  placeAfter,
  placeAfterSource,
  safeDropStep,
} from "./free-nodes";

const st = (uid: string, step: number, o: Record<string, unknown> = {}) => ({
  ...emptyStage(step),
  uid,
  key: `k-${uid}`,
  name: uid,
  ...o,
});
const flow = [st("a", 0), st("b", 1), st("fin", 2, { outcome: "approved" })];

describe("placeAfter", () => {
  test("đặt node thành bước mới ngay sau bước nguồn, bước trống được nén lại", () => {
    expect(placeAfter(flow, "a", 1).map((s) => [s.uid, s.step])).toEqual([
      ["b", 0],
      ["a", 1],
      ["fin", 2],
    ]);
  });
});

describe("kéo tới node đứng riêng", () => {
  const withFree = markFree([...flow, st("n", 2)], ["n"]);
  test("node đứng riêng nằm chưa sau nguồn ⇒ thành bước mới ngay sau nguồn, nối xong hết đứng riêng", () => {
    const moved = placeAfterSource(withFree, "b", "n");
    expect(moved).not.toBeNull();
    const steps = Object.fromEntries((moved ?? []).map((s) => [s.uid, s.step]));
    expect(steps.n).toBe((steps.b as number) + 1);
    expect(steps.fin as number).toBeGreaterThan(steps.n as number);
    expect(clearFree(moved ?? [], "n").some(isFree)).toBe(false);
  });
  test("node KHÔNG đứng riêng ⇒ không tự dời (giữ luật chỉ nối tới bước sau)", () => {
    expect(placeAfterSource(flow, "b", "a")).toBeNull();
  });
});

describe("Bắt đầu khi", () => {
  test("tới node đứng riêng ⇒ thành bước đầu tiên và hết đứng riêng", () => {
    const r = connectToTrigger(markFree([...flow, st("n", 2)], ["n"]), "n");
    if ("error" in r) throw new Error("phải nối được");
    expect(r.stages.find((s) => s.uid === "n")?.step).toBe(0);
    expect(r.stages.some(isFree)).toBe(false);
  });
  test("tới bước đầu sẵn có ⇒ không đổi; tới bước khác ⇒ lỗi notFirst", () => {
    expect(connectToTrigger(flow, "a")).toMatchObject({ stages: expect.any(Array) });
    expect(connectToTrigger(flow, "b")).toEqual({ error: "notFirst" });
  });
});

describe("safeDropStep: thả không xen vào giữa cụm Ký số", () => {
  const esign = [
    st("a", 0),
    st("k1", 1, { node: "contracts.esign", executor: "tool" }),
    st("k2", 2, { node: "contracts.esign", executor: "wait_event" }),
    st("fin", 3, { outcome: "approved" }),
  ];
  test("cột của cụm ⇒ dời ra sau cụm, cột ngoài cụm giữ nguyên", () => {
    expect(safeDropStep(esign, 1)).toBe(3);
    expect(safeDropStep(esign, 2)).toBe(3);
    expect(safeDropStep(esign, 0)).toBe(0);
    expect(safeDropStep(esign, 3)).toBe(3);
    expect(safeDropStep(esign, 4)).toBe(4);
  });
});
