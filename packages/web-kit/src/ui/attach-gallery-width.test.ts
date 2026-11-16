// CR-179 lỗi UAT 2026-11-16: trong bong bóng chat (co theo nội dung), khung ảnh/danh sách tệp `width: 100%` + ảnh absolute
// ⇒ khung 0×0, tệp gửi không hiện. Khung phải có độ rộng px cố định, `maxWidth: 100%`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("AttachGallery: lưới ảnh và danh sách tệp rộng px cố định, không width 100%", () => {
  const src = readFileSync(new URL("./AttachGallery.tsx", import.meta.url), "utf8");
  expect(src).toContain("width: big ? ATTACH_SIZE.oneMaxWidth : ATTACH_SIZE.gridMaxWidth,");
  expect(src).toContain("width: ATTACH_SIZE.cardMaxWidth,");
  expect(src).not.toMatch(/width: "100%",\s*\n\s*maxWidth: (big|ATTACH_SIZE)/);
});

test("CR-179 (UAT): xem ảnh/tệp toàn màn cách mép 5px; hộp xem phủ hết vùng (không đổi kích thước khi tải xong)", async () => {
  const { ATTACH_SIZE } = await import("../attach-layout");
  expect(ATTACH_SIZE.viewerInset).toBe(5);
  expect(ATTACH_SIZE.viewerWidth).toBe("100%");
  expect(ATTACH_SIZE.viewerHeight).toBe("100%");
  const viewer = readFileSync(new URL("./AttachViewer.tsx", import.meta.url), "utf8");
  expect(viewer).toContain("inset: ATTACH_SIZE.viewerInset");
});
