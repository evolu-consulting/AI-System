// CR-170 · revealEvidence: cuộn tới ô + focus ô ý kiến; giảm chuyển động ⇒ không cuộn mượt.
import { describe, expect, test } from "bun:test";
import { revealEvidence } from "./reveal";

describe("revealEvidence", () => {
  test("cuộn mượt tới giữa khung nhìn và focus ô ý kiến", () => {
    const calls: unknown[] = [];
    let focused = 0;
    revealEvidence({ scrollIntoView: (o) => calls.push(o) }, { focus: () => focused++ }, false);
    expect(calls).toEqual([{ block: "center", behavior: "smooth" }]);
    expect(focused).toBe(1);
  });
  test("giảm chuyển động ⇒ cuộn tức thì", () => {
    const calls: unknown[] = [];
    revealEvidence({ scrollIntoView: (o) => calls.push(o) }, null, true);
    expect(calls).toEqual([{ block: "center", behavior: "auto" }]);
  });
  test("thiếu phần tử ⇒ không lỗi", () => {
    expect(() => revealEvidence(null, null, false)).not.toThrow();
  });
});
