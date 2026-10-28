// chat-api-gate · cổng API Chat AI (đặt SAU `requireAuth`, trên `CHAT_GATED_PREFIXES`): công ty không có entitlement
// `chat-app` ⇒ 403 `CHAT_APP_DISABLED`. Đọc ảnh catalog trong `ConfigCache` (0 SQL khi nóng; chờ lần nạp Admin đang chạy như
// cổng gói ⇒ thu hồi vừa NOTIFY có hiệu lực ngay). Dock trợ lý Sổ Hợp Tác (`X-Ai-Surface: contracts`) chỉ qua 3 route dock
// và chỉ khi `dockAllowed` (quyền đọc gói của user) — app.ts nối vào, module này không import module gói.
import { AI_SURFACE_HEADER } from "@ai/contracts/chat";
import type { MiddlewareHandler } from "hono";
import type { AuthUser, AuthVars } from "../../lib/auth.middleware";
import { appError } from "../../lib/errors";
import {
  type ChatGateCatalog,
  chatAppAllowed,
  chatGateVerdict,
  chatRouteKind,
  dockSurfaceOf,
} from "./chat-gate.rules";

export type ChatGateView = {
  adminSettled?(): Promise<void>;
  catalog(): Promise<ChatGateCatalog>;
};
export type ChatGateDeps = {
  view: ChatGateView;
  /** User được dùng dock trợ lý Sổ Hợp Tác (quyền đọc gói `contracts`); vắng ⇒ không có ngoại lệ dock. */
  dockAllowed?: (u: AuthUser, surface: "contracts" | "community") => Promise<boolean>;
};

export function chatGate(d: ChatGateDeps): MiddlewareHandler<AuthVars> {
  return async (c, next) => {
    const kind = chatRouteKind(c.req.method, c.req.path);
    if (kind === "open") return next();
    const u = c.var.user;
    await d.view.adminSettled?.();
    const chatOk = chatAppAllowed(await d.view.catalog(), u);
    const dockSurface = kind === "dock" ? dockSurfaceOf(c.req.header(AI_SURFACE_HEADER)) : null;
    const dockOk =
      !chatOk &&
      dockSurface !== null &&
      u.userKind !== "external" && // CR-102a · com-c2: đối tác không dùng dock trợ lý
      d.dockAllowed !== undefined &&
      (await d.dockAllowed(u, dockSurface));
    if (!chatGateVerdict(kind, chatOk, dockOk)) throw appError("CHAT_APP_DISABLED");
    // fix: dấu dock cho route sau — tạo hội thoại ⇒ `surface=<dock>`; qua cổng NHỜ dock ⇒ gửi tin bị giới hạn (routes kiểm).
    if (dockSurface) c.set("chatDock", { restricted: !chatOk, surface: dockSurface });
    await next();
  };
}
