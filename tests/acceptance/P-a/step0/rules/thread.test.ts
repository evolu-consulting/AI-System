// HUB-FR-113 · U1 · R-TK06 — `threadContent` (core/thread.rules.ts, plan-contract §7, plan-thread §2): câu tóm tắt 1..500 ký tự
// cho 7 kind × vi/en; feedback dài bị cắt; `forward` không chép ghi chú.
import { describe, expect, it } from "bun:test";
import { fn, loadCoreRules } from "../../_support/modules";
import { allParts, part } from "../../_support/parts";

const RUN = "a5a00000-0000-4000-8000-00000000c001";
const names = { process: "Hoá đơn thử", stage: "Đọc hoá đơn" };

describe("R-TK06 · nội dung tin thread [HUB-FR-113]", () => {
  it("HUB-FR-113 · R-TK06 · 7 kind × vi/en ⇒ chuỗi 1..500; task_result feedback 3 000 ký tự ⇒ ≤ 500; forward không lộ note", async () => {
    const f = fn(await loadCoreRules("thread"), "threadContent");
    for (const p of allParts(RUN))
      for (const loc of ["vi", "en"]) {
        const s: string = f(p, loc, names);
        expect(typeof s).toBe("string");
        expect(s.length).toBeGreaterThanOrEqual(1);
        expect(s.length).toBeLessThanOrEqual(500);
      }
    const fb = part.task_result(RUN, undefined, undefined, {
      result: "fail",
      feedback: "Thiếu MST. ".repeat(300),
    });
    expect((f(fb, "vi", names) as string).length).toBeLessThanOrEqual(500);
    const fw = { ...part.forward(RUN), note: "GHI-CHU-RIENG-TU" };
    expect(f(fw, "vi", names) as string).not.toContain("GHI-CHU-RIENG-TU");
  });
});
