// CR-120 · CHỈ bản dựng mock Community (PUBLIC_COMMUNITY_API=mock, dev/e2e không backend): không có phiên /pack/me, nên "nhân vật" đang
// xem (persona) của adapter mock cấp cho AppShell tên người dùng + gói được mở. Bản http không bao giờ gọi `setDevIdentity`.
import { useSyncExternalStore } from "react";

export type DevIdentity = {
  user: {
    display_name: string;
    username: string;
    email: string | null;
    tenant: { name: string };
    role?: string;
  };
  packs: Readonly<Record<string, boolean>>;
};

let cur: DevIdentity | null = null;
const subs = new Set<() => void>();

export function setDevIdentity(next: DevIdentity | null): void {
  cur = next;
  for (const f of subs) f();
}

export const useDevIdentity = (): DevIdentity | null =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => cur,
    () => null,
  );
