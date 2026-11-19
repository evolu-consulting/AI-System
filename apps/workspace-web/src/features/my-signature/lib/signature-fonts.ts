// CR-188 · BR-188-3 · sáu phông cho «Gõ họ tên», tự host ở `public/fonts/` (OFL, kèm `OFL*.txt`). Mỗi phông đã kiểm đủ glyph tiếng Việt có dấu
// (test `signature-fonts.test.ts` đọc bảng cmap của tệp). Nạp lười: chỉ tải tệp của phông đang chọn, mỗi phông một lần.

export const SIGNATURE_FONTS = [
  { key: "dancing", family: "Dancing Script", file: "DancingScript.ttf", weight: 600 },
  { key: "pacifico", family: "Pacifico", file: "Pacifico.ttf", weight: 400 },
  { key: "greatvibes", family: "Great Vibes", file: "GreatVibes.ttf", weight: 400 },
  { key: "allura", family: "Allura", file: "Allura.ttf", weight: 400 },
  { key: "lobster", family: "Lobster", file: "Lobster.ttf", weight: 400 },
  { key: "charm", family: "Charm", file: "Charm.ttf", weight: 400 },
] as const;
export type SignatureFont = (typeof SIGNATURE_FONTS)[number];
export type FontKey = SignatureFont["key"];
export const DEFAULT_FONT: FontKey = "dancing";

export const fontOf = (key: FontKey): SignatureFont =>
  SIGNATURE_FONTS.find((f) => f.key === key) ?? (SIGNATURE_FONTS[0] as SignatureFont);

/** Giá trị `ctx.font` / CSS cho một phông ở cỡ `px`; có dự phòng chữ viết tay hệ thống. */
export const fontCss = (key: FontKey, px: number): string => {
  const f = fontOf(key);
  return `${f.weight} ${px}px "${f.family}", "Segoe Script", cursive`;
};

const loading = new Map<FontKey, Promise<void>>();
/** Nạp một phông (một lần cho mỗi phông); lỗi ⇒ dùng chữ viết tay hệ thống, không chặn tạo chữ ký. */
export function loadSignatureFont(key: FontKey = DEFAULT_FONT): Promise<void> {
  const f = fontOf(key);
  let p = loading.get(f.key);
  if (!p) {
    p = (async () => {
      try {
        const face = new FontFace(f.family, `url(/fonts/${f.file})`, { weight: "400 700" });
        document.fonts.add(await face.load());
      } catch {
        /* dùng phông dự phòng */
      }
    })();
    loading.set(f.key, p);
  }
  return p;
}
