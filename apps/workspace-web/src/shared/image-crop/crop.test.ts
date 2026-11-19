// CR-192 · toạ độ cắt/phóng + mã hoá xuống đúng cỡ/dung lượng (canvas giả).
import { describe, expect, it } from "bun:test";
import { CROP, type CropCanvas, clampZoom, cropRect, cropToDataUrl, panCenter } from "./crop";

describe("cropRect [CR-192]", () => {
  it("phóng 1×: khung lớn nhất vừa ảnh, giữa ảnh", () => {
    const sq = cropRect({ w: 6000, h: 4000 }, 1, 1, { cx: 3000, cy: 2000 });
    expect(sq).toEqual({ sx: 1000, sy: 0, sw: 4000, sh: 4000 });
    const wide = cropRect({ w: 6000, h: 4000 }, 3, 1, { cx: 3000, cy: 2000 });
    expect(wide).toEqual({ sx: 0, sy: 1000, sw: 6000, sh: 2000 });
  });
  it("phóng 3× nhỏ đi 3 lần; 0.5 và 9 bị kẹp về 1–3", () => {
    expect(cropRect({ w: 1000, h: 1000 }, 1, 3, { cx: 500, cy: 500 }).sw).toBeCloseTo(1000 / 3);
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(9)).toBe(3);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
  it("tâm ra ngoài ảnh ⇒ kẹp trong ảnh", () => {
    const r = cropRect({ w: 1000, h: 1000 }, 1, 2, { cx: -50, cy: 5000 });
    expect(r.sx).toBe(0);
    expect(r.sy + r.sh).toBe(1000);
  });
  it("kéo sang phải ⇒ vùng cắt dịch sang trái (ảnh đi theo tay)", () => {
    const r = cropRect({ w: 1000, h: 1000 }, 1, 2, { cx: 500, cy: 500 });
    const c = panCenter(r, 250, 25, 0);
    expect(c.cx).toBeCloseTo(500 - 25 * (500 / 250));
    expect(c.cy).toBeCloseTo(500);
  });
});

/** Canvas giả: dung lượng = số điểm ảnh × chất lượng / 10 (JPEG/WebP càng nhẹ càng nhỏ). */
const fakeCanvas = (w: number, h: number, log: { w: number; h: number }[]): CropCanvas => {
  log.push({ w, h });
  const bytes = (q: number) => Math.floor((w * h * q) / 10);
  const blob = (t: string, q: number) => ({ type: t, size: bytes(q) }) as unknown as Blob;
  return {
    getContext: () => ({ drawImage: () => undefined }),
    toBlob: (cb, t, q) => cb(blob(t, q)),
    toDataURL: () => "",
  };
};
const read = async (b: Blob) => `data:${b.type};base64,${"A".repeat(Math.ceil(b.size / 3) * 4)}`;
const sizeOf = (u: string) => Math.floor(((u.split(",")[1] as string).length * 3) / 4);

describe("cropToDataUrl [CR-192]", () => {
  it("đại diện: ảnh 6000×4000 vẫn ra 400×400 dưới 150 KB", async () => {
    const log: { w: number; h: number }[] = [];
    const rect = cropRect({ w: 6000, h: 4000 }, 1, 1, { cx: 3000, cy: 2000 });
    const u = await cropToDataUrl({}, rect, CROP.avatar, {
      makeCanvas: (w, h) => fakeCanvas(w, h, log),
      readBlob: read,
    });
    expect(log[0]).toEqual({ w: 400, h: 400 });
    expect(sizeOf(u)).toBeLessThanOrEqual(CROP.avatar.maxBytes);
  });
  it("bìa: 1200×400 dưới 400 KB", async () => {
    const log: { w: number; h: number }[] = [];
    const rect = cropRect({ w: 6000, h: 4000 }, 3, 1, { cx: 3000, cy: 2000 });
    const u = await cropToDataUrl({}, rect, CROP.cover, {
      makeCanvas: (w, h) => fakeCanvas(w, h, log),
      readBlob: read,
    });
    expect(log[0]).toEqual({ w: 1200, h: 400 });
    expect(sizeOf(u)).toBeLessThanOrEqual(400 * 1024);
  });
  it("chất lượng nhỏ nhất vẫn quá nặng ⇒ thu nhỏ dần, không từ chối", async () => {
    const log: { w: number; h: number }[] = [];
    const heavy = { ...CROP.cover, maxBytes: 12_000 };
    const u = await cropToDataUrl({}, { sx: 0, sy: 0, sw: 10, sh: 10 }, heavy, {
      makeCanvas: (w, h) => fakeCanvas(w, h, log),
      readBlob: read,
    });
    expect(log.length).toBeGreaterThan(1);
    expect(sizeOf(u)).toBeLessThanOrEqual(12_000);
  });
  it("mọi vòng đều quá nặng ⇒ ném lỗi có lý do", async () => {
    const tiny = { ...CROP.avatar, maxBytes: 1 };
    await expect(
      cropToDataUrl({}, { sx: 0, sy: 0, sw: 1, sh: 1 }, tiny, {
        makeCanvas: (w, h) => fakeCanvas(w, h, []),
        readBlob: read,
      }),
    ).rejects.toThrow();
  });
});
