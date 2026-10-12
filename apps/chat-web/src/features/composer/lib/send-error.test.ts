// HUB-FR-10/11 · câu lỗi gửi hiện trong composer (plan-frontend §1.4).
import { describe, expect, test } from "bun:test";
import { ApiError } from "~/lib/http";
import { isComposerError, sendErrorView } from "./send-error";

const err = (code: ConstructorParameters<typeof ApiError>[1], details?: unknown) =>
  new ApiError(404, code, "x", { details });

describe("sendErrorView", () => {
  test("CMD_NOT_FOUND: tên lấy từ chữ đã gửi, gợi ý từ details (chấp nhận trường thừa)", () => {
    const v = sendErrorView(
      err("CMD_NOT_FOUND", { name: "tranlate", suggestions: ["translate", "trello"] }),
      "/tranlate en hello",
    );
    expect(v?.lines).toEqual([{ key: "sendError.cmdNotFound", params: { name: "tranlate" } }]);
    expect(v?.suggestions).toEqual(["translate", "trello"]);
  });
  test("details sai dạng → bỏ gợi ý", () => {
    expect(sendErrorView(err("CMD_NOT_FOUND", "oops"), "/x")?.suggestions).toEqual([]);
  });
  test("CMD_MISSING_ARG: thiếu + giá trị không hợp lệ", () => {
    const v = sendErrorView(
      err("CMD_MISSING_ARG", { missing: ["text", "lang"], invalid: ["n"] }),
      "/translate",
    );
    expect(v?.lines.map((l) => l.key)).toEqual(["sendError.cmdMissingArg", "sendError.cmdInvalid"]);
    expect(v?.lines[0]?.params).toEqual({ name: "translate", missing: "text, lang" });
  });
  test("CMD_MISSING_ARG với tin chỉ có @tag → câu 'Hãy nhập nội dung sau @tag'", () => {
    const v = sendErrorView(err("CMD_MISSING_ARG", { missing: [], invalid: [] }), "@trello");
    expect(v?.lines).toEqual([{ key: "sendError.tagOnly", params: { tag: "trello" } }]);
  });
  test("mã khác → null (giữ toast C1)", () => {
    expect(sendErrorView(err("FLOW_BUSY"), "x")).toBeNull();
    expect(isComposerError(err("CMD_NOT_FOUND"))).toBe(true);
    expect(isComposerError(err("FLOW_BUSY"))).toBe(false);
  });
});

describe("F2 · agent + 429", () => {
  const mk = (status: number, code: string, details?: unknown, retryAfter?: number) =>
    new ApiError(status, code as never, "m", { details, retryAfter });
  test("AGENT_NOT_FOUND: tag từ details (parse tay, bỏ trường thừa), gợi ý tiền tố @", () => {
    const v = sendErrorView(
      mk(404, "AGENT_NOT_FOUND", { tag: "x2", suggestions: ["x"], extra: 1 }),
      "@x2 hi",
    );
    expect(v).toEqual({
      lines: [{ key: "sendError.agentNotFound", params: { tag: "x2" } }],
      suggestions: ["x"],
      suggestionPrefix: "@",
      tag: "x2",
    });
  });
  test("TOO_MANY_RUNS: n = còn lại, mặc định Retry-After, vắng → 5", () => {
    const e = mk(429, "TOO_MANY_RUNS", undefined, 3);
    expect(sendErrorView(e, "a")?.lines[0]?.params.n).toBe("3");
    expect(sendErrorView(e, "a", 1)?.lines[0]?.params.n).toBe("1");
    expect(sendErrorView(mk(429, "TOO_MANY_RUNS"), "a")?.lines[0]?.params.n).toBe("5");
    expect(isComposerError(e)).toBe(true);
  });
  test("CR-054 · DEFAULT_AGENT_FORBIDDEN: câu riêng trong composer, không gợi ý", () => {
    const e = new ApiError(403, "DEFAULT_AGENT_FORBIDDEN", "x");
    expect(isComposerError(e)).toBe(true);
    expect(sendErrorView(e, "xin chào")).toEqual({
      lines: [{ key: "sendError.defaultAgentForbidden", params: {} }],
      suggestions: [],
    });
  });
});

describe("P-a · lỗi quy trình trong composer", () => {
  test("PROCESS_NOT_FOUND: câu + gợi ý !key (tối đa 3)", () => {
    const e = new ApiError(404, "PROCESS_NOT_FOUND", "x", {
      details: { suggestions: ["hoa-don", "sdlc"] },
    });
    expect(isComposerError(e)).toBe(true);
    const v = sendErrorView(e, "!hoadon HD-1");
    expect(v?.lines).toEqual([
      { key: "process.composer.error.notFound", params: { key: "hoadon" } },
    ]);
    expect(v?.suggestions).toEqual(["hoa-don", "sdlc"]);
    expect(v?.suggestionPrefix).toBe("!");
  });
  test("TOO_MANY_PROCESS_RUNS: không đếm ngược (D7), chỉ trần 5", () => {
    const e = new ApiError(429, "TOO_MANY_PROCESS_RUNS", "x", { retryAfter: 30 });
    expect(sendErrorView(e, "!sdlc x", 12)?.lines).toEqual([
      { key: "process.composer.error.tooMany", params: { max: "5" } },
    ]);
  });
  test("PROCESS_THREAD_NO_AGENT: câu riêng của thread, không gợi ý", () => {
    const e = new ApiError(422, "PROCESS_THREAD_NO_AGENT", "x");
    expect(sendErrorView(e, "@hd-read x")).toEqual({
      lines: [{ key: "process.thread.err.noAgent", params: {} }],
      suggestions: [],
    });
  });
});

describe("X2b-2 · `!key` + tệp ở phòng", () => {
  const bad = new ApiError(400, "VALIDATION_ERROR", "x", {
    details: { issues: [{ path: ["attachment_ids"], code: "custom", message: "unsupported" }] },
  });
  test("400 path attachment_ids + chữ `!key` ⇒ câu noAttach", () => {
    expect(sendErrorView(bad, "!bao-cao tuần")?.lines).toEqual([
      { key: "process.composer.error.noAttach", params: {} },
    ]);
    expect(isComposerError(bad, "!bao-cao")).toBe(true);
  });
  test("chữ thường ⇒ không (toast)", () => {
    expect(sendErrorView(bad, "xin chào")).toBeNull();
    expect(isComposerError(bad, "xin chào")).toBe(false);
    expect(isComposerError(bad)).toBe(false);
  });
});
