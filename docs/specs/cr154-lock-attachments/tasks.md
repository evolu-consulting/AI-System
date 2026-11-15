---
id: cr154-lock-attachments
cr: CR-154
lane: Sonnet (khoá thêm/gỡ «Tài liệu kèm» khi HĐ không còn Nháp; không migration)
---
# CR-154 · HĐ không còn Nháp thì không thêm/gỡ tệp đính kèm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Tệp kèm chỉ thêm/gỡ được khi HĐ còn Nháp
HĐ ở bất kỳ trạng thái khác Nháp (đang duyệt, đã ký, từ chối…) là đang khoá: thêm hoặc gỡ tệp kèm trả 409 `CONTRACT_NOT_DRAFT`, kể cả quản trị. Danh sách tệp trả `locked`, `can_add=false`, `can_remove=false`; xem và tải vẫn được. Màn «Tài liệu kèm» chỉ ẩn nút Thêm/Gỡ (không câu giải thích; trống thì một EmptyState duy nhất). CR-154b: khung «Diễn biến» của HĐ nguyên tắc không hiện khi trống và không thêm được; cột phải trống thì Thông tin full width. Luật ở MỘT chỗ (`isContractFilesLocked`); kiểm cùng giao dịch với ghi (câu ghi lọc `status='draft'`).
- Kịch bản: khi HĐ nháp thì người được giao (không phải người tạo) thêm/gỡ được; khi đang duyệt, đã ký, từ chối thì thêm/gỡ bị từ chối (locked → 409), xem/link vẫn được [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » nháp cho người được giao thêm gỡ, ngoài nháp thì khoá nhưng vẫn xem được]
- Kịch bản: khi HĐ rời Nháp giữa lúc đưa tệp lên thì câu ghi từ chối, byte vừa đưa lên bị gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » đua: HĐ rời Nháp]
- Kịch bản: khi trạng thái khác Nháp thì luật thuần không cho gắn/gỡ kể cả quản trị [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » CR-154 khoá tệp kèm]
- Kịch bản: khi HĐ đang duyệt thì UI chỉ ẩn nút Thêm tệp, không có câu giải thích khoá, và khi không có tệp chỉ hiện một trạng thái trống [test: e2e/contracts-web/cr154-lock-attachments.cw.ts » HĐ đang duyệt: ẩn nút Thêm tệp và chỉ một trạng thái trống]
- Kịch bản: khi HĐ không có mốc và không có lưu ý thì cột phải ẩn và khối Thông tin chiếm full chiều ngang trên desktop, mobile giữ nguyên [test: e2e/contracts-web/cr154-lock-attachments.cw.ts » HĐ không có mốc và không có lưu ý: khối Thông tin chiếm full chiều ngang (desktop)]

Không thuộc luật này: tệp bằng chứng duyệt / bước Ký (CR-141 tải bản đã ký) — đi đường khác (`approval.routes`, `cks/signed.routes`), giữ nguyên.

## Tasks
- [x] rules `isContractFilesLocked` + canAdd/canRemove; repo facts trả status, insert/remove lọc draft; usecase `locked` → 409; contract `locked`
- [x] UI: ẩn Thêm/Gỡ, EmptyState duy nhất, gỡ khoá i18n `locked`; e2e mock viết (chưa chạy)
- [x] CR-154b: FrameDiary trả null khi trống + không sửa được; DetailGrid cột phải `empty:hidden`, cột trái `col-span-2` (lg)

## Quyết định trong lúc làm
- Dùng lại mã `CONTRACT_NOT_DRAFT` (đã có ở submit). Cờ `locked` thêm vào response danh sách (cùng chỗ `can_add`) thay vì `can.*` của chi tiết HĐ — UI khối này đã đọc từ danh sách tệp.
- Chặn đua bằng điều kiện `status='draft'` trong chính câu INSERT/DELETE (nguyên tử), không cần khoá riêng.
- Chỉ có một đường ghi tệp kèm (contract-files.routes); messages-files / approval evidence là đường khác, không đổi.
- int test chạy local (`bun --env-file=.env.local --config=bunfig.int.toml test`): evotest từ Git Bash lỗi tar/scp, 0 test chạy.
- CR-154b: khung timeline trống = FrameDiary (HĐ nguyên tắc) và cột phải rỗng của DetailGrid; MilestoneList đã tự ẩn khi không mốc. FrameDiary vẫn hiện khi người sửa được (cần nút Thêm mốc, không có chỗ khác). Chưa chụp lại ảnh baseline (chưa chạy -Capture cw).
