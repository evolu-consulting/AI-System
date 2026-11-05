// CR-120 · gói mà người dùng mở được (cờ FeatureGate theo manifest) — nguồn duy nhất cho menu trái, thanh dưới và menu tài khoản.
import { useMemo } from "react";
import { useFeatures } from "~/platform/features";
import { useDevIdentity } from "./dev-identity";
import { MODULE_PACKS, PACK_FALLBACKS } from "./modules";

export function useShellPacks(): Readonly<Record<string, boolean>> {
  const flags = useFeatures(MODULE_PACKS, PACK_FALLBACKS);
  const dev = useDevIdentity();
  return useMemo(() => (dev ? { ...flags, ...dev.packs } : flags), [flags, dev]);
}
