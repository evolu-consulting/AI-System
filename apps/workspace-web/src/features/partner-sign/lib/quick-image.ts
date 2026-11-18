// CR-182 · ảnh chữ ký nhanh của đối tác: PNG nét đen (gửi lên) → ảnh màu xanh để đặt vào khay (xem trước giống bản in). Nhớ trong phiên trình duyệt theo link.
import { recolor } from "~/features/my-signature/lib/signature-image";

/** Khoá sessionStorage = SHA-256 (hex) của token — KHÔNG chứa token thô (token đủ để ký thay đối tác). Không có `crypto.subtle` (http không an toàn) ⇒ null ⇒ không nhớ. */
export async function imageKey(token: string): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return `psign:img:${[...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

export const blobToBase64 = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });

/** PNG đen → data URL màu xanh (khay + ô). */
export async function blueDataUrl(png: Blob): Promise<string> {
  const bmp = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")?.drawImage(bmp, 0, 0);
  return recolor(c, "blue").toDataURL("image/png");
}

export const rememberImage = async (token: string, url: string) => {
  try {
    const k = await imageKey(token);
    if (k) sessionStorage.setItem(k, url);
  } catch {
    // đầy / bị chặn: bỏ qua, lần sau tạo lại
  }
};
export const recallImage = async (token: string): Promise<string | null> => {
  try {
    const k = await imageKey(token);
    return k ? sessionStorage.getItem(k) : null;
  } catch {
    return null;
  }
};
