---
id: cr191-audience-schema
lát: cr191-audience-schema
cr: CR-191
làn: đầy đủ
migration: pack-community 0025
phụ thuộc:
---
## Plan (ngắn)
Nền dữ liệu «Ai thấy bài» cho bảng tin gộp (BR-191-1/7/12): thêm mức `internal` (Chỉ nội bộ) + cột `aud_tenants` (id TENANT công ty kết nối chọn đích danh) ở DB, contract zod, và MỘT hàm thuần `audienceSees` (hub + web) với bảng chân trị dùng chung. Không đổi RLS/policy đọc, không đổi UI.

## Làm
- [x] Migration community `0025_cr191_audience_schema` (chỉ thêm; `aud_tenants uuid[]` ≤ 200; `posts_aud_ck` thêm `internal`; không backfill) + journal.
- [x] Contract `PostAudienceSchema`: mode `internal`, trường `tenants` (uuid ≤ 200).
- [x] Hub `domain/audience.rules.ts`: `AudienceViewer`, `audienceSees`; `audienceIncludes` xử lý `internal` ⇒ không.
- [x] Web `domain/audience-sees.ts` (cùng hàm) + `visibility.ts` xử lý `internal`.
- [x] Bảng chân trị dùng chung `tests/acceptance/com-c3/_support/audience-truth.ts` (unit hub + unit web + int SQL).

## Không làm / Chạm
- Không đổi RLS `posts_visible`, `community.audience_ok`, UI, `post-write.repo.ts` / `post.sql.ts` (ghi/đọc `aud_tenants` làm ở lát `cr191-feed-merge-rls` / `cr191-composer-audience`).
- Chạm: `packages/db/migrations-pack-community/0025*`, `packages/contracts/src/pack-community/post.ts`, `apps/hub-api/.../community/domain/audience.rules.ts`, `apps/workspace-web/.../community/domain/{audience-sees,visibility}.ts`, `adapters/seed.ts`.

## Test tối thiểu
- unit: `audience.rules.test.ts` (hub), `audience.test.ts` (web) — cùng bảng chân trị.
- int: `packages/db/src/community-cr191-audience.int.test.ts` (CHECK internal, aud_tenants ≤ 200, tiến từ ≤ 0022 + từ đầu, audience_ok = bảng); `visibility.rls.int.test.ts` (thêm ca internal: nội bộ không phải người đăng thấy, đối tác không thấy).

## Quyết định trong lúc làm
- `when` journal 0025 = 1807000640000 (> 0022; chừa khoảng cho 0023 cr192 / 0024). Khi merge: kiểm `when` 0023/0024 phải NHỎ hơn 0025 (guard migrate chặn nếu DB đã áp 0025 trước).
- Công ty kết nối + `cats` ⇒ không thấy; `companies` cho công ty kết nối chỉ xét `tenants` (id ext_org ở `companies` không áp chéo).
- `tenants` kiểu `uuid` ở contract (id tenant), `companies` giữ chuỗi ≤ 64 như cũ.
- `audience_ok` SQL không đổi (`ELSE false` đã loại `internal`).
- Hàm web đặt file riêng không i18n (`audience-sees.ts`) để unit chạy được không cần i18next.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Ai thấy bài
Bài chủ quản có thêm mức «Chỉ nội bộ» (đối tác ngoài không thấy) và danh sách công ty đã kết nối được chọn đích danh; người nội bộ thấy mọi mức; công ty đã kết nối thấy bài «Tất cả đối tác», nhóm Nhà cung cấp/Khách hàng theo nhãn của họ, hoặc khi được chọn đích danh.
- Kịch bản: khi bài «Chỉ nội bộ» thì chỉ người nội bộ thấy, đối tác và công ty kết nối không thấy [test: apps/hub-api/src/modules/packs/community/domain/audience.rules.test.ts » CR-191 audienceSees · bảng chân trị dùng chung (nội bộ / đối tác / công ty kết nối)]
- Kịch bản: khi nhân viên nội bộ không phải người đăng xem bài «Chỉ nội bộ» thì vẫn thấy [test: apps/hub-api/src/modules/packs/community/adapters/visibility.rls.int.test.ts » CR-191 internal · nhân viên không phải người đăng (được giao)]
- Kịch bản: khi bài cũ «Chọn công ty» chỉ có công ty đối tác thì công ty kết nối không thấy, đối tác trong danh sách vẫn thấy [test: apps/hub-api/src/modules/packs/community/domain/audience.rules.test.ts » CR-191 audienceSees · bảng chân trị dùng chung (nội bộ / đối tác / công ty kết nối)]
- Kịch bản: khi chạy migration trên DB đang ở bản trước thì bài cũ giữ nguyên mức xem và không mất bài [test: packages/db/src/community-cr191-audience.int.test.ts » tiến từ bản hiện tại]
- Kịch bản: khi lưu quá 200 công ty kết nối cho một bài thì DB từ chối [test: packages/db/src/community-cr191-audience.int.test.ts » CHECK: aud_tenants ≤ 200 (200 ok, 201 bị chặn)]

## Việc còn lại
- `post-write.repo.ts` ghi `aud_tenants`, `post.sql.ts` đọc `aud_tenants` ra `aud.tenants` (lát feed-merge / composer-audience).
- SQL `audience_ok` mở rộng cho người xem kết nối nằm trong hàm DEFINER `feed_connected` (lát feed-merge) — test bảng chân trị hàng `connected` ở đó.
