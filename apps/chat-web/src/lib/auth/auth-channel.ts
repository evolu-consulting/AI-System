// CHAT-AC-03 · BroadcastChannel liên tab (chép admin-web, kênh `ai-chat-auth`): chia sẻ access token mới và tín hiệu đăng xuất.

/** `sub` = `me.id` của token (thiếu khi tab gửi chưa biết user) — tab nhận so với user của mình. */
export type AuthMessage =
  | { type: "token"; accessToken: string; at: number; sub?: string }
  | { type: "logout" };

export const AUTH_CHANNEL_NAME = "ai-chat-auth";

/** Kiểm tra thông điệp nhận từ tab khác (dữ liệu ngoài, không tin kiểu). */
export function parseAuthMessage(data: unknown): AuthMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.type === "logout") return { type: "logout" };
  if (
    m.type === "token" &&
    typeof m.accessToken === "string" &&
    m.accessToken !== "" &&
    typeof m.at === "number"
  ) {
    const sub = typeof m.sub === "string" && m.sub !== "" ? m.sub : undefined;
    return sub
      ? { type: "token", accessToken: m.accessToken, at: m.at, sub }
      : { type: "token", accessToken: m.accessToken, at: m.at };
  }
  return null;
}

export type AuthChannel = {
  post(msg: AuthMessage): void;
  subscribe(handler: (msg: AuthMessage) => void): () => void;
};

const NOOP_CHANNEL: AuthChannel = { post: () => {}, subscribe: () => () => {} };

/** Không có `BroadcastChannel` → kênh rỗng (mỗi tab tự lo). */
export function createAuthChannel(name = AUTH_CHANNEL_NAME): AuthChannel {
  if (typeof BroadcastChannel === "undefined") return NOOP_CHANNEL;
  const bc = new BroadcastChannel(name);
  return {
    post: (msg) => bc.postMessage(msg),
    subscribe(handler) {
      const listener = (e: MessageEvent) => {
        const msg = parseAuthMessage(e.data);
        if (msg) handler(msg);
      };
      bc.addEventListener("message", listener);
      return () => bc.removeEventListener("message", listener);
    },
  };
}
