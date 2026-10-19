// PK-FR-10 · TF1 · chính sách thử lại: không thử lại 4xx, thử lại 5xx/mạng đúng một lần.
import { describe, expect, test } from "bun:test";
import { isClientError, retryQuery } from "./query-client";

describe("query-client", () => {
  test("4xx là kết quả đúng, không thử lại", () => {
    expect(isClientError({ status: 403 })).toBe(true);
    expect(retryQuery(0, { status: 404 })).toBe(false);
  });

  test("5xx và lỗi mạng thử lại một lần", () => {
    expect(retryQuery(0, { status: 503 })).toBe(true);
    expect(retryQuery(0, new Error("net"))).toBe(true);
    expect(retryQuery(1, { status: 503 })).toBe(false);
  });
});
