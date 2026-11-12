import { describe, expect, test } from "bun:test";
import { PURE_JS, UI_JS } from "./client";

type St = { v: Record<string, { verdict: string; note: string }>; a: Record<string, string> };
type Fb = {
  prototype: { id: string; title: string; version: string };
  exportedAt: string;
  answers: { id: string; question: string; answer: string }[];
  unanswered: { id: string; question: string }[];
  screens: { id: string; title: string; verdict: string; note: string }[];
};
const api = new Function(
  `${PURE_JS}; return {blank,setVerdict,setNote,setAnswer,unanswered,pendingText,buildFeedback,feedbackText,stepAt}`,
)() as {
  blank: () => St;
  setVerdict: (s: St, id: string, v: string) => St;
  setNote: (s: St, id: string, n: string) => St;
  setAnswer: (s: St, id: string, a: string) => St;
  unanswered: (s: St, qs: { id: string }[]) => { id: string }[];
  pendingText: (n: number) => string;
  buildFeedback: (d: unknown, s: St, now: string) => Fb;
  feedbackText: (f: Fb) => string;
  stepAt: (flow: unknown[], i: number) => Record<string, unknown> | null;
};

const data = {
  id: "mau",
  title: "Mẫu",
  version: "abc12345",
  screens: [
    { id: "s1", title: "Màn một" },
    { id: "s2", title: "Màn hai" },
    { id: "s3", title: "Màn ba" },
  ],
  questions: [
    { id: "q1", text: "Hạn là bao lâu?" },
    { id: "q2", text: "Từ chối thì sao?" },
  ],
};

describe("script nhúng", () => {
  test("cú pháp hợp lệ (không chạy)", () => {
    expect(() => new Function(PURE_JS + UI_JS)).not.toThrow();
  });

  test("đếm câu chưa chốt và câu chữ ở đầu trang", () => {
    const s = api.blank();
    expect(api.unanswered(s, data.questions)).toHaveLength(2);
    api.setAnswer(s, "q1", "7 ngày");
    expect(api.unanswered(s, data.questions).map((q) => q.id)).toEqual(["q2"]);
    expect(api.pendingText(3)).toBe("Còn 3 câu cần anh/chị chốt");
    expect(api.pendingText(0)).toBe("Đã chốt hết câu hỏi");
  });

  test("bấm lại cùng nút Đúng ý/Cần sửa thì bỏ chọn", () => {
    const s = api.blank();
    api.setVerdict(s, "s1", "ok");
    expect(s.v.s1?.verdict).toBe("ok");
    api.setVerdict(s, "s1", "fix");
    expect(s.v.s1?.verdict).toBe("fix");
    api.setVerdict(s, "s1", "fix");
    expect(s.v.s1?.verdict).toBe("");
  });

  test("góp ý JSON có phiên bản, chỉ màn có ý kiến, câu đã/chưa chốt", () => {
    const s = api.blank();
    api.setAnswer(s, "q1", "7 ngày");
    api.setVerdict(s, "s1", "ok");
    api.setVerdict(s, "s2", "fix");
    api.setNote(s, "s2", "Thiếu cột hạn");
    api.setNote(s, "s3", "Chỉ ghi chú");
    const fb = api.buildFeedback(data, s, "2026-11-10T01:02:03.000Z");
    expect(fb.prototype).toEqual({ id: "mau", title: "Mẫu", version: "abc12345" });
    expect(fb.answers).toEqual([{ id: "q1", question: "Hạn là bao lâu?", answer: "7 ngày" }]);
    expect(fb.unanswered.map((q) => q.id)).toEqual(["q2"]);
    expect(fb.screens.map((x) => [x.id, x.verdict])).toEqual([
      ["s1", "ok"],
      ["s2", "fix"],
      ["s3", "none"],
    ]);
  });

  test("chữ để dán vào chat bằng tiếng Việt", () => {
    const s = api.blank();
    api.setAnswer(s, "q1", "7 ngày");
    api.setVerdict(s, "s2", "fix");
    api.setNote(s, "s2", "Thiếu cột hạn");
    const t = api.feedbackText(api.buildFeedback(data, s, "2026-11-10T01:02:03.000Z"));
    expect(t).toContain("GÓP Ý BẢN MẪU «Mẫu» (phiên bản abc12345, 2026-11-10)");
    expect(t).toContain("- Hạn là bao lâu? → 7 ngày");
    expect(t).toContain("Câu chưa chốt:\n- Từ chối thì sao?");
    expect(t).toContain("- «Màn hai»: Thiếu cột hạn");
  });

  test("đi thử từng bước: bước cuối là màn đích của bước chót", () => {
    const flow = [
      { from: "a", to: "b", by: "x", action: "Gửi" },
      { from: "b", to: "c", by: "y", action: "Duyệt" },
    ];
    expect(api.stepAt(flow, 0)).toMatchObject({ from: "a", role: "x", last: false });
    expect(api.stepAt(flow, 1)).toMatchObject({ from: "b", role: "y", to: "c", last: false });
    expect(api.stepAt(flow, 2)).toMatchObject({ from: "c", role: "y", last: true });
    expect(api.stepAt([], 0)).toBeNull();
  });
});
