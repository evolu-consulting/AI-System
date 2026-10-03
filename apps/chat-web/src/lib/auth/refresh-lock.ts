// CHAT-AC-03 · refresh token xoay vòng (chép admin-web, khoá `ai-chat-refresh`): single-flight trong tab + Web Locks liên tab + dùng lại token broadcast.
import type { Me } from "@ai/contracts/chat";
import { ApiError } from "../http";

export const REFRESH_LOCK_NAME = "ai-chat-refresh";
/** Cửa sổ chấp nhận token do tab khác vừa xoay (khớp ân hạn 10 s của backend). */
export const SHARED_TOKEN_WINDOW_MS = 10_000;
const SUPERSEDED_RETRY_DELAY_MS = 100;

export type RefreshResult = { accessToken: string; me: Me | null };

export type LockManagerLike = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
};

export type RefresherDeps = {
  /** Gọi `POST /auth/refresh` (cookie), trả token + hồ sơ. Ném `ApiError` khi lỗi. */
  callRefresh(): Promise<RefreshResult>;
  /** `null` = không có Web Locks (chỉ còn single-flight trong tab). */
  locks: LockManagerLike | null;
  /** Báo tab khác token mới; `sub` = id user của token (tab nhận phát hiện đổi tài khoản). */
  broadcast(accessToken: string, at: number, sub?: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
};

export type RefreshOptions = {
  /** Token vừa bị 401; token chia sẻ khác giá trị này (trong cửa sổ 10 s) được dùng thay vì gọi API. */
  stale: string | null;
  /** `false` khi cần `me` (khởi động trang): luôn gọi API, không dùng token của tab khác. */
  allowShared: boolean;
};

export type Refresher = {
  refresh(opts: RefreshOptions): Promise<RefreshResult>;
  /** Ghi nhận token mới từ tab khác (thông điệp BroadcastChannel). */
  receive(accessToken: string, at: number): void;
};

export function createRefresher(deps: RefresherDeps): Refresher {
  let inflight: Promise<RefreshResult> | null = null;
  let shared: { accessToken: string; at: number } | null = null;

  const reusable = (opts: RefreshOptions): RefreshResult | null => {
    if (!opts.allowShared || !shared || shared.accessToken === opts.stale) return null;
    if (deps.now() - shared.at > SHARED_TOKEN_WINDOW_MS) return null;
    return { accessToken: shared.accessToken, me: null };
  };

  const callOnce = async (): Promise<RefreshResult> => {
    const result = await deps.callRefresh();
    const at = deps.now();
    shared = { accessToken: result.accessToken, at };
    deps.broadcast(result.accessToken, at, result.me?.id);
    return result;
  };

  const callWithRetry = async (opts: RefreshOptions): Promise<RefreshResult> => {
    try {
      return await callOnce();
    } catch (err) {
      if (!(err instanceof ApiError) || err.code !== "REFRESH_SUPERSEDED") throw err;
      await deps.sleep(SUPERSEDED_RETRY_DELAY_MS);
      return reusable(opts) ?? callOnce();
    }
  };

  const locked = async (opts: RefreshOptions): Promise<RefreshResult> =>
    reusable(opts) ?? callWithRetry(opts);

  return {
    refresh(opts) {
      if (inflight) return inflight;
      const run = deps.locks
        ? deps.locks.request(REFRESH_LOCK_NAME, () => locked(opts))
        : locked(opts);
      const p: Promise<RefreshResult> = run.finally(() => {
        if (inflight === p) inflight = null;
      });
      inflight = p;
      return p;
    },
    receive(accessToken, at) {
      if (!shared || at >= shared.at) shared = { accessToken, at };
    },
  };
}
