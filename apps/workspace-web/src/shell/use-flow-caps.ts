// CR-120 · quyền động của menu Community: vai + khe đã bật do SERVER tính (`GET /pack/community/flows/nav`, một yêu cầu) — shell không đoán.
// Lỗi/chưa tải ⇒ không có mục nào (fail-closed). Tải lại khi đổi trang trong /community (khe có thể vừa được bật).
import type { FlowNav } from "@ai/contracts/community";
import { api } from "@ai/web-kit/http";
import { useCallback, useEffect, useState } from "react";
import type { HasCap } from "./nav";

/** Thuần: từ kết quả server sang tập khoá `cap` của manifest. */
export function capsOf(n: FlowNav | null): ReadonlySet<string> {
  const out = new Set<string>();
  if (!n) return out;
  if (n.moderationQueue) out.add("community.review");
  if (n.joinSubmit || n.joinReview) out.add("community.join");
  if (n.reports) out.add("community.reports");
  return out;
}

export function useFlowCaps(enabled: boolean, pathname: string): HasCap {
  const [caps, setCaps] = useState<ReadonlySet<string>>(() => new Set());
  const inCommunity = pathname === "/community" || pathname.startsWith("/community/");
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi đổi trang trong module
  useEffect(() => {
    if (!enabled) {
      setCaps(new Set());
      return;
    }
    let live = true;
    api<FlowNav>("/pack/community/flows/nav").then(
      (n) => live && setCaps(capsOf(n)),
      () => live && setCaps(new Set()),
    );
    return () => {
      live = false;
    };
  }, [enabled, inCommunity ? pathname : ""]);
  return useCallback((cap: string) => caps.has(cap), [caps]);
}
