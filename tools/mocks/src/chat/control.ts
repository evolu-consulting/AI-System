// CHAT-AC-03 · điều khiển mock `/__mock/*` (plan C1 §3.6): không thuộc contract, không auth, chỉ mock.
// Trạng thái toàn cục → e2e dùng phải chạy tuần tự. `/__mock/scenario` thêm ở B4.
import { Hono } from "hono";
import type { SessionStore } from "./sessions";

export type ControlHooks = {
  sessions: SessionStore;
  /** Dọn store hội thoại/run + nạp lại seed (B3–B5 gắn vào). */
  onReset?: () => void;
};

export function createControlRoutes(h: ControlHooks): Hono {
  const app = new Hono();

  // Bộ test contract dùng để biết đích là mock (Hub thật không có route này).
  app.get("/__mock/ping", (c) => c.body(null, 204));

  app.post("/__mock/expire-access", (c) => {
    h.sessions.expireAccess();
    return c.body(null, 204);
  });

  app.post("/__mock/reset", (c) => {
    h.sessions.reset();
    h.onReset?.();
    return c.body(null, 204);
  });

  return app;
}
