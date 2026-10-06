// HUB-FR-44 · Hub: upload / tải tệp đính kèm — nơi duy nhất gọi API của feature attachments.
import { type Attachment, FILENAME_HEADER } from "@ai/contracts/chat";
import { api, apiResponse } from "~/lib/http";
import { mimeByName } from "./lib/validate.rules";

/** `POST /attachments`: thân thô, `Content-Type` theo đuôi (không tin `file.type`), tên file percent-encode. */
export function uploadAttachment(file: File, signal?: AbortSignal): Promise<Attachment> {
  return api<Attachment>("/attachments", {
    method: "POST",
    rawBody: file,
    headers: {
      "Content-Type": mimeByName(file.name) ?? "application/octet-stream",
      [FILENAME_HEADER]: encodeURIComponent(file.name),
    },
    signal,
  });
}

/** `GET /attachments/:id/content` kèm Bearer (không `<a href>` trần). */
export async function fetchAttachmentContent(id: string): Promise<Blob> {
  return (await apiResponse(`/attachments/${encodeURIComponent(id)}/content`)).blob();
}
