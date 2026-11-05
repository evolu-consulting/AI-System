// CR-120 · quyền động của menu: vai + khe đã bật do SERVER tính (`GET /pack/community/flows/nav`, MỘT yêu cầu cho CẢ HAI app) — shell không đoán.
// CR-121 C-7 · cùng yêu cầu đó trả số đếm cho mọi mục hàng việc (badge) + mục "Chờ tôi duyệt" của Sổ Hợp Tác.
// Lỗi/chưa tải ⇒ không có mục nào (fail-closed). Tải lại: đổi trang trong /community, quay lại tab, hoặc sau một thao tác duyệt
// (`notifyFlowNavChanged`) — KHÔNG poll.
import type { PackNavResponse } from "@ai/contracts/packs";
import { api } from "@ai/web-kit/http";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FLOW_NAV_CHANGED } from "~/shared/kernel/flow-nav-event";
import type { HasCap } from "./nav";

/** Khoá `cap` của manifest (một nguồn: manifest Community / Sổ Hợp Tác dùng đúng các chuỗi này). */
export const CAP = {
  communityReview: "community.review",
  communityJoin: "community.join",
  communityReports: "community.reports",
  contractsReview: "contracts.review",
} as const;

/** Thuần: từ kết quả server (`GET /pack/nav`) sang tập khoá `cap` của manifest. */
export function capsOf(n: PackNavResponse | null): ReadonlySet<string> {
  return new Set((n?.items ?? []).map((i) => i.cap));
}

/** Thuần: số chờ của từng `cap` (chỉ cap người xem thấy). Không số/âm ⇒ 0. */
export function badgesOf(n: PackNavResponse | null): ReadonlyMap<string, number> {
  return new Map(
    (n?.items ?? []).map((i) => [
      i.cap,
      typeof i.count === "number" && i.count > 0 ? Math.floor(i.count) : 0,
    ]),
  );
}
/** Thuần: chữ trên badge — 0 ⇒ không hiện (null); trên 99 ⇒ "99+". */
export function badgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

export type FlowNavState = { hasCap: HasCap; badgeOf: (cap: string) => number };

export function useFlowCaps(enabled: boolean, pathname: string): FlowNavState {
  const [nav, setNav] = useState<PackNavResponse | null>(null);
  const inCommunity = pathname === "/community" || pathname.startsWith("/community/");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setTick((x) => x + 1);
    const onVisible = () => document.visibilityState === "visible" && bump();
    window.addEventListener(FLOW_NAV_CHANGED, bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(FLOW_NAV_CHANGED, bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi đổi trang trong module / có tín hiệu tick
  useEffect(() => {
    if (!enabled) {
      setNav(null);
      return;
    }
    let live = true;
    api<PackNavResponse>("/pack/nav").then(
      (n) => live && setNav(n),
      () => live && setNav(null),
    );
    return () => {
      live = false;
    };
  }, [enabled, inCommunity ? pathname : "", tick]);
  const caps = useMemo(() => capsOf(nav), [nav]);
  const badges = useMemo(() => badgesOf(nav), [nav]);
  const hasCap = useCallback((cap: string) => caps.has(cap), [caps]);
  const badgeOf = useCallback((cap: string) => badges.get(cap) ?? 0, [badges]);
  return useMemo(() => ({ hasCap, badgeOf }), [hasCap, badgeOf]);
}
