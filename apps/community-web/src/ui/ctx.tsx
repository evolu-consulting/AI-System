// Ngữ cảnh app: API, người xem hiện tại, định tuyến hash (#/feed, #/profile, #/settings), toast, làm mới dữ liệu.
import {
  COMMUNITY_ACCENTS,
  type CommunityAccent,
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

export type Route = { name: "feed" | "profile" | "settings"; orgId?: string };

export type Ctx = {
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
  if (!v) throw new Error("Thiếu AppProvider");
  return v;
};

export function parseHash(h: string): Route {
  const [, name, orgId] = h.replace(/^#/, "").split("/");
  if (name === "profile" || name === "settings") return { name, ...(orgId ? { orgId } : {}) };
  return { name: "feed" };
}
export const hashOf = (r: Route): string => `#/${r.name}${r.orgId ? `/${r.orgId}` : ""}`;

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
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [accent, setAccentState] = useState<CommunityAccent>(readAccent);

  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại người xem khi dữ liệu đổi (rev, vd đổi persona)
  useEffect(() => {
    boot.api.getViewer().then(setViewer, () => setViewer(null));
  }, [boot, rev]);
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
    [boot, viewer, rev, bump, route, search, accent, setAccent],
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
