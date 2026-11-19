// [CR-147b] Mã hoá avatar khi trình duyệt (Chromium headless) trả null / ném lỗi / chỉ trả PNG.
import { describe, expect, test } from "bun:test";
import { encodeAvatar } from "./avatar-encode";

const url = (type: string, bytes: number) =>
  `data:${type};base64,${"A".repeat(Math.ceil((bytes * 4) / 3 / 4) * 4)}`;
const blob = (type: string) => ({ type, size: 10 }) as unknown as Blob;
const read = async (b: Blob) => url(b.type, b.size);

describe("encodeAvatar", () => {
  test("toBlob trả WebP nhỏ ⇒ dùng ngay", async () => {
    const cv = {
      toBlob: (cb: (b: Blob | null) => void, t: string) => cb(blob(t)),
      toDataURL: () => "",
    };
    expect(await encodeAvatar(cv, read)).toStartWith("data:image/webp;base64,");
  });
  test("toBlob luôn null ⇒ dự phòng toDataURL (JPEG)", async () => {
    const cv = {
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
      toDataURL: (t: string) => url(t, 1000),
    };
    expect(await encodeAvatar(cv, read)).toStartWith("data:image/webp;base64,");
  });
  test("toBlob ném lỗi ⇒ vẫn dự phòng toDataURL", async () => {
    const cv = {
      toBlob: () => {
        throw new Error("boom");
      },
      toDataURL: (t: string) => url(t, 1000),
    };
    expect(await encodeAvatar(cv, read)).toStartWith("data:image/");
  });
  test("WebP không mã được (trả PNG to) ⇒ sang JPEG nhẹ", async () => {
    const cv = {
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
      toDataURL: (t: string) => (t === "image/webp" ? url("image/png", 300_000) : url(t, 20_000)),
    };
    expect(await encodeAvatar(cv, read)).toStartWith("data:image/jpeg;base64,");
  });
  test("không bản nào đạt ⇒ ném lỗi có lý do (để hiện + console)", async () => {
    const cv = { toBlob: (cb: (b: Blob | null) => void) => cb(null), toDataURL: () => "data:," };
    await expect(encodeAvatar(cv, read)).rejects.toThrow(/avatar-encode: .*webp:not-data-url/);
  });
});
