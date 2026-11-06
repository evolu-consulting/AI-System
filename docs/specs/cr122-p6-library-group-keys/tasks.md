---
id: cr122-p6-library-group-keys
lát: cr122-p6-library-group-keys
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi sản phẩm #6 (qc): flow Thư viện (def `tenant_id` null + `trigger`, không khe) bị coi là def công ty khi lưu, nên `POST/PUT /process-defs` đòi
`after.group_id` và từ chối `after.group_key` (`PROCESS_REF_INVALID`). Sửa: nhận diện "def Thư viện" = có khe HOẶC (tenant null + có trigger) —
cùng định nghĩa với `defs.repo` (`LIB_*`). Def Thư viện chỉ theo mã Group; mã → id theo công ty lúc mở lượt (E1b, `flow-launch.libraryDefFor`, đã có).

## Làm
- `defs/defs.service.ts`: `isLibraryDef(tenantId, slot, trigger)` thay `slot !== null` khi gọi `#check` ở `create`/`update` (update lấy trigger đang lưu khi body vắng).
- `contracts/hub-admin/processes.ts`: `after.group_id` của review có `.default(null)` ⇒ def Thư viện chỉ gửi `group_key`, không cần `group_id`.
- Int test `library/library-flow-publish.int.test.ts` (2 ca mới).

## Không làm / Chạm
Không đổi migration, engine chạy, `flow-launch`, `bindGroupKeys`. Xuất bản (`library.service.#flowIssues`) vốn không kiểm Group ⇒ không đổi.
Không đổi UI (admin-web gửi stage nguyên trạng).

## Test tối thiểu
`library-flow-publish.int.test.ts` (evotest -Dirty): 6 pass, gồm 2 ca P6.

## Quyết định trong lúc làm
- Def công ty: giữ luật cũ (chỉ `group_id`; `group_key` ⇒ 422 `PROCESS_REF_INVALID`) — không tự map mã → id khi lưu (đơn giản hơn, Group công ty có thể đổi; "Sao chép để sửa" đã map mã → id).
- Bật def Thư viện: đủ Group duyệt khi `after.group_key` có mặt (`reviewHasGroup`, đã có); thiếu ⇒ `PROCESS_DEF_INCOMPLETE`.
- Ca "task giao đúng nhóm": int kiểm đúng bước của `libraryDefFor` (bản xuất bản + `bindGroupKeys` với Group công ty) ⇒ `after.group_id` = id Group của công ty; chạy trọn mở lượt thật do e2e (nhánh q1) phủ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Flow Thư viện có node Duyệt theo mã Group không cần id
Flow Thư viện (không thuộc công ty, có sự kiện kích hoạt) chấp nhận mã Group (`group_key`) ở node Duyệt khi lưu, bật và xuất bản; không đòi `group_id`. Khi gán cho công ty và mở lượt, mã được đổi sang id Group của công ty đó và task duyệt giao đúng nhóm.
- Kịch bản: khi platform_admin tạo flow Thư viện có node Duyệt theo `group_key`, bật, xuất bản rồi gán công ty có Group mã đó thì lưu/xuất bản thành công và Group duyệt khi mở lượt là id Group của công ty [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P6 · flow Thư viện có node Duyệt theo group_key: tạo + bật + xuất bản + gán công ty ⇒ Group duyệt = id của công ty]

#### Yêu cầu: Def của công ty vẫn chỉ trỏ Group bằng id
Quy trình thuộc công ty không nhận `group_key` (mã chưa phân giải thì engine không chạy được).
- Kịch bản: khi lưu def của công ty có node Duyệt theo `group_key` thì bị từ chối 422 `PROCESS_REF_INVALID` [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P6 · def của công ty vẫn chỉ theo id: group_key ⇒ 422]

## Việc còn lại
- qc (nhánh slice/cr122-q1-e2e): bỏ `withGroupKeys` + ghi stages bằng SQL trong `e2e/_kit/flows.ts` (`createLibraryFlow`), tạo/bật/xuất bản qua API thẳng.
