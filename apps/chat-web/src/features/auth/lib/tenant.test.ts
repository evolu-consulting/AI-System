// CHAT-AC-01 · mã công ty: chuẩn hoá như contract (trim + chữ thường); không có storage → rỗng.
import { describe, expect, test } from "bun:test";
import { normalizeLoginId, rememberedTenant, rememberTenant } from "./tenant";

describe("tenant", () => {
  test("CHAT-AC-01 · trim + chữ thường", () => {
    expect(normalizeLoginId("  AcMe ")).toBe("acme");
  });
  test("CHAT-AC-01 · nhớ rồi đọc lại (hoặc rỗng khi môi trường không có localStorage)", () => {
    rememberTenant("acme");
    const got = rememberedTenant();
    expect(typeof localStorage === "undefined" ? got === "" : got === "acme").toBe(true);
  });
});
