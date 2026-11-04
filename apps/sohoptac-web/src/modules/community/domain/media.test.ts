// CR-118 · COM-FR-37 · mục media từ tệp đã tải, ánh xạ lỗi upload, dung lượng hiển thị.
import { describe, expect, it } from "bun:test";
import { formatSize, mediaItemOf, uploadErrorKey } from "./media";

const file = (mime: string) => ({
  id: "9b1c1f7e-8c2a-4d6e-9c0a-3f1f0a1b2c3d",
  name: "a.x",
  mime,
  size: 10,
});

describe("mediaItemOf", () => {
  it("ảnh thành image, PDF và tệp khác thành file, giữ fileId tên cỡ mime", () => {
    expect(mediaItemOf(file("image/png")).kind).toBe("image");
    const pdf = mediaItemOf(file("application/pdf"));
    expect(pdf).toMatchObject({
      kind: "file",
      fileId: file("").id,
      label: "a.x",
      name: "a.x",
      size: 10,
    });
  });
});

describe("uploadErrorKey", () => {
  it("413 415 503 có khoá riêng, còn lại là lỗi chung", () => {
    expect(uploadErrorKey(413)).toBe("community.composer.fileTooLarge");
    expect(uploadErrorKey(415)).toBe("community.composer.fileTypeNotAllowed");
    expect(uploadErrorKey(503)).toBe("community.composer.filesUnavailable");
    expect(uploadErrorKey(500)).toBe("community.composer.uploadFailed");
    expect(uploadErrorKey(undefined)).toBe("community.composer.uploadFailed");
  });
});

describe("formatSize", () => {
  it("đổi đơn vị B KB MB", () => {
    expect(formatSize(512, "en-US")).toBe("512 B");
    expect(formatSize(1536, "en-US")).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024, "en-US")).toBe("5 MB");
  });
});
