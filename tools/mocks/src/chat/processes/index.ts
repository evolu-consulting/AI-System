// HUB-FR-105…117 · CR-056 · ghép mock quy trình P-a (plan-step0 §3) vào mock chat: route Bearer + `/__mock/process`.
// `/me/stream` ở đây thay stub ping-only (đăng ký TRƯỚC `createRoomStubRoutes`).
import { Hono } from "hono";
import type { ChatVars } from "../auth";
import { createAskRoutes } from "./asks";
import { createProcessControlRoutes } from "./control";
import { resetGenId } from "./fixtures";
import { createGateRoutes } from "./gates";
import { createInboxRoutes, createReviewTaskRoutes } from "./inbox";
import { createProcessRoomRoutes } from "./rooms";
import { createRunRoutes } from "./runs";
import { seedProcesses } from "./seed";
import { ProcessState } from "./state";
import { createProcessStreamRoutes, ProcessBus } from "./stream";

export { PA_FIX, PERSONA as PA_PERSONA } from "./fixtures";

export type ProcessMock = {
  /** Route Bearer (gắn sau middleware `requireAccess`). */
  routes: Hono<ChatVars>;
  /** `/__mock/process` (không auth). */
  control: Hono;
  reset: () => void;
  state: () => ProcessState;
};

export function createProcessMock(opts: { heartbeatMs?: number } = {}): ProcessMock {
  const bus = new ProcessBus();
  const emit = bus.emit.bind(bus);
  const fresh = () => {
    resetGenId();
    const s = new ProcessState(emit);
    seedProcesses(s);
    return s;
  };
  let s = fresh();
  // Route đọc `s` qua proxy để `reset` thay toàn bộ trạng thái mà không phải đăng ký lại route.
  const live = new Proxy({} as ProcessState, {
    get: (_t, k) => {
      const v = Reflect.get(s, k);
      return typeof v === "function" ? v.bind(s) : v;
    },
  });
  const routes = new Hono<ChatVars>();
  routes.route("/", createProcessStreamRoutes(bus, opts.heartbeatMs));
  routes.route("/", createRunRoutes(live));
  routes.route("/", createGateRoutes(live));
  routes.route("/", createAskRoutes(live));
  routes.route("/", createReviewTaskRoutes(live));
  routes.route("/", createInboxRoutes(live));
  routes.route("/", createProcessRoomRoutes(live));
  return {
    routes,
    control: createProcessControlRoutes(live),
    reset: () => {
      s = fresh();
    },
    state: () => s,
  };
}
