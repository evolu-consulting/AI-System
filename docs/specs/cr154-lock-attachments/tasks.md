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
HĐ ở bất kỳ trạng thái khác Nháp (đang duyệt, đã ký, từ chối…) là đang khoá: thêm hoặc gỡ tệp kèm trả 409 `CONTRACT_NOT_DRAFT`, kể cả quản trị. Danh sách tệp trả `locked`, `can_add=false`, `can_remove=false`; xem và tải vẫn được. Màn «Tài liệu kèm» ẩn nút Thêm/Gỡ và nói lý do. Luật ở MỘT chỗ (`isContractFilesLocked`); kiểm cùng giao dịch với ghi (câu ghi lọc `status='draft'`).
- Kịch bản: khi HĐ nháp thì người được giao (không phải người tạo) thêm/gỡ được; khi đang duyệt, đã ký, từ chối thì thêm/gỡ bị từ chối (locked → 409), xem/link vẫn được [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » nháp cho người được giao thêm gỡ, ngoài nháp thì khoá nhưng vẫn xem được]
- Kịch bản: khi HĐ rời Nháp giữa lúc đưa tệp lên thì câu ghi từ chối, byte vừa đưa lên bị gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » đua: HĐ rời Nháp]
- Kịch bản: khi trạng thái khác Nháp thì luật thuần không cho gắn/gỡ kể cả quản trị [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » CR-154 khoá tệp kèm]
- Kịch bản: khi HĐ đang duyệt thì UI ẩn nút Thêm tệp và hiện lý do [test: e2e/contracts-web/cr154-lock-attachments.cw.ts » HĐ đang duyệt: không có nút Thêm tệp]

Không thuộc luật này: tệp bằng chứng duyệt / bước Ký (CR-141 tải bản đã ký) — đi đường khác (`approval.routes`, `cks/signed.routes`), giữ nguyên.

## Tasks
- [x] rules `isContractFilesLocked` + canAdd/canRemove; repo facts trả status, insert/remove lọc draft; usecase `locked` → 409; contract `locked`
- [x] UI: ẩn Thêm/Gỡ + lý do (i18n vi/en); e2e mock viết (chưa chạy)

## Quyết định trong lúc làm
- Dùng lại mã `CONTRACT_NOT_DRAFT` (đã có ở submit). Cờ `locked` thêm vào response danh sách (cùng chỗ `can_add`) thay vì `can.*` của chi tiết HĐ — UI khối này đã đọc từ danh sách tệp.
- Chặn đua bằng điều kiện `status='draft'` trong chính câu INSERT/DELETE (nguyên tử), không cần khoá riêng.
- Chỉ có một đường ghi tệp kèm (contract-files.routes); messages-files / approval evidence là đường khác, không đổi.
- int test chạy local (`bun --env-file=.env.local --config=bunfig.int.toml test`): evotest từ Git Bash lỗi tar/scp, 0 test chạy.
