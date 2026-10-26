# upload-quota-popup (làn nhanh, Luật 0b)

Plan: khi `POST /contracts` trả 429 `UPLOAD_QUOTA` ⇒ dừng hàng đợi + popup một lần mỗi lô (contracts-web, không đổi API).
- `lib/upload-quota.ts` (thuần): `quotaNotice`, `formatResetsAt` (Intl, giờ trình duyệt), `quotaPopupText`, `stopOnQuota`.
- `hooks/use-upload-queue.ts`: gặp quota ⇒ xoá hàng đợi, `stopOnQuota`, đặt `quota` (cờ `quotaShown` reset khi lô mới lúc rảnh).
- `components/QuotaDialog.tsx` (shadcn Dialog) gắn ở `ContractsListPage`. i18n `contracts.list.upload.quotaPopup.*` vi/en.

Quyết định:
- Tệp vừa lỗi + tệp queued ⇒ error cùng câu, retryable=false; tệp đã xong giữ nguyên.
- Thiếu scope/limit/resets_at ⇒ câu `generic`. Giờ định dạng "HH:mm ngày dd/MM" qua tham số `time`/`date`.
- Sửa ca e2e cũ trong gap-b-list.cw.ts (mong đợi hành vi cũ "tệp sau vẫn tải") thành ca popup/dừng hàng đợi.

Việc còn lại: chạy e2e một lần cuối đợt; NewContractPage chưa dùng popup (chỉ trang danh sách).
