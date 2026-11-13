import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// CR-143: `text-muted` là màu nền (gần trắng) và `border-line` không có token ⇒ dùng `text-dim` / `border-rule`.
const files = ["AttentionBanner.tsx", "ApprovalParts.tsx", "use-approval-ui.tsx"];
test("Banner cần chú ý và ghi chú duyệt dùng token chữ đọc được", () => {
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
    expect(src).not.toMatch(/text-muted\b(?!-)/);
  }
  const banner = readFileSync(new URL("./AttentionBanner.tsx", import.meta.url), "utf8");
  expect(banner).toContain("border-rule");
  expect(banner).not.toContain("border-line");
});
