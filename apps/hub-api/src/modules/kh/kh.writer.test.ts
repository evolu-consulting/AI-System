// HUB-FR-134 · K1-AC06 · plan K1 §3.5 "Gửi": kết quả một lần gửi `/vector/add` lỗi (thử lại ≤ 5, 30 s × 2^(n−1)).
import { describe, expect, it } from "bun:test";
import { KhCallError } from "./kh.client";
import { khWriteFailure } from "./kh.writer";

describe("HUB-FR-134 · khWriteFailure", () => {
  it("5xx / 429 / timeout / network ⇒ hẹn lại, attempts+1, lùi theo lần", () => {
    expect(khWriteFailure(new KhCallError("server_error", 500), 0)).toEqual({
      status: "pending",
      attempts: 1,
      code: "server_error",
      backoffMs: 30_000,
    });
    expect(khWriteFailure(new KhCallError("rate_limited", 429), 2)).toMatchObject({
      status: "pending",
      attempts: 3,
      backoffMs: 120_000,
    });
    expect(khWriteFailure(new KhCallError("timeout"), 0).status).toBe("pending");
    expect(khWriteFailure(new KhCallError("unreachable"), 0).status).toBe("pending");
  });
  it("lần thứ 5 lỗi ⇒ failed attempts 5", () => {
    expect(khWriteFailure(new KhCallError("server_error", 503), 4)).toEqual({
      status: "failed",
      attempts: 5,
      code: "server_error",
    });
  });
  it("4xx khác / thân sai ⇒ failed ngay; disabled ⇒ skipped (không tăng attempts)", () => {
    expect(khWriteFailure(new KhCallError("forbidden", 403), 0)).toEqual({
      status: "failed",
      attempts: 1,
      code: "forbidden",
    });
    expect(khWriteFailure(new KhCallError("invalid"), 0).status).toBe("failed");
    expect(khWriteFailure(new KhCallError("disabled"), 2)).toEqual({
      status: "skipped",
      attempts: 2,
      code: "disabled",
    });
  });
});
