// CR-122 · P8: chèn bước vào giữa một cạnh — đích (goto/next_step/Nếu) vẫn đúng sau khi chèn.
import { describe, expect, test } from "bun:test";
import { emptyDraft, emptyStage, validateDraft } from "./def-form";
import { insertOnEdge } from "./insert-on-edge";

const st = (uid: string, step: number, o: object = {}) => ({ ...emptyStage(step), uid, ...o });
const ok = <T>(r: { stages: T[] } | { error: string }): T[] => {
  if (!("stages" in r)) throw new Error(r.error);
  return r.stages;
};

describe("insertOnEdge", () => {
  test("chèn giữa hai bước tuần tự ⇒ bước sau dời xuống, đích cũ đánh lại", () => {
    // a(0, next→2 = c, goto→3 = d) · b(1) · c(2) · d(3)
    const before = [
      st("a", 0, {
        nextStep: 2,
        branch: [{ field: "x", op: "eq", value: "1", goto: 4 }], // đếm từ 1 ⇒ bước d
      }),
      st("b", 1),
      st("c", 2),
      st("d", 3),
    ];
    const out = ok(insertOnEdge(before, st("n", 99), { from: "b", to: "c" }));
    expect(out.map((s) => [s.uid, s.step])).toEqual([
      ["a", 0],
      ["b", 1],
      ["n", 2],
      ["c", 3],
      ["d", 4],
    ]);
    const a = out.find((s) => s.uid === "a");
    expect(a?.nextStep).toBe(3); // vẫn tới c
    expect(a?.branch[0]?.goto).toBe(5); // vẫn tới d (đếm từ 1)
    expect(out.find((s) => s.uid === "n")?.nextStep).toBeUndefined(); // đi tuần tự sang c
  });

  test("chèn trên nhánh Đúng của Nếu ⇒ bước mới nằm trên nhánh Đúng, nhánh Sai giữ đích", () => {
    // i(0): Đúng→t (bước 1, yes=2) · Sai→f (bước 2, no=3)
    const before = [
      st("i", 0, { ifx: { op: "and", conds: [], yes: 2, no: 3 } }),
      st("t", 1),
      st("f", 2),
    ];
    const out = ok(insertOnEdge(before, st("n", 99), { from: "i", to: "t", side: "yes" }));
    const i = out.find((s) => s.uid === "i");
    const n = out.find((s) => s.uid === "n");
    const t = out.find((s) => s.uid === "t");
    const f = out.find((s) => s.uid === "f");
    expect(n?.step).toBe(1);
    expect(i?.ifx.yes).toBe((n?.step ?? 0) + 1); // Đúng → bước mới
    expect(n?.nextStep).toBe(t?.step); // bước mới đi tiếp tới đích cũ của Đúng
    expect(i?.ifx.no).toBe((f?.step ?? 0) + 1); // Sai vẫn tới f
    expect(f?.step).toBe(3);
  });

  test("P14 · chèn Thông báo ⇒ tự có mã/tên tệp/mẫu; validate không còn lỗi kỹ thuật; hai node cùng tên ⇒ mã duy nhất", () => {
    const full = { filename: "x.md", template: "# x", sections: ["s"] };
    const a = st("a", 0, { key: "a", name: "A", ...full });
    const b = st("b", 1, { key: "b", name: "B", ...full });
    const n1 = st("n1", 99, { name: "Thông báo", executor: "notify" });
    const n2 = st("n2", 99, { name: "Thông báo", executor: "notify" });
    const s1 = ok(insertOnEdge([a, b], n1, { from: "a", to: "b" }));
    const s2 = ok(insertOnEdge(s1, n2, { from: "a", to: "n1" }));
    const keys = s2.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const got = s2.find((s) => s.uid === "n1");
    expect(got?.key).toBe("thong-bao");
    expect(got?.filename).toBe("thong-bao.md");
    expect(got?.template).toBe("# Thông báo");
    expect(s2.find((s) => s.uid === "n2")?.key).toBe("thong-bao-2");
    const errs = validateDraft({ ...emptyDraft(), stages: s2 });
    const tech = Object.keys(errs).filter((p) =>
      /^stages\.\d+\.(key|output\.filename|output\.template|output\.required_sections)$/.test(p),
    );
    expect(tech).toEqual([]);
  });

  test("nguồn có next_step tường minh tới đích ⇒ next_step trỏ bước mới, bước mới đi tiếp tới đích", () => {
    const before = [st("a", 0, { nextStep: 2 }), st("b", 1), st("c", 2)];
    const out = ok(insertOnEdge(before, st("n", 99), { from: "a", to: "c" }));
    const a = out.find((s) => s.uid === "a");
    const n = out.find((s) => s.uid === "n");
    const c = out.find((s) => s.uid === "c");
    expect(a?.nextStep).toBe(n?.step);
    expect(n?.nextStep).toBe(c?.step);
  });
});
