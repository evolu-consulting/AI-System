# Web gộp · cờ tính năng OpenFeature

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-feature-gate-web). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Cờ tính năng của web gộp theo chuẩn OpenFeature (nguồn: cr118-feature-gate-web)
Web gộp đọc `GET /pack/me` qua provider OpenFeature mỏng; app chỉ dùng `useFeature`/`useCan`/`<FeatureGate>` từ `platform/features`.
Cờ `contracts` tắt ⇒ menu SHT ẩn (server vẫn chặn). Cờ được tải lại khi server đẩy `config.changed` trên `/me/stream`, khi cửa sổ lấy focus
và khi một API trả 403; yêu cầu lặp dùng `If-None-Match`, 304 không đổi ảnh.
- Kịch bản: khi gọi lại `/pack/me` với ETag cũ và server trả 304 thì ảnh cờ giữ nguyên và không báo đổi [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » ETag gửi lại sau lần đầu và 304 giữ ảnh không báo]
- Kịch bản: khi nhận sự kiện `config.changed` thì tải lại và cờ mới có hiệu lực ngay [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » config.changed tải lại và báo khi ảnh đổi, nối lại sau đứt cũng tải]
- Kịch bản: khi API khác trả 403 thì tải lại cờ [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » 403 từ API khác gọi reportForbidden thì tải lại và nuốt lỗi]
- Kịch bản: khi cửa sổ lấy lại focus thì tải lại cờ (có throttle) [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » focus tải lại có throttle, stop gỡ listener và xoá ảnh]
- Kịch bản: khi có ảnh mà thiếu khoá cờ thì cờ tắt, khi chưa có ảnh thì dùng mặc định [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » chưa có ảnh dùng mặc định, có ảnh mà thiếu khoá thì tắt]
- Kịch bản: khi server trả 304 qua web-kit thì adapter coi là không đổi [test: apps/sohoptac-web/src/platform/features/adapters/http.test.ts » gửi If-None-Match và 304 là not-modified]
