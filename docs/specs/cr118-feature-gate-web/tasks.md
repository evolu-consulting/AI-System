---
id: cr118-feature-gate-web
lát: cr118-feature-gate-web
cr: CR-118
làn: nhanh (N2/N3)
migration: không
phụ thuộc: cr118-auth (setAppsSource), server /pack/me + SSE config.changed (đã có)
---
## Plan (ngắn)
`platform/features`: provider OpenFeature mỏng trên `GET /pack/me` (ETag/304). Nguồn `PackMeSource` (thuần, tiêm fetch/listen/focus) giữ ảnh + ETag;
tải lại khi SSE `config.changed` (và khi nối lại `/me/stream`), focus cửa sổ (throttle 10 s), 403 từ API bất kỳ (QueryCache/MutationCache).
React: `<FeatureRoot>` (trong PackFrame) nạp cờ trước khi vẽ Shell; `useFeature`/`useCan`/`<FeatureGate>` xuất chỉ qua `platform/features/index.ts`.

## Làm
- `@openfeature/web-sdk@1.10.0` + `@openfeature/react-sdk@1.4.1` (phát hành 2026-07-28 / 2026-06-19).
- `platform/features/{lib/pack-me-source,lib/provider,adapters/http,gate,ui/FeatureGate,index}`.
- Ẩn menu trái + thanh dưới khi cờ `contracts` tắt (mặc định hiện khi chưa có ảnh); server vẫn là nguồn thật.
- `main.tsx`: `setAppsSource(featureAppsSource)` (nối `/pack/me.apps` cho `platform/auth`). KHÔNG nối route Community (lát cr118-shell).

## Không làm / Chạm
Không sửa server/contracts, community-web, modules/community, DLC. Không nâng ngân sách bundle.

## Test tối thiểu
- unit `apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts`, `adapters/http.test.ts`.
- e2e contracts-web (một lần cuối): `deploy/evotest/run-tests.ps1 -Step e2e -Filter contracts-web`.

## Quyết định trong lúc làm
- Cờ boolean phẳng từ `flags`; có ảnh mà thiếu khoá ⇒ tắt; chưa có ảnh (lỗi mạng) ⇒ giá trị mặc định của chỗ gọi (menu `contracts` mặc định hiện).
- web-kit coi 304 là lỗi ⇒ adapter bắt `ApiError(304)` thành `not-modified` (không sửa web-kit).
- SSE đọc riêng (không dùng `parseMeStreamProcessEvent`, nó bỏ khung lạ); nối lại giãn dần 1→30 s, 4xx (trừ 408/429) ⇒ dừng, focus/403 làm dự phòng.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-04 (đợt cr118-r1)

### ADDED sht/feature-gate-web.md
#### Yêu cầu: Cờ tính năng của web gộp theo chuẩn OpenFeature
Web gộp đọc `GET /pack/me` qua provider OpenFeature mỏng; app chỉ dùng `useFeature`/`useCan`/`<FeatureGate>` từ `platform/features`.
Cờ `contracts` tắt ⇒ menu SHT ẩn (server vẫn chặn). Cờ được tải lại khi server đẩy `config.changed` trên `/me/stream`, khi cửa sổ lấy focus
và khi một API trả 403; yêu cầu lặp dùng `If-None-Match`, 304 không đổi ảnh.
- Kịch bản: khi gọi lại `/pack/me` với ETag cũ và server trả 304 thì ảnh cờ giữ nguyên và không báo đổi [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » ETag gửi lại sau lần đầu và 304 giữ ảnh không báo]
- Kịch bản: khi nhận sự kiện `config.changed` thì tải lại và cờ mới có hiệu lực ngay [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » config.changed tải lại và báo khi ảnh đổi, nối lại sau đứt cũng tải]
- Kịch bản: khi API khác trả 403 thì tải lại cờ [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » 403 từ API khác gọi reportForbidden thì tải lại và nuốt lỗi]
- Kịch bản: khi cửa sổ lấy lại focus thì tải lại cờ (có throttle) [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » focus tải lại có throttle, stop gỡ listener và xoá ảnh]
- Kịch bản: khi có ảnh mà thiếu khoá cờ thì cờ tắt, khi chưa có ảnh thì dùng mặc định [test: apps/sohoptac-web/src/platform/features/lib/pack-me-source.test.ts » chưa có ảnh dùng mặc định, có ảnh mà thiếu khoá thì tắt]
- Kịch bản: khi server trả 304 qua web-kit thì adapter coi là không đổi [test: apps/sohoptac-web/src/platform/features/adapters/http.test.ts » gửi If-None-Match và 304 là not-modified]

## Việc còn lại
Nối `setAppsSource` cho route Community: lát cr118-shell.
