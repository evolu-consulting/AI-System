// CR-123 · p25 · FLOW3-FR-04..07 · xoá có nối liền, đặt lại cạnh, dán (tên/mã mới, hợp lệ), kéo nhóm, thả vào cột, luật nối lại (dùng chung canvas-connect).
import { afterEach, describe, expect, test } from "bun:test";
import { connectPatch } from "./canvas-connect";
import { moveGroup, pasteStages, placeFresh, removeStages, resetEdge } from "./canvas-edit";
import { emptyStage, type StageDraft } from "./def-form";
import { setStagesMax } from "./stages-limit";

const st = (uid: string, step: number, o: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  uid,
  key: uid,
  name: uid.toUpperCase(),
  ...o,
});
const ifx = (yes: number | null, no: number | null) => ({ op: "and" as const, conds: [], yes, no });
const ok = (r: { stages?: StageDraft[]; error?: string }): StageDraft[] => {
  if (!r.stages) throw new Error(String(r.error));
  return r.stages;
};
const at = (xs: StageDraft[], uid: string) => xs.find((s) => s.uid === uid) as StageDraft;

afterEach(() => setStagesMax(22));

describe("removeStages · nối liền", () => {
  test("A→B→C xoá B ⇒ C dồn lên sát A, đích 'đi tiếp' vào B chuyển sang C", () => {
    const flow = [st("a", 0, { nextStep: 1 }), st("b", 1), st("c", 2)];
    const out = ok(removeStages(flow, ["b"]));
    expect(out.map((s) => [s.uid, s.step])).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
    expect(at(out, "a").nextStep).toBe(1); // vẫn tới C (nay là bước 1)
  });

  test("Nếu có Đúng → B ⇒ sau khi xoá B, Đúng → C", () => {
    const flow = [st("i", 0, { executor: "if", ifx: ifx(2, null) }), st("b", 1), st("c", 2)];
    const out = ok(removeStages(flow, ["b"]));
    expect(at(out, "i").ifx.yes).toBe(2); // đếm từ 1 ⇒ bước 1 = C
  });

  test("nối liền sang bước thật mà nhánh Nếu đang trỏ tới ⇒ từ chối, không đổi gì", () => {
    const flow = [
      st("i", 0, { executor: "if", ifx: ifx(2, null) }),
      st("b", 1),
      st("c", 2, { real: true }),
    ];
    expect(removeStages(flow, ["b"])).toEqual({ error: "ifReal" });
  });

  test("bước cuối cùng không xoá được", () => {
    expect(removeStages([st("a", 0)], ["a"])).toEqual({ error: "last" });
  });

  test("xoá một trong hai bước song song ⇒ cột giữ nguyên số bước", () => {
    const flow = [st("a", 0), st("b", 1), st("c", 1), st("d", 2)];
    const out = ok(removeStages(flow, ["c"]));
    expect(out.map((s) => [s.uid, s.step])).toEqual([
      ["a", 0],
      ["b", 1],
      ["d", 2],
    ]);
  });
});

describe("resetEdge · xoá cạnh = về mặc định", () => {
  test("Sai → null (bước kế), Đúng → bước kế nếu có", () => {
    const flow = [st("i", 0, { executor: "if", ifx: ifx(3, 3) }), st("b", 1), st("c", 2)];
    expect(at(ok(resetEdge(flow, { source: "i", side: "no" })), "i").ifx.no).toBeNull();
    expect(at(ok(resetEdge(flow, { source: "i", side: "yes" })), "i").ifx.yes).toBe(2);
  });
  test("cạnh thường: bỏ nextStep; đã mặc định ⇒ báo 'already'", () => {
    const flow = [st("a", 0, { nextStep: 2 }), st("b", 1), st("c", 2)];
    expect(at(ok(resetEdge(flow, { source: "a" })), "a").nextStep).toBeUndefined();
    expect(resetEdge([st("a", 0), st("b", 1)], { source: "a" })).toEqual({ error: "already" });
  });
});

describe("pasteStages · Ctrl+V", () => {
  const flow = [
    st("a", 0),
    st("i", 1, { executor: "if", ifx: ifx(4, null) }),
    st("b", 2),
    st("c", 3),
  ];

  test("bản sao đặt ngay sau bước chọn, tên + mã mới, cạnh giữa các bản sao nối với nhau", () => {
    const r = pasteStages(flow, [at(flow, "i"), at(flow, "c")], 3, " (bản sao)");
    if (!("stages" in r)) throw new Error("lỗi");
    const out = r.stages;
    expect(out).toHaveLength(6);
    const copies = out.filter((s) => r.uids?.includes(s.uid));
    expect(copies.map((s) => s.name)).toEqual(["I (bản sao)", "C (bản sao)"]);
    expect(new Set(out.map((s) => s.key)).size).toBe(6);
    expect(new Set(out.map((s) => s.uid)).size).toBe(6);
    const ci = copies[0] as StageDraft;
    const cc = copies[1] as StageDraft;
    expect(ci.step).toBeGreaterThan(at(out, "c").step); // sau bước chọn
    expect(cc.step).toBeGreaterThan(ci.step); // giữ thứ tự tương đối
    expect(ci.ifx.yes).toBe(cc.step + 1); // Đúng của bản sao Nếu ⇒ bản sao của C (đếm từ 1)
    expect(at(out, "i").ifx.yes).toBe(4); // bản gốc giữ nguyên
  });

  test("vượt giới hạn bước ⇒ từ chối bằng câu cũ, không đổi gì", () => {
    setStagesMax(5);
    expect(pasteStages(flow, [at(flow, "a"), at(flow, "b")], 3, "")).toEqual({
      error: "process.admin.canvas.err.stagesMax",
    });
  });

  test("bước hệ thống không được chép", () => {
    expect(pasteStages(flow, [], 0, "")).toEqual({ error: "empty" });
  });
});

describe("moveGroup · kéo nhóm", () => {
  test("dời cả nhóm cùng số cột, giữ thứ tự, cột bỏ trống bị nén", () => {
    const flow = [st("a", 0), st("b", 1), st("c", 2), st("d", 3)];
    const out = ok(moveGroup(flow, ["a", "b"], 1) as { stages: StageDraft[] });
    // a→1, b→2 (chung cột với c), cột 0 trống bị nén ⇒ a0 · b,c ở 1 · d2
    expect(out.map((s) => [s.uid, s.step])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 1],
      ["d", 2],
    ]);
  });
  test("cột đích đã đủ 3 ⇒ lỗi stepFull", () => {
    const flow = [st("a", 0), st("b", 1), st("c", 1), st("d", 1)];
    expect(moveGroup(flow, ["a"], 1)).toMatchObject({ error: "process.admin.canvas.err.stepFull" });
  });
});

describe("placeFresh · thả từ bảng mẫu", () => {
  const flow = [st("a", 0), st("b", 1)];
  test("thả vào cột có sẵn ⇒ nằm cuối cột, lưu y điểm thả", () => {
    const out = ok(
      placeFresh(flow, [st("n", 99, { name: "Mới" })], 1, 300) as { stages: StageDraft[] },
    );
    expect(at(out, "n").step).toBe(1);
    expect(at(out, "n").uiY).toBe(300);
    expect(out.map((s) => s.uid)).toEqual(["a", "b", "n"]);
  });
  test("thả ra ngoài cột cuối ⇒ bước mới ở cuối", () => {
    const out = ok(placeFresh(flow, [st("n", 99)], 5, undefined) as { stages: StageDraft[] });
    expect(at(out, "n").step).toBe(2);
  });
  test("đủ giới hạn bước ⇒ báo, không đổi gì", () => {
    setStagesMax(2);
    expect(placeFresh(flow, [st("n", 99)], 0, undefined)).toMatchObject({
      error: "process.admin.canvas.err.stagesMax",
    });
  });
});

describe("nối lại cạnh dùng cùng luật với kéo cổng (canvas-connect)", () => {
  const flow = [
    { uid: "a", step: 0, executor: "agent", real: false, ifx: { yes: null, no: null } },
    { uid: "i", step: 1, executor: "if", real: false, ifx: { yes: null, no: null } },
    { uid: "b", step: 2, executor: "agent", real: false, ifx: { yes: null, no: null } },
    { uid: "r", step: 3, executor: "agent", real: true, ifx: { yes: null, no: null } },
  ];
  test("nối lại nhánh Đúng: bước sau hợp lệ, bước thật ⇒ ifReal, bước trước ⇒ notLater", () => {
    expect(connectPatch(flow, { source: "i", target: "b", sourceHandle: "yes" })).toMatchObject({
      ok: true,
    });
    expect(connectPatch(flow, { source: "i", target: "r", sourceHandle: "yes" })).toMatchObject({
      ok: false,
      error: "ifReal",
    });
    expect(connectPatch(flow, { source: "i", target: "a", sourceHandle: "yes" })).toMatchObject({
      ok: false,
      error: "notLater",
    });
  });
});
