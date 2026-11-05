// CR-120 · gói bị chặn theo máy chủ (vd `/pack/contracts/me`: actions rỗng ⇒ PACK_FORBIDDEN, hoặc chưa bật ⇒ PACK_DISABLED): menu trái /
// thanh dưới KHÔNG hiện mục nghiệp vụ của gói đó (như trước CR-120, khi cổng gói chặn cả khung). Cờ FeatureGate vẫn là nguồn "có gói".
import { useSyncExternalStore } from "react";

let blocked: readonly string[] = [];
const subs = new Set<() => void>();

export function setBlockedPacks(next: readonly string[]): void {
  if (next.length === blocked.length && next.every((k, i) => k === blocked[i])) return;
  blocked = next;
  for (const f of subs) f();
}

export const useBlockedPacks = (): readonly string[] =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => blocked,
    () => [],
  );
