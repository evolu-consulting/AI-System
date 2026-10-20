// FileBox riêng của sohoptac2: link tải là đường dẫn tương đối `/_fb/d/…`; "Xem file gốc" phải nhận nó (không nhận `//host`, `javascript:`).
import { expect, test } from "bun:test";
import { isOpenableLink } from "./api";

test("isOpenableLink: https/http tuyệt đối và đường dẫn cùng origin được nhận", () => {
  expect(isOpenableLink("https://files.example/d/abc?v=1")).toBe(true);
  expect(isOpenableLink("http://localhost:9100/d/abc")).toBe(true);
  expect(isOpenableLink("/_fb/d/0123456789abcdef?v=&exp=1&sig=ab")).toBe(true);
});
test("isOpenableLink: từ chối //host, javascript:, rỗng, tương đối không gạch đầu", () => {
  for (const bad of ["//evil.example/x", "javascript:alert(1)", "", "d/abc", "data:text/html,x"])
    expect(isOpenableLink(bad)).toBe(false);
});