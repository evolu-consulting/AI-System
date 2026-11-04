// CR-118 · COM-FR-37 · mục media từ tệp đã tải, ánh xạ lỗi upload, dung lượng hiển thị.
import { describe, expect, it } from "bun:test";
import { formatResetTime, formatSize, mediaItemOf, uploadNotice } from "./media";

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

describe("uploadNotice", () => {
  it("413 415 503 có khoá riêng, còn lại là lỗi chung", () => {
    expect(uploadNotice({ status: 413 }).key).toBe("community.composer.fileTooLarge");
    expect(uploadNotice({ status: 415 }).key).toBe("community.composer.fileTypeNotAllowed");
    expect(uploadNotice({ status: 503 }).key).toBe("community.composer.filesUnavailable");
    expect(uploadNotice({ status: 500 }).key).toBe("community.composer.uploadFailed");
    expect(uploadNotice({}).key).toBe("community.composer.uploadFailed");
  });
  it("429 UPLOAD_QUOTA theo phạm vi, kèm giờ thử lại khi có resets_at", () => {
    const n = uploadNotice(
      {
        status: 429,
        code: "UPLOAD_QUOTA",
        details: { scope: "user", limit: 20, resets_at: "2026-11-05T01:00:00.000Z" },
      },
      "en-US",
    );
    expect(n.key).toBe("community.composer.quota.user");
    expect(n.params).toEqual({ limit: 20 });
    expect(n.retry?.key).toBe("community.composer.quota.retryAt");
    expect(n.retry?.params.time).toBe(formatResetTime("2026-11-05T01:00:00.000Z", "en-US"));
    expect(
      uploadNotice({ status: 429, code: "UPLOAD_QUOTA", details: { scope: "busy", limit: 3 } })
        .retry,
    ).toBeUndefined();
    expect(
      uploadNotice({ status: 429, code: "UPLOAD_QUOTA", details: { scope: "zzz", limit: 1 } }).key,
    ).toBe("community.composer.quota.tenant");
  });
  it("503 UPLOAD_QUOTA_UNAVAILABLE khác 503 FILES_UNAVAILABLE", () => {
    expect(uploadNotice({ status: 503, code: "UPLOAD_QUOTA_UNAVAILABLE" }).key).toBe(
      "community.composer.quota.unavailable",
    );
  });
  it("giờ hỏng thì chuỗi rỗng", () => {
    expect(formatResetTime("khong-phai-ngay")).toBe("");
  });
});

describe("formatSize", () => {
  it("đổi đơn vị B KB MB", () => {
    expect(formatSize(512, "en-US")).toBe("512 B");
    expect(formatSize(1536, "en-US")).toBe("1.5 KB");
    expect(formatSize(5 * 1024 * 1024, "en-US")).toBe("5 MB");
  });
});
