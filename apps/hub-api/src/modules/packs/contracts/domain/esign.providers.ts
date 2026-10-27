// esign-multi · luật thuần registry nhà cung cấp ký số: env `ESIGN_PROVIDERS` (danh sách, theo thứ tự) — tương thích ngược
// `ESIGN_PROVIDER=x` ⇒ `[x]`. Mỗi nhà cung cấp "khả dụng" khi đủ cấu hình (docusign: đủ biến DOCUSIGN_*; selfsign: luôn; misa: chưa có
// adapter ⇒ chưa khả dụng). Thêm nhà cung cấp mới = một mục `PROVIDER_META` + một nhánh trong `esign.mount.ts` (adapter).
import { docusignConfigOf } from "./esign.rules";

type Env = Record<string, string | undefined>;
/** Khớp `ESignProviderKind` của contract. */
export type ESignProviderKind = "envelope" | "ca";

export type ProviderMeta = { label: string; kind: ESignProviderKind; legal: boolean };

/** Nhà cung cấp biết tên (thứ tự ở đây KHÔNG quyết định thứ tự — env quyết định). */
export const PROVIDER_META: Record<string, ProviderMeta> = {
  docusign: { label: "DocuSign", kind: "envelope", legal: true },
  selfsign: { label: "Ký thử", kind: "ca", legal: false },
  misa: { label: "MISA eSign", kind: "ca", legal: true },
};

/** Meta của khoá (khoá lạ — vd `fake` của test — ⇒ nhãn = khoá, loại envelope, pháp lý theo `demo`). */
export const metaOf = (key: string, demo = false): ProviderMeta =>
  PROVIDER_META[key] ?? { label: key, kind: "envelope", legal: !demo };

/** Danh sách khoá theo env (đã chuẩn hoá: thường, bỏ trống/trùng/lạ/`none`). */
export function providerKeysOf(env: Env): string[] {
  const raw = env.ESIGN_PROVIDERS?.trim() ? env.ESIGN_PROVIDERS : (env.ESIGN_PROVIDER ?? "");
  const out: string[] = [];
  for (const k of raw.split(",").map((x) => x.trim().toLowerCase())) {
    if (k in PROVIDER_META && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Đủ cấu hình ở server? */
export function providerAvailable(key: string, env: Env): boolean {
  if (key === "selfsign") return true;
  if (key === "docusign") return docusignConfigOf(env) !== null;
  return false; // misa: chưa có adapter (lát sau khi có Client ID)
}

export type ProviderEntry = ProviderMeta & { key: string; available: boolean };

export function providerEntriesOf(env: Env): ProviderEntry[] {
  return providerKeysOf(env).map((key) => ({
    key,
    ...metaOf(key),
    available: providerAvailable(key, env),
  }));
}

/** Mặc định hiệu lực: đã chọn và còn khả dụng; vắng/không khả dụng ⇒ khả dụng đầu tiên theo thứ tự; không có ⇒ null. */
export function effectiveDefault(
  entries: readonly { key: string; available: boolean }[],
  chosen: string | null,
): string | null {
  if (chosen && entries.some((e) => e.key === chosen && e.available)) return chosen;
  return entries.find((e) => e.available)?.key ?? null;
}
