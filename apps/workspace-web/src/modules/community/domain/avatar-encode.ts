// CR-147b · mã hoá avatar từ canvas (thuần, canvas/đọc blob được tiêm vào để test): thử WebP rồi JPEG nhẹ dần; `toBlob` trả null/ném lỗi
// (trình duyệt không mã được) ⇒ dự phòng `toDataURL`; chọn bản đầu tiên PNG/JPG/WebP ≤ 150 KB; không bản nào ⇒ ném lỗi có lý do.
import { AVATAR_ENCODINGS, pickAvatarBlob } from "./image";

export type AvatarCanvas = {
  toBlob(cb: (b: Blob | null) => void, type: string, quality: number): void;
  toDataURL(type: string, quality: number): string;
};

const DATA_URL = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]*={0,2})$/;
const bytesOf = (b64: string) =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Một lần thử (loại, chất lượng): `toBlob` rồi `toDataURL`; trả data URL hoặc null (lý do ghi vào `log`). */
async function tryOnce(
  cv: AvatarCanvas,
  readBlob: (b: Blob) => Promise<string>,
  type: string,
  q: number,
  log: string[],
): Promise<string | null> {
  try {
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, type, q));
    if (blob) return await readBlob(blob);
    log.push(`${type}:toBlob null`);
  } catch (e) {
    log.push(`${type}:toBlob ${msg(e)}`);
  }
  try {
    return cv.toDataURL(type, q);
  } catch (e) {
    log.push(`${type}:toDataURL ${msg(e)}`);
    return null;
  }
}

export async function encodeAvatar(
  cv: AvatarCanvas,
  readBlob: (b: Blob) => Promise<string>,
): Promise<string> {
  const log: string[] = [];
  for (const [type, q] of AVATAR_ENCODINGS) {
    const url = await tryOnce(cv, readBlob, type, q, log);
    const m = url ? DATA_URL.exec(url) : null;
    if (!url || !m) {
      log.push(`${type}:không phải data URL`);
      continue;
    }
    const cand = { type: m[1] as string, size: bytesOf(m[2] as string), url };
    if (pickAvatarBlob([cand])) return url;
    log.push(`${type}:${cand.type} ${cand.size}B`);
  }
  throw new Error(`avatar-encode: ${log.join("; ")}`);
}
