// CR-120 · gói mà người dùng mở được (cờ FeatureGate theo manifest, trừ gói máy chủ chặn) — nguồn duy nhất cho menu trái, thanh dưới và menu tài khoản.
import { useMemo } from "react";
import { useFeatures } from "~/platform/features";
import { useDevIdentity } from "./dev-identity";
import { MODULE_PACKS, PACK_FALLBACKS } from "./modules";
import { useBlockedPacks } from "./pack-block";

export function useShellPacks(): Readonly<Record<string, boolean>> {
  const flags = useFeatures(MODULE_PACKS, PACK_FALLBACKS);
  const dev = useDevIdentity();
  const blocked = useBlockedPacks();
  return useMemo(() => {
    const out: Record<string, boolean> = dev ? { ...flags, ...dev.packs } : { ...flags };
    for (const k of blocked) out[k] = false;
    return out;
  }, [flags, dev, blocked]);
}
