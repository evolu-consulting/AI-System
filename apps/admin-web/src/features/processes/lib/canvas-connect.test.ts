// CR-122 · p22 · luật kéo mũi tên: cổng ra → đúng trường; đích phải ở bước sau; Nếu không trỏ tới bước `real_action`.
import { describe, expect, test } from "bun:test";
import { type ConnectStage, connectPatch } from "./canvas-connect";

const st = (uid: string, step: number, o: Partial<ConnectStage> = {}): ConnectStage => ({
  uid,
  step,
  executor: "agent",
  real: false,
  ifx: { yes: null, no: null },
  ...o,
});
const flow = [
  st("a", 0),
  st("if", 1, { executor: "if" }),
  st("c", 2, { after: "review" }),
  st("d", 3, { real: true }),
  st("e", 4, { outcome: "approved" }),
];

describe("connectPatch", () => {
  test("Sai của Nếu ⇒ ifx.no (đếm từ 1), giữ nguyên Đúng", () => {
    const r = connectPatch(
      flow.map((s) => (s.uid === "if" ? { ...s, ifx: { yes: 3, no: null } } : s)),
      { source: "if", target: "c", sourceHandle: "no" },
    );
    expect(r).toEqual({ ok: true, index: 1, field: "no", patch: { ifx: { yes: 3, no: 3 } } });
  });
  test("Đúng của Nếu ⇒ ifx.yes", () => {
    const r = connectPatch(flow, { source: "if", target: "e", sourceHandle: "yes" });
    expect(r).toMatchObject({ ok: true, field: "yes", patch: { ifx: { yes: 5 } } });
  });
  test("Nếu không được trỏ tới bước có hành động thật", () => {
    expect(connectPatch(flow, { source: "if", target: "d", sourceHandle: "no" })).toMatchObject({
      ok: false,
      error: "ifReal",
    });
  });
  test("đích không ở bước sau ⇒ lỗi, không đổi gì", () => {
    expect(connectPatch(flow, { source: "c", target: "a", sourceHandle: null })).toMatchObject({
      ok: false,
      error: "notLater",
    });
    expect(connectPatch(flow, { source: "c", target: "c", sourceHandle: null })).toMatchObject({
      ok: false,
      error: "notLater",
    });
  });
  test("bước thường ⇒ nextStep; bước ngay sau ⇒ xoá (mặc định)", () => {
    expect(connectPatch(flow, { source: "a", target: "c" })).toEqual({
      ok: true,
      index: 0,
      field: "next",
      patch: { nextStep: 2 },
    });
    expect(connectPatch(flow, { source: "c", target: "d" })).toMatchObject({
      patch: { nextStep: undefined },
    });
  });
  test("nút kết thúc không có bước đi tiếp; Nếu thả ngoài cổng Đúng/Sai bị từ chối; cổng Từ chối để nơi khác xử lý", () => {
    expect(connectPatch(flow, { source: "e", target: "a" })).toMatchObject({ error: "noNext" }); // u14: Kết thúc không bao giờ là nguồn
    const fin = [st("f", 0, { outcome: "approved" }), st("g", 1)];
    expect(connectPatch(fin, { source: "f", target: "g" })).toMatchObject({ error: "noNext" });
    expect(connectPatch(flow, { source: "if", target: "c", sourceHandle: null })).toMatchObject({
      error: "noPort",
    });
    expect(connectPatch(flow, { source: "c", target: "d", sourceHandle: "back" })).toBeNull();
  });
});
