// HUB-FR-10/11 · câu lỗi gửi hiện trong composer (plan-frontend §1.4).
import { describe, expect, test } from "bun:test";
import { ApiError } from "~/lib/http";
import { isComposerError, sendErrorView } from "./send-error";

const err = (code: ConstructorParameters<typeof ApiError>[1], details?: unknown) =>
  new ApiError(404, code, "x", details);

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
