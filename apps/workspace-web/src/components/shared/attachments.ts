// CR-125 · cr125-form-step-card · tải/đọc tệp đính kèm dùng chung (`POST /attachments` thân thô + tên tệp percent-encode, `GET /attachments/:id`).
// Dùng bởi ô tệp của bước «Điền thông tin» (FormStep) và — khi cr125-manual-start-ui gộp — ô «Tệp đính kèm» của phiếu «Tạo yêu cầu»
// (RequestField.Files nên đổi sang import từ đây để chỉ còn MỘT đường tải).
import { type Attachment, type AttachmentDetail, FILENAME_HEADER } from "@ai/contracts/chat";
import { api } from "@ai/web-kit/http";

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
