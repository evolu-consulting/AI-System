// HUB-FR-131 · G15 · lỗi lưu (không phải VERSION_CONFLICT) → lỗi gắn trường hoặc toast, theo mã (plan-frontend §2, §4).
import { describeApiError, type MessageSpec } from "#/lib/api-error";

export type KhField = "name" | "base_url" | "secret_id";
export type KhSaveFailure = { field?: KhField; message?: MessageSpec; toast?: MessageSpec };

type Err = { code?: unknown; details?: { field?: unknown } | null };

export function classifyKhSaveError(err: unknown): KhSaveFailure {
  const e = (err ?? {}) as Err;
  const message = describeApiError(err);
  if (e.code === "KH_CONNECTION_EXISTS")
    return { field: e.details?.field === "base_url" ? "base_url" : "name", message };
  if (e.code === "KH_URL_NOT_ALLOWED") return { field: "base_url", message };
  if (e.code === "KH_SECRET_INVALID") return { field: "secret_id", message };
  return { toast: message };
}
