// PK-FR-05 · PK-FR-10 · TF4 · trạng thái gói từ `GET /pack/contracts/me` (T5b: 200 cả khi chưa bật/không quyền) và phân loại
// lỗi khung (plan-frontend §1 "Quyền", "Trạng thái"): viewer = `read`; editor = có `write`; owner = có `admin`.
import type { PackMeResponse } from "@ai/contracts";

export const PACK_KEY = "contracts";
/** Khoá Query của `/me` (dùng chung guard, ẩn nút, và làm mới khi API khác báo PACK_*). */
export const ME_QUERY_KEY = ["pack", PACK_KEY, "me"] as const;

export type PackView =
  | { kind: "ok"; write: boolean; owner: boolean }
  | { kind: "forbidden" }
  | { kind: "disabled" };

export function packView(me: PackMeResponse): PackView {
  if (!me.enabled) return { kind: "disabled" };
  const a = new Set<string>(me.actions);
  if (!a.has("read")) return { kind: "forbidden" };
  return { kind: "ok", write: a.has("write"), owner: a.has("admin") };
}

export type ErrorKind =
  | "unauthorized"
  | "network"
  | "forbidden"
  | "disabled"
  | "conflict"
  | "other";

type ApiErrorLike = { status: number; code: string };

/** Nhận `ApiError` của web-kit theo hình (`status` số + `code` chuỗi) — không import web-kit/http ⇒ module này nằm được
 *  trong bundle đầu (query-client) mà không kéo `@ai/contracts/chat` + zod theo. */
const asApiError = (err: unknown): ApiErrorLike | null => {
  const e = err as { status?: unknown; code?: unknown } | null;
  return e && typeof e.status === "number" && typeof e.code === "string"
    ? { status: e.status, code: e.code }
    : null;
};

export function errorKind(raw: unknown): ErrorKind {
  const err = asApiError(raw);
  if (!err) return "other";
  const code = err.code;
  if (code === "NETWORK_ERROR") return "network";
  if (err.status === 401) return "unauthorized";
  if (code === "PACK_DISABLED") return "disabled";
  if (code === "PACK_FORBIDDEN") return "forbidden";
  // Chỉ xung đột phiên bản mới là "người khác vừa cập nhật"; 409 nghiệp vụ (thiếu tồn, đã khoá…) do màn hình tự báo.
  if (err.status === 409 && !BUSINESS_409.has(code)) return "conflict";
  return "other";
}

/** 409 mang lỗi nghiệp vụ (không phải phiên bản cũ) — không bật toast "người khác vừa cập nhật". */
const BUSINESS_409: ReadonlySet<string> = new Set([
  "STOCK_INSUFFICIENT",
  "DELIVERY_OVER",
  "DELIVERY_INVALID",
  "DELIVERY_LOCKED",
  "OBLIGATION_DONE",
  "MILESTONE_CONFIRMED",
  "CONTRACT_LOCKED",
  "CONTRACT_SUPERSEDED",
  "CONTRACT_HAS_VERSIONS",
  "VERSION_DRAFT_EXISTS",
  "ITEM_LOCKED",
  "ITEMS_LOCKED",
  "DELETE_STOCK_BLOCKED",
]);

/** Key i18n của câu lỗi khi nạp `/me` hỏng (trang có nút "Thử lại"). */
export const loadErrorKey = (err: unknown): string =>
  errorKind(err) === "network" ? "contracts.errors.network" : "contracts.errors.unknown";
