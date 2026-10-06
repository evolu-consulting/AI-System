// HUB-FR-44 · luật thuần của hàng đợi upload: ≤ 3 đồng thời, ánh xạ lỗi → câu chữ.
import type { ApiError } from "~/lib/http";
import type { AttachErrorKey } from "./validate.rules";

export const UPLOAD_CONCURRENCY = 3;

export type ChipStatus = "queued" | "uploading" | "ready" | "error";
export type Chip = {
  uid: number;
  file: File;
  status: ChipStatus;
  /** Id Hub khi `ready`. */
  id?: string;
  errorKey?: AttachErrorKey | "attach.err.quota" | "attach.err.failed" | "attach.err.missing";
  retryable?: boolean;
};

/** Các chip `queued` được phép bắt đầu ngay (còn chỗ trong 3 luồng), giữ thứ tự chọn. */
export function nextToStart(chips: readonly Chip[], max = UPLOAD_CONCURRENCY): number[] {
  const active = chips.filter((c) => c.status === "uploading").length;
  return chips
    .filter((c) => c.status === "queued")
    .slice(0, Math.max(max - active, 0))
    .map((c) => c.uid);
}

export const isBusy = (chips: readonly Chip[]): boolean =>
  chips.some((c) => c.status === "queued" || c.status === "uploading");

export const readyIds = (chips: readonly Chip[]): string[] =>
  chips.flatMap((c) => (c.status === "ready" && c.id ? [c.id] : []));

export function uploadFailure(err: ApiError): Pick<Chip, "errorKey" | "retryable"> {
  if (err.code === "ATTACHMENT_TOO_LARGE") return { errorKey: "attach.err.tooLarge" };
  if (err.code === "ATTACHMENT_TYPE_NOT_ALLOWED") return { errorKey: "attach.err.type" };
  if (err.code === "ATTACHMENT_QUOTA_EXCEEDED") return { errorKey: "attach.err.quota" };
  return { errorKey: "attach.err.failed", retryable: true };
}

/** `ATTACHMENT_NOT_FOUND.details.ids` → chip có id đó chuyển sang lỗi (sai dạng → không chip nào). */
export function missingIds(err: ApiError): string[] {
  const ids = (err.details as { ids?: unknown } | null | undefined)?.ids;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
}

export function markMissing(chips: readonly Chip[], ids: readonly string[]): Chip[] {
  return chips.map((c) =>
    c.id !== undefined && ids.includes(c.id)
      ? { ...c, status: "error", id: undefined, errorKey: "attach.err.missing", retryable: false }
      : c,
  );
}
