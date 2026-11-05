// CR-118 · cr118-feature-gate-web · nguồn ảnh `GET /pack/me` (không phụ thuộc OpenFeature/React ⇒ test thuần).
// Giữ ảnh + ETag; `refresh()` gộp lời gọi đang bay, 304 ⇒ không đổi/không báo. Kích hoạt tải lại: SSE `config.changed`
// (nối lại sau đứt cũng tải một lần), focus cửa sổ (throttle), 403 từ API khác (`reportForbidden`).
import type { ShellMeResponse } from "@ai/contracts/capabilities";

export type PackMeResult =
  | { status: "fresh"; data: ShellMeResponse; etag: string | null }
  | { status: "not-modified" };
export type PackMeFetch = (etag: string | null, signal?: AbortSignal) => Promise<PackMeResult>;
/** Vòng nghe tới khi `signal` huỷ; `onChanged` khi có `config.changed`, `onReconnected` khi nối lại sau đứt. */
export type ConfigListener = (
  signal: AbortSignal,
  onChanged: () => void,
  onReconnected: () => void,
) => Promise<void>;
export type FocusTarget = {
  addEventListener(type: "focus", fn: () => void): void;
  removeEventListener(type: "focus", fn: () => void): void;
};

export const FOCUS_THROTTLE_MS = 10_000;

export type PackMeSource = {
  snapshot(): ShellMeResponse | null;
  /** Có ảnh thì trả ngay, chưa có thì tải. */
  ensure(): Promise<ShellMeResponse>;
  refresh(): Promise<ShellMeResponse | null>;
  /** API khác trả 403 (gói vừa tắt): tải lại ảnh, nuốt lỗi. */
  reportForbidden(): void;
  subscribe(fn: (data: ShellMeResponse) => void): () => void;
  start(): void;
  /** Dừng nghe + xoá ảnh/ETag (hết phiên). */
  stop(): void;
};

export function createPackMeSource(deps: {
  fetch: PackMeFetch;
  listen: ConfigListener;
  focus?: FocusTarget | null;
  now?: () => number;
}): PackMeSource {
  const now = deps.now ?? Date.now;
  let data: ShellMeResponse | null = null;
  let etag: string | null = null;
  let inflight: Promise<ShellMeResponse | null> | null = null;
  let ctl: AbortController | null = null;
  let lastFocus = Number.NEGATIVE_INFINITY;
  const subs = new Set<(d: ShellMeResponse) => void>();

  const refresh = (): Promise<ShellMeResponse | null> => {
    inflight ??= (async () => {
      try {
        const r = await deps.fetch(etag, ctl?.signal);
        if (r.status === "fresh") {
          const changed = r.etag === null || r.etag !== etag || data === null;
          data = r.data;
          etag = r.etag;
          if (changed) for (const fn of subs) fn(r.data);
        }
        return data;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  const quiet = () => void refresh().catch(() => {});
  const onFocus = () => {
    const t = now();
    if (t - lastFocus < FOCUS_THROTTLE_MS) return;
    lastFocus = t;
    quiet();
  };

  return {
    snapshot: () => data,
    ensure: async () => data ?? (await refresh()) ?? Promise.reject(new Error("pack/me empty")),
    refresh,
    reportForbidden: quiet,
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
    start() {
      if (ctl) return;
      const c = new AbortController();
      ctl = c;
      deps.focus?.addEventListener("focus", onFocus);
      void deps.listen(c.signal, quiet, quiet).catch(() => {});
    },
    stop() {
      ctl?.abort();
      ctl = null;
      deps.focus?.removeEventListener("focus", onFocus);
      data = null;
      etag = null;
    },
  };
}
