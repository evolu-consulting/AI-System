// ADM-FR-60 · lỗi tải danh sách → `{message, code}` cho `ErrorState`/`DataTable` (component không import lib/http trực tiếp).
import { ApiError } from "./http";

export type LoadError = { message: string; code: string };

/** `ApiError` → `{message, code}`; lỗi khác (hoặc không lỗi) → `null`. */
export function loadError(err: unknown): LoadError | null {
  return err instanceof ApiError ? { message: err.message, code: err.code } : null;
}
