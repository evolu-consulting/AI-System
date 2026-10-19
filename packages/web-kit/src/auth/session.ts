// CHAT-AC-01, CHAT-AC-03 · phiên web (rút gọn từ admin-web): access token CHỈ trong bộ nhớ, refresh bằng cookie httpOnly.
// Không có bước đổi mật khẩu / 2FA: `password_change_required` / `totp_required` trả về cho trang đăng nhập của app.
// N1 TF3: chuyển từ chat-web sang web-kit; tên app/kênh/khoá + việc dọn khi hết phiên do app truyền (`createSession`).
import type { LoginRequest, LoginResponse, Me, TokenGrant } from "@ai/contracts/chat";
import { ApiError, sendPublic, setAppName, setAuthHooks } from "../http";
import { type AuthChannel, type AuthMessage, createAuthChannel } from "./auth-channel";
import { createRefresher, type Refresher, type RefreshResult } from "./refresh-lock";

/** `expired` = đang đăng nhập thì refresh hỏng: phiên đã xoá, UI về `/login?next=` + toast hết phiên. */
export type SessionStatus = "unknown" | "anon" | "authed" | "expired";
export type SessionState = { status: SessionStatus; accessToken: string | null; me: Me | null };
/** `cleared` = đăng xuất (tab này hoặc tab khác); `expired` = refresh hỏng giữa phiên. */
export type SessionEvent = "cleared" | "expired";

export type SessionConfig = {
  /** Giá trị `X-App` khi gọi `/auth/*` (CR-053; chat: `chat`). */
  app: string;
  /** Tên BroadcastChannel liên tab (chat: `ai-chat-auth`). */
  channelName: string;
  /** Tên Web Lock refresh (chat: `ai-chat-refresh`). */
  lockName: string;
  /** Phiên kết thúc (đăng xuất / hết hạn) → chạy trước listener (chat: xoá nháp ô nhập, review C1 #2). */
  onEnd?: () => void;
};

export type Session = ReturnType<typeof createSession>;

const INITIAL: SessionState = { status: "unknown", accessToken: null, me: null };

type Ctx = {
  cfg: SessionConfig;
  state: SessionState;
  listeners: Set<() => void>;
  eventListeners: Map<SessionEvent, Set<() => void>>;
  channel: AuthChannel;
  ensurePromise: Promise<SessionStatus> | null;
  refresher: Refresher;
};

function set(ctx: Ctx, next: SessionState): void {
  ctx.state = next;
  for (const l of ctx.listeners) l();
}

/** Phiên kết thúc (đăng xuất / hết hạn) → dọn của app (`onEnd`) rồi báo listener. */
function emit(ctx: Ctx, event: SessionEvent): void {
  ctx.cfg.onEnd?.();
  for (const l of ctx.eventListeners.get(event) ?? []) l();
}

const makeRefresher = (ctx: Ctx): Refresher =>
  createRefresher({
    lockName: ctx.cfg.lockName,
    callRefresh: async (): Promise<RefreshResult> => {
      const grant = await sendPublic<TokenGrant>("/auth/refresh", { method: "POST" });
      return { accessToken: grant.access_token, me: grant.user };
    },
    locks: typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null,
    broadcast: (accessToken, at, sub) => ctx.channel.post({ type: "token", accessToken, at, sub }),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

function clearLocal(ctx: Ctx): void {
  set(ctx, { ...INITIAL, status: "anon" });
  emit(ctx, "cleared");
}

/** Thông điệp tab khác. Token của user khác (`sub` ≠ `me.id`: tab kia đăng nhập tài khoản khác, cookie đã đổi chủ)
 *  → xoá phiên tab này thay vì ghép token mới với `me` cũ (review C1 #5). */
function receive(ctx: Ctx, msg: AuthMessage): void {
  if (msg.type === "logout") {
    if (ctx.state.status !== "anon") clearLocal(ctx);
    return;
  }
  if (msg.sub && ctx.state.me && msg.sub !== ctx.state.me.id) {
    if (ctx.state.status !== "anon") clearLocal(ctx);
    return;
  }
  ctx.refresher.receive(msg.accessToken, msg.at);
  if (ctx.state.status === "authed") set(ctx, { ...ctx.state, accessToken: msg.accessToken });
}

function applyGrant(ctx: Ctx, grant: TokenGrant): void {
  set(ctx, { status: "authed", accessToken: grant.access_token, me: grant.user });
}

const isNetworkError = (err: unknown): boolean =>
  err instanceof ApiError && err.code === "NETWORK_ERROR";

/** Hook refresh của `http`: lỗi mạng ném tiếp (giữ phiên, UI báo Hub sập); lỗi khác → xoá phiên + `expired`. */
async function refreshToken(ctx: Ctx, stale: string | null): Promise<string | null> {
  try {
    const r = await ctx.refresher.refresh({ stale, allowShared: true });
    if (ctx.state.status === "authed")
      set(ctx, { ...ctx.state, accessToken: r.accessToken, me: r.me ?? ctx.state.me });
    return r.accessToken;
  } catch (err) {
    if (isNetworkError(err)) throw err;
    if (ctx.state.status === "authed") {
      set(ctx, { ...INITIAL, status: "expired" });
      emit(ctx, "expired");
    }
    return null;
  }
}

/** Khi tải trang: refresh bằng cookie để biết đã đăng nhập chưa (guard `_authed`). */
async function ensure(ctx: Ctx): Promise<SessionStatus> {
  if (ctx.state.status !== "unknown") return ctx.state.status;
  ctx.ensurePromise ??= ctx.refresher
    .refresh({ stale: null, allowShared: false })
    .then((r) => set(ctx, { status: "authed", accessToken: r.accessToken, me: r.me }))
    .catch((err: unknown) => {
      // Mất mạng lúc khởi động cũng coi như chưa đăng nhập: trang login xử lý tiếp.
      if (!(err instanceof ApiError)) throw err;
      set(ctx, { ...INITIAL, status: "anon" });
    })
    .then(() => ctx.state.status);
  return ctx.ensurePromise;
}

async function login(ctx: Ctx, req: LoginRequest): Promise<LoginResponse> {
  const res = await sendPublic<LoginResponse>("/auth/login", { method: "POST", body: req });
  if (res.status === "authenticated") applyGrant(ctx, res);
  return res;
}

async function logout(ctx: Ctx): Promise<void> {
  try {
    await sendPublic<void>("/auth/logout", { method: "POST" });
  } catch {
    // đăng xuất phía client vẫn tiếp tục
  }
  ctx.channel.post({ type: "logout" });
  clearLocal(ctx);
}

/** Tạo phiên của app và nối vào `http` (Bearer + refresh, `X-App`). Mỗi app gọi một lần ở module cấu hình. */
export function createSession(cfg: SessionConfig) {
  const ctx = {
    cfg,
    state: INITIAL,
    listeners: new Set<() => void>(),
    eventListeners: new Map<SessionEvent, Set<() => void>>(),
    channel: createAuthChannel(cfg.channelName),
    ensurePromise: null,
  } as Omit<Ctx, "refresher"> as Ctx;
  ctx.refresher = makeRefresher(ctx);
  ctx.channel.subscribe((msg) => receive(ctx, msg));
  setAppName(cfg.app);
  setAuthHooks({ getToken: () => ctx.state.accessToken, refresh: (s) => refreshToken(ctx, s) });
  return {
    getState: (): SessionState => ctx.state,
    subscribe(l: () => void): () => void {
      ctx.listeners.add(l);
      return () => ctx.listeners.delete(l);
    },
    on(event: SessionEvent, l: () => void): () => void {
      const bucket = ctx.eventListeners.get(event) ?? new Set<() => void>();
      bucket.add(l);
      ctx.eventListeners.set(event, bucket);
      return () => bucket.delete(l);
    },
    ensure: (): Promise<SessionStatus> => ensure(ctx),
    login: (req: LoginRequest): Promise<LoginResponse> => login(ctx, req),
    logout: (): Promise<void> => logout(ctx),
    applyGrant: (grant: TokenGrant): void => applyGrant(ctx, grant),
    /** Chỉ dùng cho test: giả thông điệp BroadcastChannel từ tab khác. */
    receive: (msg: AuthMessage): void => receive(ctx, msg),
    /** Chỉ dùng cho test. */
    reset: (): void => {
      ctx.state = INITIAL;
      ctx.ensurePromise = null;
      ctx.refresher = makeRefresher(ctx);
    },
  };
}
