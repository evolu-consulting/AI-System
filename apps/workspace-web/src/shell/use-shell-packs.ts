// CR-120 · gói mà người dùng mở được (cờ FeatureGate theo manifest, trừ gói máy chủ chặn) — nguồn duy nhất cho menu trái, thanh dưới và menu tài khoản.
import { useMemo } from "react";
import { useSession } from "~/features/auth/hooks/use-session";
import { useFeatures } from "~/platform/features";
import { useDevIdentity } from "./dev-identity";
import { MODULE_PACKS, PACK_FALLBACKS } from "./modules";
import { useBlockedPacks } from "./pack-block";

/** Người xem là user ngoài (đối tác): chỉ có Bảng tin — không gói Sổ Hợp Tác, không `/me/stream`, `/pack/nav`, `/pack/contracts/*` (Hub trả 403). */
export const useIsExternal = (): boolean => useSession((s) => s.me?.kind === "external");

/** Cờ gói của người xem: user ngoài KHÔNG bao giờ có `contracts` (kể cả khi mặc định `contracts` bật trước khi tải `/pack/me`). */
export const packsFor = (
  flags: Readonly<Record<string, boolean>>,
  external: boolean,
): Record<string, boolean> => (external ? { ...flags, contracts: false } : { ...flags });

export function useShellPacks(): Readonly<Record<string, boolean>> {
  const flags = useFeatures(MODULE_PACKS, PACK_FALLBACKS);
  const dev = useDevIdentity();
  const blocked = useBlockedPacks();
  const external = useIsExternal();
  return useMemo(() => {
    const base = packsFor(flags, external);
    const out: Record<string, boolean> = dev ? { ...base, ...dev.packs } : base;
    for (const k of blocked) out[k] = false;
    return out;
  }, [flags, dev, blocked, external]);
}
