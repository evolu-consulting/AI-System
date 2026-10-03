// CHAT-AC-01, CHAT-AC-03 · phiên chat (rút gọn từ admin-web): access token CHỈ trong bộ nhớ, refresh bằng cookie httpOnly.
// Chat không có bước đổi mật khẩu / 2FA: `password_change_required` / `totp_required` trả về cho LoginPage (alert `chat.login.useAdmin`).
import type { LoginRequest, LoginResponse, Me, TokenGrant } from "@ai/contracts/chat";
import { ApiError, sendPublic, setAuthHooks } from "../http";
import { DRAFT_KEY_PREFIX, removeLocalByPrefix } from "../storage";
import { type AuthMessage, createAuthChannel } from "./auth-channel";
import { createRefresher, type RefreshResult } from "./refresh-lock";

/** `expired` = đang đăng nhập thì refresh hỏng: phiên đã xoá, UI về `/login?next=` + toast `chat.session.expired`. */
export type SessionStatus = "unknown" | "anon" | "authed" | "expired";
export type SessionState = { status: SessionStatus; accessToken: string | null; me: Me | null };
/** `cleared` = đăng xuất (tab này hoặc tab khác); `expired` = refresh hỏng giữa phiên. */
export type SessionEvent = "cleared" | "expired";

const INITIAL: SessionState = { status: "unknown", accessToken: null, me: null };

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();
const eventListeners = new Map<SessionEvent, Set<() => void>>();
const channel = createAuthChannel();
let ensurePromise: Promise<SessionStatus> | null = null;

function set(next: SessionState): void {
  state = next;
  for (const l of listeners) l();
}

/** Phiên kết thúc (đăng xuất / hết hạn) → xoá nháp ô nhập (review C1 #2) rồi báo listener. */
function emit(event: SessionEvent): void {
  removeLocalByPrefix(DRAFT_KEY_PREFIX);
  for (const l of eventListeners.get(event) ?? []) l();
}

const makeRefresher = () =>
  createRefresher({
    callRefresh: async (): Promise<RefreshResult> => {
      const grant = await sendPublic<TokenGrant>("/auth/refresh", { method: "POST" });
      return { accessToken: grant.access_token, me: grant.user };
    },
    locks: typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null,
    broadcast: (accessToken, at, sub) => channel.post({ type: "token", accessToken, at, sub }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
let refresher = makeRefresher();

function clearLocal(): void {
  set({ ...INITIAL, status: "anon" });
  emit("cleared");
}

/** Thông điệp tab khác. Token của user khác (`sub` ≠ `me.id`: tab kia đăng nhập tài khoản khác, cookie đã đổi chủ)
 *  → xoá phiên tab này thay vì ghép token mới với `me` cũ (review C1 #5). */
function receive(msg: AuthMessage): void {
  if (msg.type === "logout") {
    if (state.status !== "anon") clearLocal();
    return;
  }
  if (msg.sub && state.me && msg.sub !== state.me.id) {
    if (state.status !== "anon") clearLocal();
    return;
  }
  refresher.receive(msg.accessToken, msg.at);
  if (state.status === "authed") set({ ...state, accessToken: msg.accessToken });
}

channel.subscribe(receive);

function applyGrant(grant: TokenGrant): void {
  set({ status: "authed", accessToken: grant.access_token, me: grant.user });
}

const isNetworkError = (err: unknown): boolean =>
  err instanceof ApiError && err.code === "NETWORK_ERROR";

/** Hook refresh của `http`: lỗi mạng ném tiếp (giữ phiên, UI báo Hub sập); lỗi khác → xoá phiên + `expired`. */
async function refreshToken(stale: string | null): Promise<string | null> {
  try {
    const r = await refresher.refresh({ stale, allowShared: true });
    if (state.status === "authed")
      set({ ...state, accessToken: r.accessToken, me: r.me ?? state.me });
    return r.accessToken;
  } catch (err) {
    if (isNetworkError(err)) throw err;
    if (state.status === "authed") {
      set({ ...INITIAL, status: "expired" });
      emit("expired");
    }
    return null;
  }
}

setAuthHooks({ getToken: () => state.accessToken, refresh: refreshToken });

/** Khi tải trang: refresh bằng cookie để biết đã đăng nhập chưa (guard `_authed`). */
async function ensure(): Promise<SessionStatus> {
  if (state.status !== "unknown") return state.status;
  ensurePromise ??= refresher
    .refresh({ stale: null, allowShared: false })
    .then((r) => set({ status: "authed", accessToken: r.accessToken, me: r.me }))
    .catch((err: unknown) => {
      // Mất mạng lúc khởi động cũng coi như chưa đăng nhập: trang login xử lý tiếp.
      if (!(err instanceof ApiError)) throw err;
      set({ ...INITIAL, status: "anon" });
    })
    .then(() => state.status);
  return ensurePromise;
}

async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await sendPublic<LoginResponse>("/auth/login", { method: "POST", body: req });
  if (res.status === "authenticated") applyGrant(res);
  return res;
}

async function logout(): Promise<void> {
  try {
    await sendPublic<void>("/auth/logout", { method: "POST" });
  } catch {
    // đăng xuất phía client vẫn tiếp tục
  }
  channel.post({ type: "logout" });
  clearLocal();
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
  login,
  logout,
  applyGrant,
  /** Chỉ dùng cho test: giả thông điệp BroadcastChannel từ tab khác. */
  receive,
  /** Chỉ dùng cho test. */
  reset: (): void => {
    state = INITIAL;
    ensurePromise = null;
    refresher = makeRefresher();
  },
};
