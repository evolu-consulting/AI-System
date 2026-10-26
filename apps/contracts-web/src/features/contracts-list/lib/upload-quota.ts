// Hết lượt tải HĐ (429 UPLOAD_QUOTA): luật thuần — đọc `details`, dựng nội dung popup, dừng hàng đợi. Không phụ thuộc React.
import { ApiError } from "@ai/web-kit/http";
import type { UploadItem } from "./upload-queue";

export type QuotaNotice = { scope?: "tenant" | "global"; limit?: number; resetsAt?: string };
type Tr = (key: string, opts?: Record<string, unknown>) => string;

/** ApiError UPLOAD_QUOTA ⇒ thông tin hạn mức (thiếu/sai `details` ⇒ chỉ rỗng); lỗi khác ⇒ null. */
export function quotaNotice(e: unknown): QuotaNotice | null {
  if (!(e instanceof ApiError) || (e.code as string) !== "UPLOAD_QUOTA") return null;
  const d = (e.details ?? {}) as Record<string, unknown>;
  const scope = d.scope === "tenant" || d.scope === "global" ? d.scope : undefined;
  const limit = typeof d.limit === "number" && Number.isFinite(d.limit) ? d.limit : undefined;
  const at = typeof d.resets_at === "string" && !Number.isNaN(Date.parse(d.resets_at));
  return { scope, limit, resetsAt: at ? (d.resets_at as string) : undefined };
}

/** Giờ mở lại theo múi giờ trình duyệt: `time` = "HH:mm", `date` = "dd/MM". */
export function formatResetsAt(
  iso: string,
  locale = "vi",
  timeZone?: string,
): { time: string; date: string } {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(iso));
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return { time: `${p("hour")}:${p("minute")}`, date: `${p("day")}/${p("month")}` };
}

/** Tiêu đề + nội dung popup; scope/limit/giờ thiếu ⇒ câu chung không số/giờ. */
export function quotaPopupText(n: QuotaNotice, t: Tr, locale = "vi", timeZone?: string) {
  const title = t("contracts.list.upload.quotaPopup.title");
  const base = "contracts.list.upload.quotaPopup";
  if (!n.scope || n.limit === undefined || !n.resetsAt)
    return { title, body: t(`${base}.generic`) };
  const when = formatResetsAt(n.resetsAt, locale, timeZone);
  const key = n.scope === "tenant" ? "tenant" : "global";
  return { title, body: t(`${base}.${key}`, { limit: n.limit, ...when }) };
}

/** Dừng hàng đợi: tệp vừa lỗi (`failedKey`) + mọi tệp còn `queued` ⇒ error cùng câu, không cho thử lại. */
export function stopOnQuota(items: UploadItem[], failedKey: number, text: string): UploadItem[] {
  return items.map((i) =>
    i.key === failedKey || i.state === "queued"
      ? { ...i, state: "error", error: text, retryable: false }
      : i,
  );
}
