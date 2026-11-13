---
id: cr140-sibling-files
cr: CR-140
lane: Sonnet (một hàm SQL kế thừa liên kết tệp; không migration, không UI)
---
# CR-140 · Lượt con kế thừa tệp của lượt con anh em

## Delta (so với docs/current)
- `inheritRunFiles` (`apps/hub-api/src/modules/attachments/run-links.ts`): ngoài tệp cha truyền qua `input_map`, lượt con mới nhận liên kết tệp của các lượt con anh em cùng lượt cha, cùng công ty (một câu SQL, chỉ liên kết, không trùng).
- Bỏ anh em `failed` / `expired` / `cancelled` (thử lại mở lượt mới) và tệp đã xoá (`purged_at`). Không lọc theo vòng/lần thử: mỗi giai đoạn là một stage cha khác nhau, lần thử lại đã loại bằng trạng thái.
- BR: tệp của cha lọt sang con sau qua anh em là chấp nhận (tệp đi theo lần mua); người được giao ở lượt con sau xem được tệp của lượt con trước. `docs/current/engine/flow-runtime.md` cập nhật.

## Tasks
- [x] SQL kế thừa anh em + lọc trạng thái/tệp xoá
- [x] int `run-links.sibling.int.test.ts` (đường chính, chặn ngoài cây/công ty khác, bỏ lỗi/đã xoá)
- [x] docs/current/engine/flow-runtime.md (BR + kịch bản)
