// chat-api-gate · luật thuần: API Chat AI chỉ mở cho công ty có entitlement `chat-app` còn hiệu lực — cùng luật admin-api
// `app-catalog.rules` (`TENANT_APP_FEATURES`: feature theo CÔNG TY, không theo nhóm/user; feature chưa tồn tại ⇒ mở;
// platform_admin luôn được). Không I/O: đọc ảnh catalog trong cache cấu hình (0 SQL mỗi request).
import type { Role } from "@ai/contracts";
import { routeMessage } from "../mention/mention-parse.rules";
import { classifyBang } from "../processes/core/bang.rules";

/** Trùng `CHAT_APP_FEATURE` của admin-api (`app-catalog.rules.ts`). */
export const CHAT_APP_FEATURE = "chat-app";

/** Gốc route chat của người dùng cuối (chat-web). KHÔNG gồm `/pack`, `/studio/api`, `/agent-*`, `/notifications`, quy trình,
 *  `/mcp`, `/internal`, `/health` (xem `docs/specs/chat-api-gate/tasks.md`). */
export const CHAT_GATED_PREFIXES = [
  "/conversations",
  "/runs",
  "/commands",
  "/agents",
  "/attachments",
  "/rooms",
  "/directory",
  "/me/stream", // `/me/review-tasks`, `/me/process-inbox` thuộc engine quy trình ⇒ không chặn
] as const;

/** Phần catalog cần (khớp cấu trúc `CatalogSnapshot`). */
export type ChatGateCatalog = {
  readonly features: readonly { id: string; key: string; status: string }[];
  /** `${tenantId}:${featureId}` có entitlement chưa thu hồi. */
  readonly entitled: ReadonlySet<string>;
};

/** Tenant được dùng Chat AI: feature chưa có ⇒ mở; có ⇒ không `off` ∧ entitlement còn hiệu lực. */
export function chatAppAllowed(
  cat: ChatGateCatalog,
  who: { tenantId: string; role: Role; userKind?: "internal" | "external" },
): boolean {
  if (who.userKind === "external") return false; // CR-102a · com-c2: đối tác không có Chat AI (GĐ1), kể cả dock
  if (who.role === "platform_admin") return true;
  const f = cat.features.find((x) => x.key === CHAT_APP_FEATURE);
  if (!f) return true;
  return f.status !== "off" && cat.entitled.has(`${who.tenantId}:${f.id}`);
}

/** `chat` = route chat bị chặn; `dock` = 3 route dock trợ lý Sổ Hợp Tác dùng (mở khi có quyền đọc gói); `open` = không chặn. */
export type ChatRouteKind = "chat" | "dock" | "open";

const SEG = "[^/]+";
const OPEN_RE = [new RegExp(`^/runs/${SEG}/trace$`)]; // H3b trace quản trị
const DOCK_RE = [
  /^\/conversations$/,
  new RegExp(`^/conversations/${SEG}/messages$`),
  new RegExp(`^/runs/${SEG}/cancel$`),
];

const underPrefix = (path: string): boolean =>
  CHAT_GATED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

export function chatRouteKind(method: string, path: string): ChatRouteKind {
  if (!underPrefix(path)) return "open";
  if (method === "GET" && OPEN_RE.some((r) => r.test(path))) return "open";
  if (method === "POST" && DOCK_RE.some((r) => r.test(path))) return "dock";
  return "chat";
}

/**
 * chat-api-gate-fix · tin dock của công ty không có Chat AI: CHỈ văn bản thường, không file. Từ chối `@tag`, `/lệnh`, `!quy
 * trình` (kể cả `!` sai) — các lối này mở agent/lệnh/quy trình ngoài phạm vi trợ lý dock. Chuỗi thoát (`@@`, `//`, `!!`) là
 * văn bản ⇒ cho qua.
 */
export function dockMessageAllowed(content: string, attachmentCount: number): boolean {
  if (attachmentCount > 0) return false;
  const b = classifyBang(content);
  if (b.kind === "process" || b.kind === "invalid") return false;
  return routeMessage(b.kind === "escaped" ? b.content : content).kind === "text";
}

/** Header `X-Ai-Surface` của dock trợ lý (Sổ Hợp Tác = `contracts`, Cộng đồng = `community`, com-c10b); khác ⇒ null. */
export const dockSurfaceOf = (surface: string | undefined): "contracts" | "community" | null =>
  surface === "contracts" || surface === "community" ? surface : null;
export const isDockSurface = (surface: string | undefined): boolean =>
  dockSurfaceOf(surface) !== null;

/** Cho qua: route mở, hoặc công ty có Chat AI, hoặc route dock + người gọi đủ quyền dock. */
export function chatGateVerdict(kind: ChatRouteKind, chatOk: boolean, dockOk: boolean): boolean {
  if (kind === "open" || chatOk) return true;
  return kind === "dock" && dockOk;
}
