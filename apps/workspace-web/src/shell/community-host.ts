// CR-118 · shell cấp cho module Community: router (qua cổng), đăng xuất chung và điều hướng nội bộ sang Sổ Hợp Tác.
import type { AnyRouter } from "@tanstack/react-router";
import { brandStore, DEFAULT_BRAND } from "~/features/settings/lib/brand";
import { configureCommunityHost } from "~/modules/community/manifest";
import { setDevIdentity } from "./dev-identity";
import { COMMUNITY_MOCK } from "./mock-flag";
import { topbarSlots } from "./topbar-slots";

/** Hằng lúc build (rsbuild define): mock Community (dev/e2e không backend). */
const MOCK = COMMUNITY_MOCK;

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
    // CR-120: khe thanh trên dùng chung (ô tìm + chuông của Community vẽ vào AppShell bằng portal).
    slots: { get: (name) => topbarSlots.get(name), subscribe: (cb) => topbarSlots.subscribe(cb) },
    // Chỉ bản mock: nhân vật đang xem cấp danh tính + gói cho AppShell (bản http dùng phiên + /pack/me).
    reportViewer: (v) => {
      // Brand chủ quản cho người chưa có brand riêng (đối tác không có gói contracts ⇒ không có /company): nhận diện = công ty chủ quản.
      if (v && brandStore.get() === DEFAULT_BRAND)
        brandStore.setSaved({ ...DEFAULT_BRAND, name: v.brand.name, logo: v.brand.logo });
      if (!MOCK) return;
      setDevIdentity(
        v && {
          user: {
            display_name: v.name,
            username: v.name,
            email: null,
            tenant: { name: v.brand.name },
            role: v.isHost ? "member" : "partner",
          },
          packs: { contracts: v.contracts, community: true },
        },
      );
    },
  });
}
