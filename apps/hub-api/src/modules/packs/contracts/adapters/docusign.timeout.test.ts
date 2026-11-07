// CR-122 · gửi HĐ scan lớn lên DocuSign: hạn chờ theo dung lượng (11 MB mất > 15 s ⇒ hạn cứng 15 s làm gửi ký lỗi).
import { describe, expect, it } from "bun:test";
import { uploadTimeoutMs } from "./docusign.provider";

describe("uploadTimeoutMs", () => {
  it("tệp nhỏ ≈ 15 s; 11 MB đủ thời gian (> 60 s); trần 180 s", () => {
    expect(uploadTimeoutMs(10_000)).toBe(21_000);
    expect(uploadTimeoutMs(11.2 * 1024 * 1024)).toBe(87_000);
    expect(uploadTimeoutMs(100 * 1024 * 1024)).toBe(180_000);
  });
});
