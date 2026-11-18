// CR-182 · ảnh chữ ký nhanh của đối tác: PNG nét đen (gửi lên) → ảnh màu xanh để đặt vào khay (xem trước giống bản in). Nhớ trong phiên trình duyệt theo link.
import { recolor } from "~/features/my-signature/lib/signature-image";

const key = (token: string) => `psign:img:${token}`;

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

export const rememberImage = (token: string, url: string) => {
  try {
    sessionStorage.setItem(key(token), url);
  } catch {
    // đầy / bị chặn: bỏ qua, lần sau tạo lại
  }
};
export const recallImage = (token: string): string | null => {
  try {
    return sessionStorage.getItem(key(token));
  } catch {
    return null;
  }
};
