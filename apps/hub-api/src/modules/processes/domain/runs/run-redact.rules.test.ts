// CR-121 · R-2 · unit: che secret trong payload job / thông điệp lỗi trước khi trả debug.
import { describe, expect, it } from "bun:test";
import { REDACTED, redactJson, redactText } from "./run-redact.rules";

describe("redactJson", () => {
  it("khoá nhạy cảm ⇒ *** ở mọi độ sâu (object lồng, mảng), không phân biệt hoa/thường", () => {
    const out = redactJson({
      prompt: "xin chào",
      API_KEY: "sk-live-1",
      auth: { Authorization: "Bearer abc", nested: [{ password: "p", ok: 1 }] },
      headers: { Cookie: "sid=1", "x-token": "t" },
      n: 3,
      nil: null,
    });
    expect(out).toEqual({
      prompt: "xin chào",
      API_KEY: REDACTED,
      auth: { Authorization: REDACTED, nested: [{ password: REDACTED, ok: 1 }] },
      headers: { Cookie: REDACTED, "x-token": REDACTED },
      n: 3,
      nil: null,
    });
  });

  it("chuỗi Bearer trong giá trị thường cũng bị che", () => {
    expect(redactJson({ note: "gọi với Bearer eyJhbGciOi.abc.def rồi" })).toEqual({
      note: `gọi với Bearer ${REDACTED} rồi`,
    });
  });

  it("quá sâu ⇒ che hẳn; không đụng dữ liệu thường", () => {
    let deep: unknown = { x: "ok" };
    for (let i = 0; i < 20; i++) deep = { a: deep };
    expect(JSON.stringify(redactJson(deep))).toContain(REDACTED);
    expect(redactJson({ a: [1, "b", true] })).toEqual({ a: [1, "b", true] });
  });
});

describe("redactText", () => {
  it("che Bearer và khoá=giá trị trong thông điệp lỗi, giữ phần còn lại", () => {
    expect(redactText("401 Unauthorized: Bearer sk-abcdef123456 hết hạn")).toBe(
      `401 Unauthorized: Bearer ${REDACTED} hết hạn`,
    );
    expect(redactText("connect failed api_key=sk-live-999&region=eu")).toBe(
      `connect failed api_key=${REDACTED}&region=eu`,
    );
    expect(redactText('{"password": "hunter2"}')).toBe(`{"password": ${REDACTED}}`);
    expect(redactText("Timeout sau 600 giây")).toBe("Timeout sau 600 giây");
  });
});
