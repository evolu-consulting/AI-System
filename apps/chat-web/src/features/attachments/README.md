# attachments (HUB-FR-44, X1 F3)
Đính kèm tệp trong Chat: chọn/kéo-thả → `lib/validate.rules.ts` (chặn sớm) → `hooks/use-attach-queue.ts` (≤ 3 upload, 429 thử lại 1 lần) → chip (`AttachmentChip`). `useAttachments` cấp `ids`/`busy` cho `Composer`; `AttachmentList` hiện `Message.attachments`; tải qua `lib/download.ts` (fetch có Authorization, không `<a href>` trần). API chỉ ở `api.ts`.
