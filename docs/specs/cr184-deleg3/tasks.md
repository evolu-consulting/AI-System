---
id: cr184-deleg3
lát: cr184-deleg3
cr: CR-184
làn: nhanh
migration: không
phụ thuộc: cr184-deleg2
---
## Plan (ngắn)
Minor soát Opus của deleg2: #1 con trỏ thay offset; #3 siết `esign-eligible`; #4 ẩn mã hợp đồng.

## Làm
- [x] #1 `history` và `:id/work` tải dần theo con trỏ `(created_at, id)` / `(decided_at, id)` (base64url, micro-giây giữ nguyên; index `delegations_history_idx`); web `DelegationHistory` tải theo `next_cursor`.
- [x] #3 `esign-eligible`: mọi thành viên hỏi được (form cần để khoá nút) nhưng chỉ về người họ được chọn làm người nhận (nhân viên nội bộ còn hoạt động của công ty); người khác ⇒ `false`.
- [x] #4 `work`: `pack_record_id` chỉ cho người vắng, người được giao và quản trị; trưởng phòng chỉ thấy tên bước.

## Không làm / Chạm
- Không đổi hình dạng bản ghi; `next_offset` / `offset` bỏ khỏi hai API (chưa ai ngoài web dùng).

## Test tối thiểu
unit `delegations.cursor.test.ts`; int evotest `delegations-history.int.test.ts` (19 pass cùng `delegations.int`, `sign-delegation.int`).

## Quyết định trong lúc làm
- Giữ `esign-eligible` cho mọi thành viên (đường chọn người nhận vốn mở cho mọi nhân viên nội bộ) và chặn ở đúng phạm vi đó, thay vì giới hạn quản trị/trưởng phòng làm hỏng form của người thường.
- Con trỏ sai định dạng ⇒ 422 `VALIDATION_ERROR`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Lịch sử uỷ quyền tải dần theo con trỏ và không lộ mã hợp đồng (CR-184)
Lịch sử và danh sách việc làm thay tải dần theo con trỏ (`next_cursor`); mã hợp đồng của việc làm thay chỉ hiện cho người vắng, người được giao và quản trị công ty. Hỏi «Ký hợp đồng» chọn được cho ai chỉ trả lời cho người có thể chọn làm người nhận.
- Kịch bản: khi lịch sử dài thì tải dần theo con trỏ, không trùng dòng, con trỏ sai bị từ chối [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » tải dần theo con trỏ]
- Kịch bản: khi trưởng phòng xem việc làm thay thì không thấy mã hợp đồng [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » việc làm thay: con trỏ]
- Kịch bản: khi hỏi người không thuộc công ty thì trả không chọn được [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » esign-eligible]
- Kịch bản: con trỏ mã hoá giữ micro-giây [test: apps/hub-api/src/modules/processes/delegations/delegations.cursor.test.ts » mã hoá rồi giải mã]
