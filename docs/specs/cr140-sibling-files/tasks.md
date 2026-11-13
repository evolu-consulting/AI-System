---
id: cr140-sibling-files
cr: CR-140
lane: Sonnet (một hàm SQL kế thừa liên kết tệp; không migration, không UI)
---
# CR-140 · Lượt con kế thừa tệp của lượt con anh em

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Tệp đính kèm lượt chạy — lượt con kế thừa tệp anh em
Lượt con mới nhận liên kết tệp của các lượt con anh em cùng lượt cha, cùng công ty (một câu SQL, chỉ liên kết, không trùng); bỏ anh em lỗi / hết hạn / huỷ và tệp đã xoá. Tệp của cha tới con sau qua anh em là chấp nhận (tệp đi theo lần mua); người được giao ở lượt con sau xem được tệp của lượt con trước.
- Kịch bản: khi lượt con thứ hai của cùng lượt cha mở thì thấy tệp của lượt con thứ nhất, lượt ngoài cây và công ty khác thì không [test: apps/hub-api/src/modules/attachments/run-links.sibling.int.test.ts » con thứ 2 thấy tệp của con thứ 1]
- Kịch bản: khi anh em lỗi hoặc tệp đã xoá thì không kế thừa [test: apps/hub-api/src/modules/attachments/run-links.sibling.int.test.ts » bỏ tệp đã xoá]

## Tasks
- [x] SQL kế thừa anh em + lọc trạng thái/tệp xoá
- [x] int `run-links.sibling.int.test.ts` (đường chính, chặn ngoài cây/công ty khác, bỏ lỗi/đã xoá)
- [x] docs/current/engine/flow-runtime.md (BR + kịch bản)
