// CR-194 · cắt 1 MB đầu + giải mã UTF-8.
import { describe, expect, test } from "bun:test";
import { readTextHead, TEXT_MAX_BYTES } from "./text-head";

describe("readTextHead (CR-194)", () => {
  test("tệp nhỏ: giữ xuống dòng, tiếng Việt, bỏ BOM, không cắt", async () => {
    const r = await readTextHead(new Blob(["﻿xin chào\nhợp đồng"]));
    expect(r).toEqual({ text: "xin chào\nhợp đồng", truncated: false });
  });
  test("tệp > 1 MB: chỉ lấy 1 MB đầu, truncated = true, không sinh ký tự lỗi ở đuôi", async () => {
    const r = await readTextHead(new Blob(["đ".repeat(TEXT_MAX_BYTES)])); // 2 byte/ký tự
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBe(TEXT_MAX_BYTES / 2);
    expect(r.text.includes("�")).toBe(false);
  });
  test("đúng 1 MB ⇒ không truncated; byte lỗi ⇒ U+FFFD, không ném", async () => {
    expect((await readTextHead(new Blob(["a".repeat(TEXT_MAX_BYTES)]))).truncated).toBe(false);
    expect((await readTextHead(new Blob([new Uint8Array([0xff, 0x41])]))).text).toBe("�A");
  });
});
