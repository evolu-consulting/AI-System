// CHAT-AC-57 · HUB-FR-110/111 · luật thuần của hỏi lại (plan-frontend §4).
import { describe, expect, test } from "bun:test";
import type { TaskForward } from "@ai/contracts/chat";
import {
  ANSWER_MAX,
  askErrorKey,
  askMode,
  canForward,
  chipDescriptions,
  forwardedToMe,
  forwardsLeft,
  hasSourceKeyLike,
  hhmm,
  lastForwardByMe,
  validateAnswer,
  validateNote,
} from "./ask-rules";

const u = (n: number, name = `U${n}`) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  display_name: name,
});
const fw = (from: number, to: number): TaskForward => ({
  from: u(from),
  to: u(to),
  note: null,
  at: "2026-10-10T00:00:00.000Z",
});

describe("askMode", () => {
  test("một câu (kể cả 1 dòng đánh số) => single", () => {
    expect(askMode("Kỳ kế toán nào?")).toBe("single");
    expect(askMode("1. Kỳ nào?")).toBe("single");
    expect(askMode("")).toBe("single");
  });
  test("từ 2 dòng đánh số (1. / 2)) => multi", () => {
    expect(askMode("1. Kỳ nào?\n2. Công ty nào?")).toBe("multi");
    expect(askMode("1) A\n2) B\n3) C")).toBe("multi");
  });
});

describe("trần chuyển", () => {
  test("forwardsLeft / canForward", () => {
    expect(forwardsLeft([])).toBe(3);
    expect(forwardsLeft([1, 2, 3])).toBe(0);
    expect(canForward({ status: "open", forwards: [fw(1, 2)] })).toBe(true);
    expect(canForward({ status: "open", forwards: [fw(1, 2), fw(1, 3), fw(1, 4)] })).toBe(false);
    expect(canForward({ status: "closed", forwards: [] })).toBe(false);
  });
});

describe("người được nhờ / người nhờ", () => {
  test("forwardedToMe: là `to`, chưa từng là `from`", () => {
    expect(forwardedToMe([fw(1, 2)], u(2).id)?.from.display_name).toBe("U1");
    expect(forwardedToMe([fw(1, 2)], u(1).id)).toBeNull();
    expect(forwardedToMe([fw(1, 2), fw(2, 3)], u(2).id)).toBeNull();
    expect(forwardedToMe([], u(2).id)).toBeNull();
  });
  test("lastForwardByMe: lần chuyển gần nhất của mình + thứ tự k", () => {
    const r = lastForwardByMe([fw(1, 2), fw(1, 3)], u(1).id);
    expect(r?.k).toBe(2);
    expect(r?.forward.to.display_name).toBe("U3");
    expect(lastForwardByMe([fw(1, 2)], u(2).id)).toBeNull();
  });
});

describe("validate", () => {
  test("câu trả lời: trống / quá dài / hợp lệ", () => {
    expect(validateAnswer("   ")).toEqual({ key: "answerRequired" });
    expect(validateAnswer("x".repeat(ANSWER_MAX + 1))).toEqual({ key: "tooLong", max: ANSWER_MAX });
    expect(validateAnswer("09/2026")).toBeNull();
  });
  test("lời nhắn tối đa 500", () => {
    expect(validateNote("x".repeat(500))).toBeNull();
    expect(validateNote("x".repeat(501))).toEqual({ key: "tooLong", max: 500 });
  });
});

test("askErrorKey: mã -> khoá i18n; lạ => rtErr.unknown", () => {
  expect(askErrorKey("FORWARD_TARGET_INVALID")).toBe("process.ask.err.target");
  expect(askErrorKey("FORWARD_LIMIT")).toBe("process.ask.err.limit");
  expect(askErrorKey("FORWARD_OUT_OF_GROUP")).toBe("process.ask.err.group");
  expect(askErrorKey("REVIEW_TASK_CLOSED")).toBe("process.ask.err.closed");
  expect(askErrorKey("TASK_KIND_MISMATCH")).toBe("process.common.apiError.TASK_KIND_MISMATCH");
  expect(askErrorKey(undefined)).toBe("rtErr.unknown");
});

test("hhmm: HH:mm hai chữ số", () => {
  expect(hhmm(new Date(2026, 9, 10, 7, 5).toISOString())).toBe("07:05");
});

describe("chip nguồn (P-b · C20)", () => {
  test("hasSourceKeyLike: chỉ khi có lựa chọn dạng ký hiệu", () => {
    expect(hasSourceKeyLike(["09/2026", "10/2026"])).toBe(false);
    expect(hasSourceKeyLike(["09/2026", "web-app"])).toBe(true);
    expect(hasSourceKeyLike([])).toBe(false);
  });
  test("chipDescriptions: ghép mô tả theo key", () => {
    const chips = [
      { key: "web-app", kind: "git_remote" as const, description: "Kho web" },
      { key: "docs", kind: "library" as const, description: "" },
    ];
    expect(chipDescriptions(["web-app", "docs", "khac"], chips)).toEqual({ "web-app": "Kho web" });
    expect(chipDescriptions(["web-app"], undefined)).toEqual({});
  });
});
