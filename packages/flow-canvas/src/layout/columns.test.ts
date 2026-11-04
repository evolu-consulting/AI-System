// HUB-FR-104 · P-b2 (plan-frontend FB4/FB9): bố cục cột theo bước + cạnh tiến/quay lại + thả theo x.
import { describe, expect, test } from "bun:test";
import {
  COL_W,
  HEADER_H,
  headerId,
  joinId,
  layoutSteps,
  ROW_H,
  revealDx,
  stepFromDropX,
} from "./columns";

const st = (uid: string, step: number, backTo: number[] = []) => ({
  uid,
  step,
  backTo,
  after: backTo.length ? ("review" as const) : ("auto" as const),
});

describe("layoutSteps", () => {
  const l = layoutSteps([st("a", 0), st("b", 1), st("c", 1), st("d", 2, [1])]);
  const at = (id: string) => l.nodes.find((n) => n.id === id);
  test("cột x = step × COL_W; header mỗi bước; số bước", () => {
    expect(l.steps).toBe(3);
    expect(at("c")).toMatchObject({ x: COL_W, y: HEADER_H + ROW_H });
    expect(at(headerId(2))).toMatchObject({ kind: "stepHeader", x: 2 * COL_W, y: 0, full: false });
  });
  test("cột thấp căn giữa theo cột cao nhất", () => {
    expect(at("a")?.y).toBe(HEADER_H + ROW_H / 2);
  });
  test("join chỉ giữa cột đông và cột kế", () => {
    expect(at(joinId(1))).toMatchObject({ kind: "join", count: 2 });
    expect(at(joinId(0))).toBeUndefined();
    expect(at(joinId(2))).toBeUndefined();
  });
  test("cạnh tiến qua join; cạnh quay lại tới header bước đích", () => {
    const ids = l.edges.map((e) => `${e.kind}:${e.source}>${e.target}`);
    expect(ids).toContain("forward:a>b");
    expect(ids).toContain("forward:a>c");
    expect(ids).toContain("forward:b>j1");
    expect(ids).toContain("forward:j1>d");
    expect(ids).toContain("back:d>h1");
  });
  test("rỗng ⇒ không node; đích quay lại không hợp lệ bị bỏ", () => {
    expect(layoutSteps([])).toEqual({ nodes: [], edges: [], steps: 0 });
    expect(layoutSteps([st("a", 0, [0, 5])]).edges.filter((e) => e.kind === "back")).toEqual([]);
  });
  test("bước đủ 3 ⇒ header full", () => {
    const f = layoutSteps([st("a", 0), st("b", 0), st("c", 0)]);
    expect(f.nodes.find((n) => n.id === "h0")).toMatchObject({ full: true });
  });
});

describe("stepFromDropX", () => {
  test("stepFromDropX: cột gần nhất, vượt cuối ⇒ bước mới, revealDx", () => {
    expect(revealDx(100, 340, 1000, 460)).toBe(0);
    expect(stepFromDropX(COL_W * 1.4, 3)).toBe(1);
    expect(stepFromDropX(COL_W * 1.6, 3)).toBe(2);
    expect(stepFromDropX(-500, 3)).toBe(0);
    expect(stepFromDropX(COL_W * 9, 3)).toBe(3);
  });
});

describe("fnr-canvas · làn nhánh If", () => {
  const s = (uid: string, step: number, extra: Record<string, unknown> = {}) => ({
    uid,
    step,
    backTo: [],
    after: "auto" as const,
    ...extra,
  });
  const yOf = (l: ReturnType<typeof layoutSteps>, id: string) =>
    (l.nodes.find((n) => n.id === id) as { y: number }).y;
  // a(0) → if(1) ─Đúng→ t(2) ─┐
  //                 └Sai→ e(3) ←┘ (hai nhánh nhập lại ở bước 3)
  const stages = [s("a", 0), s("i", 1, { ifs: { yes: 2, no: 3 } }), s("t", 2), s("e", 3)];
  const l = layoutSteps(stages);

  test("bước chỉ qua Đúng lên làn trên; Sai/bước chung ở làn chính; x vẫn theo bước", () => {
    expect(yOf(l, "t")).toBeLessThan(yOf(l, "i"));
    expect(yOf(l, "i")).toBe(yOf(l, "a"));
    expect(yOf(l, "e")).toBe(yOf(l, "i")); // nhập lại ở làn chính
    expect(l.nodes.find((n) => n.id === "t")).toMatchObject({ x: 2 * COL_W });
    expect(yOf(l, "t")).toBe(HEADER_H); // làn trên là làn đầu, ngay dưới tiêu đề
  });
  test("Đúng đi thẳng tới đích xa hơn ⇒ bước chỉ qua Sai xuống làn dưới (làn chính không bị cạnh chéo)", () => {
    const l2 = layoutSteps([s("a", 0, { ifs: { yes: 2, no: 1 } }), s("n", 1), s("y", 2)]);
    expect(yOf(l2, "n")).toBeGreaterThan(yOf(l2, "a"));
    expect(yOf(l2, "y")).toBe(yOf(l2, "a"));
  });
  test("không If / Đúng = Sai ⇒ một làn (như cũ)", () => {
    const l3 = layoutSteps([s("a", 0, { ifs: { yes: 1, no: 1 } }), s("b", 1)]);
    expect(yOf(l3, "a")).toBe(yOf(l3, "b"));
  });
  test("giai đoạn song song xếp dọc gọn trong làn, không đè làn khác", () => {
    const l4 = layoutSteps([
      s("a", 0),
      s("i", 1, { ifs: { yes: 2, no: 3 } }),
      s("t1", 2),
      s("t2", 2),
      s("t3", 2),
      s("e", 3),
    ]);
    const ys = ["t1", "t2", "t3"].map((id) => yOf(l4, id));
    expect(ys).toEqual([HEADER_H, HEADER_H + ROW_H, HEADER_H + 2 * ROW_H]);
    expect(yOf(l4, "i")).toBeGreaterThanOrEqual(HEADER_H + 3 * ROW_H); // làn chính nằm dưới cả chồng 3
  });
  test("y đã lưu thắng toạ độ tự động (chỉ node có y); join theo y thực", () => {
    const l5 = layoutSteps([s("a", 0, { y: 777 }), s("b", 1), s("c", 1)]);
    expect(yOf(l5, "a")).toBe(777);
    expect(yOf(l5, "b")).toBe(HEADER_H);
    const l6 = layoutSteps([s("b", 0, { y: 500 }), s("c", 0, { y: 600 }), s("d", 1)]);
    expect(yOf(l6, "j0")).toBe(550 + (104 - 28) / 2);
  });
  test("cạnh Đúng/Sai vẫn đúng hai cạnh; cạnh tiến từ cột trên nhập lại bước chung", () => {
    const ids = l.edges.map((e) => `${e.kind}:${e.source}>${e.target}`);
    expect(ids).toContain("branch:i>t");
    expect(ids).toContain("branch:i>e");
    expect(ids).toContain("forward:t>e");
  });
});

test("node If: đúng hai cạnh Đúng/Sai tới giai đoạn đầu bước đích, không cạnh tiến, không tới tiêu đề", () => {
  const st = (uid: string, step: number, ifs?: { yes: number | null; no: number | null }) => ({
    uid,
    step,
    backTo: [],
    after: "auto" as const,
    ...(ifs ? { ifs } : {}),
  });
  const l2 = layoutSteps([st("a", 0), st("i", 1, { yes: 2, no: 3 }), st("t", 2), st("e", 3)]);
  const fromIf = l2.edges.filter((x) => x.source === "i");
  expect(fromIf.map((x) => [x.target, x.side, x.kind])).toEqual([
    ["t", "yes", "branch"],
    ["e", "no", "branch"],
  ]);
  // Sai vắng (null) ⇒ bước kế; đích ngoài phạm vi ⇒ bỏ cạnh.
  const l3 = layoutSteps([st("a", 0), st("i", 1, { yes: 9, no: null }), st("n", 2)]);
  expect(l3.edges.filter((x) => x.source === "i").map((x) => [x.target, x.side])).toEqual([
    ["n", "no"],
  ]);
});

test("revealDx: node dưới ngăn phải thì pan vào; đã thấy thì 0; lệch trái thì kéo về lề", () => {
  expect(revealDx(100, 340, 1000, 460)).toBe(0); // vùng thấy: [16, 524]
  expect(revealDx(400, 640, 1000, 460)).toBe(-116); // right 640 > 524
  expect(revealDx(-50, 190, 1000, 460)).toBe(66);
  expect(revealDx(900, 1140, 1000, 0)).toBe(-156);
});

describe("snapshot bố cục cột", () => {
  const s = (uid: string, step: number, extra: Record<string, unknown> = {}) => ({
    uid,
    step,
    backTo: [] as number[],
    after: "auto" as const,
    ...extra,
  });
  // Giá trị lấy từ bản `canvas-layout.ts` của admin-web trước khi gộp gói (cùng fixture) ⇒ toạ độ không đổi một điểm.
  test("snapshot bố cục cột: toạ độ node và cạnh giữ nguyên (song song, quay lại, If)", () => {
    const l = layoutSteps([
      s("a", 0),
      s("i", 1, { ifs: { yes: 2, no: 3 } }),
      s("t1", 2),
      s("t2", 2),
      s("e", 3),
      s("r", 4, { backTo: [0], after: "review" as const }),
      s("b", 5, { branch: [1, null] }),
    ]);
    expect({
      steps: l.steps,
      nodes: l.nodes.map((n) => [n.id, n.kind, n.x, n.y]),
      edges: l.edges.map((e) => [e.id, e.kind, e.rule ?? null, e.side ?? null]),
    }).toEqual({
      steps: 6,
      nodes: [
        ["h0", "stepHeader", 0, 0],
        ["a", "stage", 0, 296],
        ["h1", "stepHeader", 320, 0],
        ["i", "stage", 320, 296],
        ["h2", "stepHeader", 640, 0],
        ["t1", "stage", 640, 56],
        ["t2", "stage", 640, 176],
        ["j2", "join", 872, 154],
        ["h3", "stepHeader", 960, 0],
        ["e", "stage", 960, 296],
        ["h4", "stepHeader", 1280, 0],
        ["r", "stage", 1280, 296],
        ["h5", "stepHeader", 1600, 0],
        ["b", "stage", 1600, 296],
      ],
      edges: [
        ["a>i", "forward", null, null],
        ["t1>j2", "forward", null, null],
        ["t2>j2", "forward", null, null],
        ["j2>e", "forward", null, null],
        ["e>r", "forward", null, null],
        ["r>b", "forward", null, null],
        ["r<h0", "back", null, null],
        ["i>t1#yes", "branch", 1, "yes"],
        ["i>e#no", "branch", 2, "no"],
      ],
    });
  });
});
