// CHAT-AC-03 · điều khiển mock `/__mock/*` (plan C1 §3.6): không thuộc contract, không auth, chỉ mock.
// Trạng thái toàn cục → e2e dùng phải chạy tuần tự.
import { Hono } from "hono";
import { z } from "zod";
import { chatError, parseBody } from "./http";
import type { SessionStore } from "./sessions";

const ScenarioBodySchema = z.strictObject({ name: z.string().nullable() });

export type ControlHooks = {
  sessions: SessionStore;
  /** Dọn store hội thoại/run + nạp lại seed (B3–B5 gắn vào). */
  onReset?: () => void;
  /** Đặt kịch bản mặc định toàn cục (null = `normal`); false nếu tên lạ. */
  setScenario?: (name: string | null) => boolean;
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

  // Mặc định toàn cục cho tin không có `#scn:` (plan §3.6); tên lạ → 400.
  app.post("/__mock/scenario", async (c) => {
    const b = await parseBody(c, ScenarioBodySchema);
    if (!b.ok) return chatError(c, "VALIDATION_ERROR", b.issues);
    if (!h.setScenario?.(b.data.name)) {
      const issue = { path: ["name"], code: "custom", message: "Unknown scenario" };
      return chatError(c, "VALIDATION_ERROR", [issue]);
    }
    return c.body(null, 204);
  });

  return app;
}
