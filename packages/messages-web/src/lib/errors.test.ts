// CR-169 · lát 5b · bản đồ lỗi tin nhắn: mã công ty chưa kết nối có câu riêng, mã lạ ⇒ câu chung.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { errorKey } from "./errors";

describe("errorKey [CR-169 · chuyển gói]", () => {
  it("MSG_NOT_CONNECTED ⇒ câu riêng", () => {
    const e = new ApiError(409, "MSG_NOT_CONNECTED" as never, "x");
    expect(errorKey(e)).toBe("contracts.messages.err.notConnected");
  });
  it("lỗi lạ ⇒ câu chung", () => {
    expect(errorKey(new Error("x"))).toBe("contracts.messages.err.generic");
  });
});
