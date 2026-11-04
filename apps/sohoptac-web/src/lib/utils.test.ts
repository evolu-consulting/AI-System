// HD9 (D-02) · `cn` giữ cỡ chữ tuỳ biến của theme khi gộp với màu chữ.
import { describe, expect, test } from "bun:test";
import { cn } from "./utils";

describe("cn", () => {
  test("text-label (cỡ) + text-dim (màu) cùng tồn tại; cỡ sau vẫn thắng cỡ trước", () => {
    expect(cn("text-label", "text-dim")).toBe("text-label text-dim");
    expect(cn("text-label", "text-body")).toBe("text-body");
    expect(cn("text-dim", "text-late")).toBe("text-late");
  });
});
