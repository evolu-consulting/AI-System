// HUB-FR-72 · H4a-R14 · phiên Studio (mẫu chat-web, copy-then-own): access token CHỈ trong bộ nhớ; tải trang → refresh
// bằng cookie `ai_rt` một lần (D5); 401 giữa chừng → refresh 1 lần (single-flight + Web Locks), hỏng → sự kiện `expired`.
import type { TokenGrant } from "@ai/contracts";
import { AUTH_BASE } from "../env";
import { ApiError, sendPublic, setAuthHooks } from "../http";

/** `expired` = đang đăng nhập thì refresh hỏng: UI về `/login?next=` + toast `session.expired`. */
export type SessionStatus = "unknown" | "anon" | "authed" | "expired";
export type AuthUser = TokenGrant["user"];
export type SessionState = {
  status: SessionStatus;
  accessToken: string | null;
  user: AuthUser | null;
};
export type SessionEvent = "cleared" | "expired";

export const REFRESH_LOCK_NAME = "ai-studio-refresh";
const SUPERSEDED_RETRY_DELAY_MS = 100;
const INITIAL: SessionState = { status: "unknown", accessToken: null, user: null };

type LockManagerLike = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();
const eventListeners = new Map<SessionEvent, Set<() => void>>();
let ensurePromise: Promise<SessionStatus> | null = null;
let inflight: Promise<TokenGrant> | null = null;

function set(next: SessionState): void {
  state = next;
  for (const l of listeners) l();
}

function emit(event: SessionEvent): void {
  for (const l of eventListeners.get(event) ?? []) l();
}

/** D4: `/auth` khác origin ⇒ cookie `ai_rt` (SameSite=Strict, Path=/auth) không đi kèm → không refresh (tới CR-044). */
export function canRefresh(authBase: string = AUTH_BASE): boolean {
  if (!authBase) return true;
  try {
    return typeof location !== "undefined" && new URL(authBase).origin === location.origin;
  } catch {
    return false;
  }
}

const locks = (): LockManagerLike | null =>
  typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;

const callRefresh = () => sendPublic<TokenGrant>("/auth/refresh", { method: "POST" });

async function refreshWithRetry(): Promise<TokenGrant> {
  try {
    return await callRefresh();
  } catch (err) {
    // Tab khác (Admin/Studio cùng cookie) vừa xoay token → thử lại một lần với cookie mới.
    if (!(err instanceof ApiError) || err.code !== "REFRESH_SUPERSEDED") throw err;
    await new Promise((r) => setTimeout(r, SUPERSEDED_RETRY_DELAY_MS));
    return callRefresh();
  }
}

/** Single-flight trong tab + Web Locks liên tab. */
function refreshGrant(): Promise<TokenGrant> {
  if (inflight) return inflight;
  if (!canRefresh()) return Promise.reject(new ApiError(401, "REFRESH_UNAVAILABLE", "No refresh"));
  const lm = locks();
  const run = lm ? lm.request(REFRESH_LOCK_NAME, refreshWithRetry) : refreshWithRetry();
  const p = run.finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

function applyGrant(grant: TokenGrant): void {
  set({ status: "authed", accessToken: grant.access_token, user: grant.user });
}

const isNetworkError = (err: unknown): boolean =>
  err instanceof ApiError && err.code === "NETWORK_ERROR";

/** Hook refresh của `http`: lỗi mạng ném tiếp (giữ phiên); lỗi khác → xoá phiên + `expired`. */
async function refreshToken(_stale: string | null): Promise<string | null> {
  try {
    const grant = await refreshGrant();
    if (state.status === "authed") applyGrant(grant);
    return grant.access_token;
  } catch (err) {
    if (isNetworkError(err)) throw err;
    if (state.status === "authed") {
      set({ ...INITIAL, status: "expired" });
      emit("expired");
    }
    return null;
  }
}

const installHooks = (): void =>
  setAuthHooks({ getToken: () => state.accessToken, refresh: refreshToken });
installHooks();

/** Tải trang: refresh bằng cookie để biết đã có phiên chưa (guard `_authed`, `/login`). Chỉ gọi API một lần. */
function ensure(): Promise<SessionStatus> {
  if (state.status === "authed" || state.status === "anon") return Promise.resolve(state.status);
  if (state.status === "expired") return Promise.resolve("anon");
  ensurePromise ??= refreshGrant()
    .then(applyGrant)
    .catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
      // Mất mạng lúc khởi động cũng coi như chưa đăng nhập: trang đăng nhập báo lỗi khi gửi.
      set({ ...INITIAL, status: "anon" });
    })
    .then(() => state.status);
  return ensurePromise;
}

/** Đăng xuất: báo admin-api (bỏ qua lỗi) rồi xoá phiên trong bộ nhớ. */
async function logout(): Promise<void> {
  try {
    await sendPublic<void>("/auth/logout", { method: "POST" });
  } catch {
    // phía client vẫn đăng xuất
  }
  set({ ...INITIAL, status: "anon" });
  emit("cleared");
}

export const session = {
  getState: (): SessionState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  on(event: SessionEvent, l: () => void): () => void {
    const bucket = eventListeners.get(event) ?? new Set<() => void>();
    bucket.add(l);
    eventListeners.set(event, bucket);
    return () => bucket.delete(l);
  },
  ensure,
  applyGrant,
  logout,
  /** Chỉ dùng cho test. */
  reset: (): void => {
    installHooks();
    state = INITIAL;
    ensurePromise = null;
    inflight = null;
    listeners.clear();
    eventListeners.clear();
  },
};
