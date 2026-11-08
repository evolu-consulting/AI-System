// CR-125 · cr125-form-step-card · tải/đọc tệp đính kèm dùng chung (`POST /attachments` thân thô + tên tệp percent-encode, `GET /attachments/:id`).
// Dùng bởi ô tệp của bước «Điền thông tin» (FormStep) và — khi cr125-manual-start-ui gộp — ô «Tệp đính kèm» của phiếu «Tạo yêu cầu»
// (RequestField.Files nên đổi sang import từ đây để chỉ còn MỘT đường tải).
import { type Attachment, type AttachmentDetail, FILENAME_HEADER } from "@ai/contracts/chat";
import { api, apiResponse } from "@ai/web-kit/http";

export function uploadAttachment(file: File): Promise<Attachment> {
  return api<Attachment>("/attachments", {
    method: "POST",
    rawBody: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      [FILENAME_HEADER]: encodeURIComponent(file.name),
    },
  });
}

export const fetchAttachment = (id: string, signal?: AbortSignal) =>
  api<AttachmentDetail>(`/attachments/${encodeURIComponent(id)}`, { signal });

/** `GET /attachments/:id/content` kèm Bearer (không `<a href>` trần — tệp chỉ mở được khi hub cho phép người xem lượt). */
export async function downloadAttachment(id: string, filename: string): Promise<void> {
  const blob = await (await apiResponse(`/attachments/${encodeURIComponent(id)}/content`)).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.append(a);
  try {
    a.click();
  } finally {
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Giá trị ô tệp đã gửi ("id1, id2" của phiếu «Tạo yêu cầu», hoặc id đơn của bước form) ⇒ danh sách id (chữ thường, không trùng). */
export const fileIdsOf = (value: string): string[] => [
  ...new Set((value.match(UUID_G) ?? []).map((x) => x.toLowerCase())),
];
