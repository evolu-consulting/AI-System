// Ngữ cảnh app: API, người xem hiện tại, định tuyến qua RouterPort (app chủ cấp), toast, làm mới dữ liệu.
import type { CommunityBrand, CommunityViewer } from "@ai/contracts/community";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type BrandView, toBrandView } from "../domain/brand";
import type { Route } from "../domain/route";
import type { CommunityHost } from "./host";
import type { CommunityApi, RouterPort } from "./ports";
import type { Api } from "./runtime";

export type { Route } from "../domain/route";

export type Ctx = {
  /** Brand công ty chủ quản (topbar + màu nhấn); chưa tải/lỗi ⇒ chữ cái đầu + indigo. */
  brand: BrandView;
  /** Màu nhấn công ty chủ quản (`data-accent`), cho phần tử vẽ ngoài cây trang (khe thanh trên). */
  brandAccent: string;
  /** Hộp thoại Cài đặt chung (mở từ user-menu hoặc `?settings=1`); không phải route. */
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  api: CommunityApi;
  viewer: CommunityViewer;
  personas: Api["personas"];
  setPersona: (id: string) => void;
  /** Tăng sau mỗi thay đổi dữ liệu: các màn nạp lại. */
  rev: number;
  bump: () => void;
  route: Route;
  go: (r: Route) => void;
  href: (r: Route) => string;
  /** Đăng xuất phiên chung / mở Sổ Hợp Tác trong app (host cấp). */
  logout: () => Promise<void>;
  openContracts: (path: string) => void;
  openContractsSettings: (section: string) => void;
  contractsHref: (path: string) => string;
  search: string;
  setSearch: (s: string) => void;
  toast: (msg: string) => void;
  isHostViewer: boolean;
};

const C = createContext<Ctx | null>(null);
export const useApp = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error("Thiếu AppProvider"); // i18n-ignore: lỗi lập trình
  return v;
};

export function AppProvider({
  boot,
  host,
  children,
}: {
  boot: Api;
  host: CommunityHost;
  children: ReactNode;
}) {
  const router: RouterPort = host.router;
  const [viewer, setViewer] = useState<CommunityViewer | null>(null);
  const [rev, setRev] = useState(0);
  const [route, setRoute] = useState<Route>(() => router.read().route);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => router.read().settings);
  const [brandRaw, setBrandRaw] = useState<CommunityBrand | null>(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(
    () =>
      router.subscribe(() => {
        const p = router.read();
        setRoute(p.route);
        if (p.settings) setSettingsOpen(true);
      }),
    [router],
  );
  // D8: màu nhấn = màu công ty chủ quản (token `data-accent`); chưa có brand ⇒ indigo. Không còn lựa chọn theo người dùng.
  const brandAccent = brandRaw?.accent ?? "indigo";
  // Tiêu đề tab = tên công ty chủ quản (đối tác không thấy tên sản phẩm SHT trong tab).
  const brandName = viewer ? toBrandView(brandRaw, viewer.orgName).name : null;
  useEffect(() => {
    if (brandName) document.title = brandName;
  }, [brandName]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại người xem khi dữ liệu đổi (rev, vd đổi persona)
  useEffect(() => {
    boot.api.getViewer().then(setViewer, () => setViewer(null));
  }, [boot, rev]);
  // CR-120: báo shell người xem (mock: cấp danh tính + gói cho AppShell; http: bỏ qua).
  const brandView = viewer ? toBrandView(brandRaw, viewer.orgName) : null;
  const brandNameOut = brandView?.name ?? null;
  const brandLogoOut = brandView?.logo ?? null;
  useEffect(() => {
    host.reportViewer(
      viewer && {
        name: viewer.name,
        orgName: viewer.orgName,
        isHost: viewer.role !== "partner",
        contracts: viewer.caps.contracts,
        brand: { name: brandNameOut ?? viewer.orgName, logo: brandLogoOut },
      },
    );
  }, [host, viewer, brandNameOut, brandLogoOut]);
  const viewerId = viewer?.userId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: brand theo tenant; nạp lại khi đổi người xem (persona)
  useEffect(() => {
    boot.api.getBrand().then(setBrandRaw, () => setBrandRaw(null));
  }, [boot, viewerId]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    // Link `?settings=1` ⇒ đóng hộp thoại về Bảng tin (không thêm mục lịch sử).
    if (router.read().settings) router.replace({ name: "feed" });
  }, [router]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  const bump = useCallback(() => setRev((n) => n + 1), []);
  const value = useMemo<Ctx | null>(
    () =>
      viewer && {
        brand: toBrandView(brandRaw, viewer.orgName),
        brandAccent,
        settingsOpen,
        openSettings,
        closeSettings,
        api: boot.api,
        viewer,
        personas: boot.personas,
        setPersona: (id) => {
          boot.setPersona?.(id);
          router.go({ name: "feed" });
          setRev((n) => n + 1);
        },
        rev,
        bump,
        route,
        go: router.go,
        href: router.href,
        logout: host.logout,
        openContracts: host.openContracts,
        openContractsSettings: host.openContractsSettings,
        contractsHref: host.contractsHref,
        search,
        setSearch,
        toast: setMsg,
        isHostViewer: viewer.role !== "partner",
      },
    [
      boot,
      router,
      host,
      viewer,
      rev,
      bump,
      route,
      search,
      brandRaw,
      brandAccent,
      settingsOpen,
      openSettings,
      closeSettings,
    ],
  );
  if (!value)
    return (
      <div data-mod="community" data-accent={brandAccent}>
        <div className="app" aria-busy="true" />
      </div>
    );
  return (
    <C.Provider value={value}>
      <div data-mod="community" data-accent={brandAccent}>
        {children}
        {msg && (
          <div className="toast" role="status">
            {msg}
          </div>
        )}
      </div>
    </C.Provider>
  );
}
