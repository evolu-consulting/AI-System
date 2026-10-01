// ADM-FR-01, ADM-FR-02, ADM-FR-03 · phiên đăng nhập: access token CHỈ trong bộ nhớ (D5), refresh bằng cookie httpOnly.
import type { LoginRequest, LoginResponse, Me, TokenGrant } from "@ai/contracts";
import { type AuthMessage, createAuthChannel } from "./auth-channel";
import { ApiError, api, sendPublic, setAuthHooks } from "./http";
import { createRefresher, type RefreshResult } from "./refresh-lock";

export type SessionStatus = "unknown" | "anon" | "authed" | "expired";
export type PendingChange = { changeToken: string; tenantKey: string; username: string };
export type SessionState = {
  status: SessionStatus;
  accessToken: string | null;
  me: Me | null;
  /** Đăng nhập lần đầu / vừa reset: giữ `change_token` trong bộ nhớ tới khi đổi xong. */
  pendingChange: PendingChange | null;
};
export type SessionEvent = "cleared" | "reauthed" | "expired";

const INITIAL: SessionState = {
  status: "unknown",
  accessToken: null,
  me: null,
  pendingChange: null,
};

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();
const eventListeners = new Map<SessionEvent, Set<() => void>>();
const channel = createAuthChannel();
let ensurePromise: Promise<SessionStatus> | null = null;

function set(patch: Partial<SessionState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function emit(event: SessionEvent): void {
  for (const l of eventListeners.get(event) ?? []) l();
}

const refresher = createRefresher({
  callRefresh: async (): Promise<RefreshResult> => {
    const grant = await sendPublic<TokenGrant>("/auth/refresh", { method: "POST" });
    return { accessToken: grant.access_token, me: grant.user };
  },
  locks: typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null,
  broadcast: (accessToken, at) => channel.post({ type: "token", accessToken, at }),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

function clearLocal(): void {
  set({ ...INITIAL, status: "anon" });
  emit("cleared");
}

channel.subscribe((msg: AuthMessage) => {
  if (msg.type === "logout") {
    if (state.status !== "anon") clearLocal();
    return;
  }
  refresher.receive(msg.accessToken, msg.at);
  if (state.status === "authed") set({ accessToken: msg.accessToken });
});

function applyGrant(grant: TokenGrant): void {
  set({ status: "authed", accessToken: grant.access_token, me: grant.user, pendingChange: null });
}

async function refreshToken(stale: string | null): Promise<string | null> {
  try {
    const r = await refresher.refresh({ stale, allowShared: true });
    set({ accessToken: r.accessToken, ...(r.me ? { me: r.me } : {}) });
    return r.accessToken;
  } catch {
    if (state.status === "authed") {
      set({ status: "expired", accessToken: null });
      emit("expired");
    }
    return null;
  }
}

setAuthHooks({ getToken: () => state.accessToken, refresh: refreshToken });

async function ensure(): Promise<SessionStatus> {
  if (state.status !== "unknown") return state.status;
  ensurePromise ??= refresher
    .refresh({ stale: null, allowShared: false })
    .then((r) => {
      set({ status: "authed", accessToken: r.accessToken, me: r.me });
    })
    .catch((err: unknown) => {
      // Mất mạng lúc khởi động cũng coi như chưa đăng nhập: trang login xử lý tiếp.
      if (!(err instanceof ApiError)) throw err;
      set({ status: "anon" });
    })
    .then(() => state.status);
  return ensurePromise;
}

async function login(req: LoginRequest): Promise<LoginResponse> {
  const res = await sendPublic<LoginResponse>("/auth/login", { method: "POST", body: req });
  if (res.status === "authenticated") {
    applyGrant(res);
  } else {
    set({
      pendingChange: {
        changeToken: res.change_token,
        tenantKey: req.tenant_key,
        username: req.username,
      },
    });
  }
  return res;
}

/** Đăng nhập lại ngay tại chỗ khi phiên hết hạn (mã công ty + tên đăng nhập lấy từ `me`). */
async function relogin(password: string): Promise<void> {
  const me = state.me;
  if (!me) throw new ApiError(401, "UNAUTHORIZED", "No session");
  const res = await login({ tenant_key: me.tenant.key, username: me.username, password });
  if (res.status !== "authenticated") return;
  emit("reauthed");
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

/** Tải lại `me` (vd sau 403 FORBIDDEN: role có thể vừa đổi). */
async function reload(): Promise<void> {
  const me = await api<Me>("/auth/me");
  set({ me });
}

export const session = {
  getState: (): SessionState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  on(event: SessionEvent, l: () => void): () => void {
    const set_ = eventListeners.get(event) ?? new Set<() => void>();
    set_.add(l);
    eventListeners.set(event, set_);
    return () => set_.delete(l);
  },
  ensure,
  login,
  relogin,
  logout,
  reload,
  applyGrant,
  setMe: (me: Me): void => set({ me }),
  clearPendingChange: (): void => set({ pendingChange: null }),
  /** Chỉ dùng cho test. */
  reset: (): void => {
    state = INITIAL;
    ensurePromise = null;
  },
};
