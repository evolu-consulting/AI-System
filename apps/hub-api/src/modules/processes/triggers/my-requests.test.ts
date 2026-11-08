// CR-126 · cr126-requests-mine · unit: trạng thái lượt → nhóm một chữ của «Đã gửi của tôi».
import { describe, expect, it } from "bun:test";
import { requestWord } from "./my-requests.service";

describe("requestWord", () => {
  it("lượt còn chạy ⇒ waiting (kể cả đã từng bị trả lại)", () => {
    for (const s of [
      "running",
      "waiting_review",
      "waiting_answer",
      "needs_decision",
      "waiting_timer",
    ])
      expect(requestWord(s, null)).toBe("waiting");
    expect(requestWord("waiting_review", "fail")).toBe("waiting");
  });
  it("xong ⇒ done; xong sau quyết từ chối ⇒ rejected", () => {
    expect(requestWord("done", null)).toBe("done");
    expect(requestWord("done", "reject")).toBe("rejected");
  });
  it("kết thúc không xong: Trả lại ⇒ returned, còn lại ⇒ rejected", () => {
    expect(requestWord("cancelled", "fail")).toBe("returned");
    expect(requestWord("cancelled", "reject")).toBe("rejected");
    expect(requestWord("expired", null)).toBe("rejected");
  });
});
