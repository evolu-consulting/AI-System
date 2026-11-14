import { describe, expect, it } from "bun:test";
import { checkImage, squareCrop } from "./image";

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
