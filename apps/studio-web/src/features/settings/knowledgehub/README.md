# features/settings/knowledgehub

Cài đặt → "Kết nối KnowledgeHub" [HUB-FR-131, HUB-FR-132, CR-073] (K1 F1): `/settings` (route lazy), nav `settings` nhóm Hệ thống.

- `api.ts`: `GET/POST /studio/api/kh/connections`, `PUT/DELETE /:id` (`DELETE ?version=`), `POST /:id/check`. Chỉ file này gọi API.
- `hooks/use-kh-keys.ts`: Select "Khoá" = `GET /secrets?kind=kh_api_key` lặp `next_cursor` (≤ 5 trang) rồi lọc client `tenant === null` (G14).
- `hooks/use-kh-check.ts`: mở Dialog ngay, hạn UI 25 s, làm mới hàng khi xong (KH lỗi vẫn 200).
- `components/KhConnectionForm.tsx`: RHF + zod (key i18n); lỗi server theo trường (`lib/save-error.ts`, G15 `{reason}` thô); 409 ⇒ ConflictDialog `rows=[]`.
- Sửa `base_url`/khoá ⇒ Alert "Lưu sẽ đặt trạng thái về Chưa kiểm tra…" (D7). Xoá: alertdialog, `KH_CONNECTION_IN_USE` ⇒ Alert trong hộp.

Bẫy: không có giá trị khoá ở bất kỳ đâu (chỉ `secret {id,name}`); `AbortSignal.timeout` bị `lib/http` đổi thành NETWORK_ERROR nên dùng `AbortController` riêng.
