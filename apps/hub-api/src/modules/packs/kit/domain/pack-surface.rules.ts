// CR-130 · ADR-0044 · luật thuần "mặt API" (surface) do một gói sở hữu. Mặt `community` (`/pack/community/*`, Bảng tin) KHÔNG phải gói
// quyền: quyền = quyền gói chủ (`contracts`), bật/tắt = add-on của mặt (`contracts-community`, admin nền tảng bật). Đối tác không
// bao giờ nhận quyền gói chủ — chỉ `EXTERNAL_SURFACES` (external-access.rules). Lớp 1: chỉ built-in.
import type { PackAction } from "./pack-access.rules";

export type PackSurface = { readonly pack: string; readonly addon: string };

export const PACK_SURFACES: Readonly<Record<string, PackSurface>> = Object.freeze({
  community: Object.freeze({ pack: "contracts", addon: "contracts-community" }),
});

/** Mặt API có khoá `key` (undefined = `key` là gói thường). */
export const surfaceOf = (key: string): PackSurface | undefined =>
  Object.hasOwn(PACK_SURFACES, key) ? PACK_SURFACES[key] : undefined;

/** Feature quyết "công ty có khe/mặt này": gói thường `<k>-read`; mặt API = add-on của mặt (ADR-0044). */
export const slotFeatureKey = (packKey: string): string =>
  surfaceOf(packKey)?.addon ?? `${packKey}-read`;

/** Việc nội bộ được làm trên mặt: bất kỳ quyền gói chủ ⇒ đọc + ghi; KHÔNG có `admin` (bản cơ bản, không quyền riêng). */
export const INTERNAL_SURFACE_ACTIONS: readonly PackAction[] = Object.freeze([
  "read",
  "write",
] as const);
