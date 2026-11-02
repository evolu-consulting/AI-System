// Ngữ cảnh app: API, người xem hiện tại, định tuyến hash (#/feed, #/profile, #/settings), toast, làm mới dữ liệu.
import {
  COMMUNITY_ACCENTS,
  type CommunityAccent,
  type CommunityBrand,
  type CommunityViewer,
} from "@ai/contracts/community";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Api } from "../api";
import type { CommunityApi } from "../api/client";
import { type BrandView, toBrandView } from "../lib/brand";
import { hashOf, parseLocation, type Route } from "../lib/route";

export { hashOf, parseHash, type Route } from "../lib/route";

export type Ctx = {
  /** Brand công ty chủ quản (topbar + màu nhấn); chưa tải/lỗi ⇒ chữ cái đầu + indigo. */
  brand: BrandView;
  /** Hộp thoại Cài đặt chung (mở từ user-menu hoặc `#/settings`); không phải route. */
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
  search: string;
  setSearch: (s: string) => void;
  toast: (msg: string) => void;
  isHostViewer: boolean;
  accent: CommunityAccent;
  setAccent: (a: CommunityAccent) => void;
};

const C = createContext<Ctx | null>(null);
export const useApp = (): Ctx => {
  const v = useContext(C);
  if (!v) throw new Error("Thiếu AppProvider"); // i18n-ignore: lỗi lập trình
  return v;
};

const ACCENT_KEY = "community.accent";
const readAccent = (): CommunityAccent => {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    return (COMMUNITY_ACCENTS as readonly string[]).includes(v ?? "")
      ? (v as CommunityAccent)
      : "indigo";
  } catch {
    return "indigo";
  }
};

export function AppProvider({ boot, children }: { boot: Api; children: ReactNode }) {
  const [viewer, setViewer] = useState<CommunityViewer | null>(null);
  const [rev, setRev] = useState(0);
  const [route, setRoute] = useState<Route>(() => parseLocation(location.hash).route);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(
    () => parseLocation(location.hash).settings,
  );
  const [brandRaw, setBrandRaw] = useState<CommunityBrand | null>(null);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [accent, setAccentState] = useState<CommunityAccent>(readAccent);

  useEffect(() => {
    const on = () => {
      const p = parseLocation(location.hash);
      setRoute(p.route);
      if (p.settings) setSettingsOpen(true);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  // Màu nhấn = màu công ty chủ quản (token `data-accent`); chưa có brand ⇒ giữ lựa chọn cũ/indigo.
  const brandAccent = brandRaw?.accent;
  useEffect(() => {
    document.documentElement.dataset.accent = brandAccent ?? accent;
  }, [accent, brandAccent]);
  // Tiêu đề tab = tên công ty chủ quản (đối tác không thấy tên sản phẩm SHT trong tab).
  const brandName = viewer ? toBrandView(brandRaw, viewer.orgName).name : null;
  useEffect(() => {
    if (brandName) document.title = brandName;
  }, [brandName]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại người xem khi dữ liệu đổi (rev, vd đổi persona)
  useEffect(() => {
    boot.api.getViewer().then(setViewer, () => setViewer(null));
  }, [boot, rev]);
  const viewerId = viewer?.userId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: brand theo tenant; nạp lại khi đổi người xem (persona)
  useEffect(() => {
    boot.api.getBrand().then(setBrandRaw, () => setBrandRaw(null));
  }, [boot, viewerId]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    // Link cũ `#/settings` ⇒ đóng hộp thoại về Bảng tin (không thêm mục lịch sử).
    if (parseLocation(location.hash).settings) history.replaceState(null, "", "#/feed");
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2500);
    return () => clearTimeout(t);
  }, [msg]);

  const bump = useCallback(() => setRev((n) => n + 1), []);
  const setAccent = useCallback((a: CommunityAccent) => {
    setAccentState(a);
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {
      /* không lưu được: vẫn đổi trong phiên */
    }
  }, []);
  const value = useMemo<Ctx | null>(
    () =>
      viewer && {
        brand: toBrandView(brandRaw, viewer.orgName),
        settingsOpen,
        openSettings,
        closeSettings,
        api: boot.api,
        viewer,
        personas: boot.personas,
        setPersona: (id) => {
          boot.setPersona?.(id);
          location.hash = "#/feed";
          setRev((n) => n + 1);
        },
        rev,
        bump,
        route,
        go: (r) => {
          location.hash = hashOf(r);
        },
        search,
        setSearch,
        toast: setMsg,
        isHostViewer: viewer.role !== "partner",
        accent,
        setAccent,
      },
    [
      boot,
      viewer,
      rev,
      bump,
      route,
      search,
      accent,
      setAccent,
      brandRaw,
      settingsOpen,
      openSettings,
      closeSettings,
    ],
  );
  if (!value) return <div className="app" aria-busy="true" />;
  return (
    <C.Provider value={value}>
      {children}
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
    </C.Provider>
  );
}
