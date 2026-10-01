// ADM-FR-55 · AC-A07 · M3-R20, R21 · đọc `VERSION_CONFLICT.details` thành thông tin cho ConflictDialog (hàm thuần).
import { ApiError } from "./http";

export type ConflictCurrent = Record<string, unknown> & { version: number };
export type ConflictInfo = {
  current: ConflictCurrent;
  updatedAt: string;
  /** Username người vừa sửa; `null` với user/tenant hoặc khi server không trả (A4: dùng câu không `{user}`). */
  updatedBy: string | null;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `ApiError` `VERSION_CONFLICT` có `details.current.version` (số) và `details.updated_at` (chuỗi), ngược lại `null`. */
export function parseConflict(err: unknown): ConflictInfo | null {
  if (!(err instanceof ApiError) || err.code !== "VERSION_CONFLICT") return null;
  const d = err.details;
  if (!isObject(d) || !isObject(d.current) || typeof d.updated_at !== "string") return null;
  const current = d.current;
  if (typeof current.version !== "number") return null;
  const by = current.updated_by;
  return {
    current: current as ConflictCurrent,
    updatedAt: d.updated_at,
    updatedBy: typeof by === "string" && by !== "" ? by : null,
  };
}
