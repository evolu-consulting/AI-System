---
id: cr118-files-quota
lát: cr118-files-quota
cr: CR-118
làn: đầy đủ (F — quota/giới hạn tải, review TB)
migration: không
phụ thuộc: cr118-community-files
---
## Plan (ngắn)
Review TB: `POST /pack/community/files` không có trần lượt và đọc trọn thân vào bộ nhớ. Thêm cổng `CommunityUploadGate`
(trần người/phút + tenant/ngày + toàn hệ thống, dùng lại `redisUploadCounter`/`takeQuota`/`uploadDay` của contracts) và trần
upload đọc thân đồng thời mỗi tiến trình.

## Làm
- `community/application/pack-ports.ts`: cổng `CommunityUploadGate` (giữ lượt ⇒ trả hàm hoàn).
- `packs/community-quota.mount.ts` (lớp 4): `communityUploadGate` — Redis khoá riêng `q:community:`; tenant/ngày = Admin
  `dailyLimits.uploads` ∨ env `COMMUNITY_UPLOADS_TENANT_DAY` (mặc định 30); toàn hệ thống env `COMMUNITY_UPLOADS_GLOBAL_DAY` (300);
  người/phút env `COMMUNITY_UPLOADS_USER_MIN` (10). Redis vắng/lỗi ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE`.
- `files.routes.ts`: 413 theo `Content-Length` → chỗ đồng thời (8/tiến trình, hết ⇒ 429 scope `busy`) → giữ lượt → đọc thân →
  lưu; thất bại sau khi giữ lượt ⇒ hoàn lượt ngày.
- `contracts/adapters/upload-counter.redis.ts`: thêm tham số `prefix` (mặc định không đổi).
- TECH-DEBT #260 (`files_*` policy coi `app.user_id` rỗng là không giới hạn), #261 (tệp mồ côi).

## Không làm / Chạm
Không web, không migration, không đổi hành vi upload contracts.

## Quyết định trong lúc làm
- Bộ đếm riêng `q:community:` (không dùng chung khoá `q:contracts:t:`): tệp bài không ăn lượt tải hợp đồng (30/ngày mặc định, có
  AI trích); cùng con số hạn mức Admin. "Đặt lại hôm nay" của Admin chưa xoá khoá community (ghi Việc còn lại).
- 429 dùng chung mã `UPLOAD_QUOTA` với contracts, `details.scope` ∈ `user|tenant|global|busy`, `limit`, `resets_at` (trừ `busy`).
- Lượt/phút theo người không hoàn khi tải hỏng (chống dội); lượt ngày hoàn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Trần lượt tải tệp bài (CR-118 review)
`POST /pack/community/files` giữ một lượt trước khi đọc thân: vượt trần tenant/ngày, toàn hệ thống/ngày hoặc người/phút ⇒ 429
`UPLOAD_QUOTA` `{scope, limit, resets_at}`; tải hỏng sau khi giữ lượt được hoàn; tenant khác không bị ảnh hưởng.
- Kịch bản: khi tenant hết lượt ngày thì 429 scope tenant, tải hỏng được hoàn, tenant khác vẫn tải [test: apps/hub-api/src/modules/packs/community-quota.int.test.ts » [CR-118] tenant hết lượt ngày ⇒ 429 UPLOAD_QUOTA scope tenant; tải hỏng được hoàn; tenant khác vẫn tải]
- Kịch bản: khi một người vượt lượt/phút thì 429 scope user, người khác cùng tenant vẫn tải [test: apps/hub-api/src/modules/packs/community-quota.int.test.ts » [CR-118] người dùng vượt lượt/phút ⇒ 429 scope user; người khác cùng tenant không bị chặn]

## Việc còn lại
- Web: map 429 `UPLOAD_QUOTA` (scope) → thông báo; 503 `UPLOAD_QUOTA_UNAVAILABLE`.
- Admin "Đặt lại hôm nay" / hiển thị đã dùng chưa tính khoá `q:community:`.
