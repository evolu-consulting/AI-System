# fix-preexisting (làn nhanh)

Ba lỗi đỏ có sẵn, xử lý xong.

| # | Lỗi | Nguyên nhân | Quyết định |
|---|-----|-------------|-----------|
| 1 | bell.cw.ts:140/:157 không thấy checkbox Email | gap-c (35f84a7c) thêm route SPA `/notifications` nhưng proxy dev contracts-web vẫn chuyển mọi GET `/notifications` sang hub-api (và mock e2e cũng chặn document) ⇒ tải trang nhận JSON/lỗi proxy. Hồi quy thật | Sửa CODE: `rsbuild.config.ts` bypass GET Accept text/html ⇒ index.html (như chat-web); test cấu hình cập nhật + thêm ca bypass; e2e mock `r.fallback()` cho resourceType document |
| 2 | gap-d2.cw.ts:119 toEqual lệch | d8de93e1: thân PUT contacts bỏ khoá null (hợp đồng API không nhận null) | Sửa TEST: kỳ vọng `{ name, email }` |
| 3 | agents.test.ts:17 typecheck | `AgentSettingsItem` thêm `surface`, `serves`, `tier` bắt buộc (agents-background) | Sửa TEST: fixture thêm surface "chat", serves null, tier null |

Việc còn lại (ngoài lát): `deploy/prod-sohoptac2/nginx.conf` dòng 34 vẫn proxy `/notifications` cho contracts-web (tải lại trang /notifications ở prod sẽ nhận hub) — cần bypass kiểu khối `/runs|/rooms` (dòng 92).
