import { describe, expect, it } from "bun:test";
import { checkImage, pickAvatarBlob, squareCrop } from "./image";

describe("ảnh hồ sơ [CR-147b]", () => {
  it("định dạng + dung lượng theo loại ảnh", () => {
    expect(checkImage({ type: "image/png", size: 2 * 1024 * 1024 }, "avatar")).toBe("ok");
    expect(checkImage({ type: "image/png", size: 2 * 1024 * 1024 + 1 }, "avatar")).toBe("big");
    expect(checkImage({ type: "image/png", size: 3 * 1024 * 1024 }, "cover")).toBe("ok");
    expect(checkImage({ type: "image/gif", size: 10 }, "cover")).toBe("type");
    expect(checkImage({ type: "image/svg+xml", size: 10 }, "avatar")).toBe("type");
  });
  it("cắt vuông giữa ảnh", () => {
    expect(squareCrop(400, 200)).toEqual({ sx: 100, sy: 0, side: 200 });
    expect(squareCrop(100, 300)).toEqual({ sx: 0, sy: 100, side: 100 });
    expect(squareCrop(50, 50)).toEqual({ sx: 0, sy: 0, side: 50 });
  });
});

describe("pickAvatarBlob [CR-147b]", () => {
  const b = (type: string, size: number) => ({ type, size });
  it("lấy bản đầu tiên ≤ 150 KB; PNG to (trình duyệt không mã WebP) ⇒ bỏ, lấy JPEG nhẹ hơn", () => {
    const r = pickAvatarBlob([
      b("image/png", 220_000),
      b("image/jpeg", 90_000),
      b("image/jpeg", 40_000),
    ]);
    expect(r?.size).toBe(90_000);
  });
  it("không bản nào đạt (hoặc null / loại lạ) ⇒ null, không trả tệp gốc", () => {
    expect(pickAvatarBlob([null, b("image/gif", 10), b("image/jpeg", 153_601)])).toBeNull();
  });
});
