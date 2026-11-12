// CR-138 Q8 · màu chủ đạo công ty: 12 màu đặt sẵn + màu tự chọn `#RRGGBB`. Luật thuần dùng chung (web kiểm trước, server kiểm lại).
// Quy ước tương phản (WCAG AA 4.5:1): màu nhấn vừa là NỀN nút chính (chữ trắng) vừa là CHỮ/liên kết trên nền sáng của panel ⇒ cùng một
// điều kiện «tương phản với trắng ≥ 4.5». Không đạt ⇒ báo và không cho lưu. Giao diện tối được suy ra tự động (sáng hơn tới khi đạt).

/** Thứ tự = dải màu theo sắc độ (hiển thị bảng chọn). */
export const COMPANY_ACCENTS = [
  "indigo",
  "violet",
  "magenta",
  "rose",
  "orange",
  "amber",
  "lime",
  "green",
  "teal",
  "sky",
  "blue",
  "slate",
] as const;
export type CompanyAccent = (typeof COMPANY_ACCENTS)[number];
/** Giá trị lưu ở trường `accent`: khoá màu đặt sẵn hoặc mã màu tự chọn `#rrggbb` (chữ thường). */
export type CompanyAccentValue = CompanyAccent | `#${string}`;

export const ACCENT_HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const ACCENT_MIN_CONTRAST = 4.5;

export const isAccentHex = (v: unknown): v is `#${string}` =>
  typeof v === "string" && ACCENT_HEX_RE.test(v);
export const isAccentPreset = (v: unknown): v is CompanyAccent =>
  (COMPANY_ACCENTS as readonly unknown[]).includes(v);

type Rgb = readonly [number, number, number];
export const hexToRgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
export const rgbToHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b]
    .map((x) =>
      Math.max(0, Math.min(255, Math.round(x)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const chan = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}
/** Tỉ lệ tương phản WCAG 2.x giữa hai màu `#rrggbb` (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Trộn `hex` với `to` theo tỉ lệ `t` (0..1). */
export function mixHex(hex: string, to: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(to);
  return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

export type AccentCheck = { ok: boolean; ratio: number; suggestion: string | null };
/** Kiểm màu tự chọn: tương phản với chữ trắng ≥ 4.5. Không đạt ⇒ gợi ý màu gần nhất (tối dần) đạt chuẩn. */
export function checkAccent(hex: string): AccentCheck {
  if (!isAccentHex(hex)) return { ok: false, ratio: 0, suggestion: null };
  const ratio = contrastRatio(hex, "#ffffff");
  if (ratio >= ACCENT_MIN_CONTRAST) return { ok: true, ratio, suggestion: null };
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = mixHex(hex, "#000000", t);
    if (contrastRatio(c, "#ffffff") >= ACCENT_MIN_CONTRAST)
      return { ok: false, ratio, suggestion: c };
  }
  return { ok: false, ratio, suggestion: "#000000" };
}
