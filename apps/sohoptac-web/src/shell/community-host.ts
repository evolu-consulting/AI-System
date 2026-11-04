// CR-118 · shell cấp cho module Community: router (qua cổng), đăng xuất chung và điều hướng nội bộ sang Sổ Hợp Tác.
import type { AnyRouter } from "@tanstack/react-router";
import { configureCommunityHost } from "~/modules/community/manifest";

let installed: AnyRouter | undefined;

export function installCommunityHost(router: AnyRouter): void {
  if (installed === router) return;
  installed = router;
  const go = (url: string, replace: boolean) => void router.navigate({ href: url, replace });
  configureCommunityHost({
    low: {
      // `searchStr` (chuỗi) — `location.search` của TanStack là object đã parse.
      location: () => {
        const l = router.state.location;
        return { pathname: l.pathname, search: l.searchStr };
      },
      navigate: (url, o) => go(url, o.replace),
      subscribe: (cb) => router.subscribe("onResolved", cb),
    },
    logout: async () => (await import("~/features/auth/api")).logout(), // nạp lười: không kéo api đăng nhập vào bundle đầu
    openContracts: (path) => go(path, false),
    openContractsSettings: (section) =>
      void import("~/features/settings/lib/bus").then((m) => m.openSettings(section as never)),
    contractsHref: (path) => path,
  });
}
