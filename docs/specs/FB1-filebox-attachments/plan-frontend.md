---
id: FB1-plan-frontend
parent: FB1-filebox-attachments
---
# FB1 · Plan frontend — tách từ spec §5 (v1: chỉ F-3)

> Spec chính: [`spec.md`](spec.md) §5. Tóm tắt phạm vi FE ở spec §5.1. Chữ ký BE ở spec §3.4.

### F-2 Studio Secrets `filebox_token` — **Hoãn (Hardening)**
v1 CORE-ONLY nạp key bằng env `FILEBOX_TOKEN`; không UI, không AC-12. Thiết kế cũ (tab, i18n, e2e) có trong git history trước 2026-10-15.

### F-3 Rủi ro R-FE1 — tải attachment bằng `fetch` + Bearer + blob (CHẶN nếu không xử lý)
Phát hiện khi đọc code: **không có `<a href>` trần**. FE tải qua `fetch` kèm `Authorization` rồi `.blob()`/text:
- `apps/chat-web/src/features/attachments/api.ts` `fetchAttachmentContent` → `download.ts` (blob → object URL), `use-autofix-content`, `StageApply/Autofix`, `DecisionCard`, `ReviewTaskCard`.
- `apps/admin-web/src/features/processes/api.ts` `fetchAttachmentContent` (diff/log tự sửa — đọc **text** trong trang).

`fetch` theo 302 cross-origin tới `FILEBOX_URL/d/…`: (1) Bearer bị trình duyệt bỏ khi sang origin khác (tốt, link không cần key); (2) **cần FileBox trả `Access-Control-Allow-Origin`** cho origin web — nếu không, fetch lỗi `TypeError: Failed to fetch` ⇒ tải/diff/preview hỏng; (3) CSP `connect-src` của web phải cho phép origin FileBox. Hai điều kiện này **chưa xác nhận** (FileBox ngoài tầm kiểm soát).

**Đề xuất (không đổi contract, không đổi FE): BE phân nhánh theo header `Sec-Fetch-Mode`** do trình duyệt tự đặt, không giả mạo được từ JS:
- `navigate` / `Sec-Fetch-Dest: document|iframe` (mở thẳng URL) ⇒ **302** tới `/link`.
- `cors` / `same-origin` (fetch từ FE) hoặc header vắng (client không phải trình duyệt) ⇒ **Hub tự đọc bytes `/files/{id}/content` và phát inline** (như `local`, cùng đường byte-consumer §3.5, trần 20 MB).
⇒ mọi code FE hiện có giữ nguyên, chạy được dù FileBox không có CORS. Phương án thay thế (nếu BE từ chối): FE đổi sang `window.location`/`<a href>` cho nút Tải (mất Bearer ⇒ **không dùng được**, vì route cần auth) hoặc FileBox bật CORS + sửa CSP; cả hai tệ hơn. **Chưa xác nhận ⇒ đề nghị Gate chấp nhận phương án `Sec-Fetch-Mode`** và thêm AC cho BE: **FB1-AC-13** (`/content` với `Sec-Fetch-Mode: cors` ⇒ 200 bytes inline, không 302; `navigate` ⇒ 302).
