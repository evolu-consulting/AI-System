---
id: cr121-q4-contract-name
lát: cr121-q4-contract-name
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-f5-notify-vars
---
## Plan (ngắn)
Cột `contracts.title` là tên file lúc tải lên; tên HĐ thật ở `fields.title`. F-5 đã có MỘT định nghĩa `contractNameSql`. Lát này chuyển MỌI chỗ
đọc tên HĐ trong `packs/contracts` sang định nghĩa đó (Luật GỐC 1) và thêm check tự động chặn tái phát.

## Làm
- `adapters/contract-name.sql.ts`: thêm `contractLabelSql` (mã HĐ, thiếu ⇒ tên HĐ) cạnh `contractNameSql`.
- Chuyển sang `contractNameSql`: `context-label`, `activity` (3 chỗ), `mywork` (`dl`/`rm` + 3 biểu thức), `esign.repo` (⇒ `intake.tools`, trang ký số),
  `rep.sql`, `transactions-read.sql`, `manage`, `appendix` (2), `business` (2), `followups`, `ledger-read`, `service-customers`, `todo` (`TITLE`),
  `delete-contract` (xem trước), `doc-types.sql` (3), `partner-roles`, `partners-data` (2), `sourcing`, `supplier-prices`, `contracts.repo`
  (danh sách, sắp xếp `title:asc|desc` theo tên thật, xuất tệp, chi tiết, HĐ cha, phụ lục).
- Chuyển sang `contractLabelSql` (nhãn mã-trước dùng cho thông báo): `esign-flow.repo`, `esign-sweep.repo`, `ledger-read` (`contract_number`).
- "Chờ tôi duyệt" (`mywork-approvals.usecase` ⇒ `approvalEngine.labels`) vốn đã dùng `contractNameSql` từ F-5; nay `mywork.repo` cũng vậy.
- Check `bun run check:contract-name` (`tools/scripts/src/check-contract-name.ts`, trong `bun run check`): quét file SQL của gói, bắt
  `fields -> 'title'` tự viết và `c.title`/`pc.title`/`fc.title` thô ngoài `contract-name.sql.ts`; có `ALLOWLIST` (file + số lần + lý do).

## Không làm / Chạm
- Không migration, không đổi schema, không đụng DLC. Không đổi số câu SQL (chỉ thay biểu thức cột).
- Chỗ GIỮ cột `title` (tên file), có trong `ALLOWLIST`: `upload-contract.repo.ts` (bản mới v n+1 kế thừa tên file bản cũ); `todo.repo.ts` (4 CTE chiếu
  cột thô `fields/number/title` để `contractNameSql(c)` ở truy vấn ngoài tính tên); `cks/adapters/cks-write.repo.ts` (`c` là đối tượng TS đầu vào,
  không phải cột). Chưa có API nào cần trả "tên file" riêng: chi tiết HĐ đã có `file.name` (tên tệp thật trong FileBox), nên không thêm `file_name`.
- `contract_delete_log.title` (nhật ký xoá) là ảnh chụp lúc xoá do DB ghi, không đổi trong lát (không migration).
- UI `workspace-web`: danh sách/chi tiết dùng `title` của API ⇒ nay ra tên thật; không sửa UI. `ContractReviewPage.titleOf` vẫn ưu tiên `fields.title`, trùng kết quả.

## Test tối thiểu
- unit `tools/scripts/src/check-contract-name.test.ts` (mẫu bắt + allowlist + mã nguồn hiện tại sạch).
- int `apps/hub-api/src/modules/packs/contracts/adapters/contract-name.int.test.ts`: `title` = tên file, `fields.title` = tên thật ⇒ danh sách + chi tiết +
  sắp xếp, Việc của tôi (hạn xử lý), nhãn lượt duyệt, nhãn ngữ cảnh trợ lý, nhật ký hoạt động đều ra tên thật.
- e2e: không đổi (không spec nào dựa vào tên file HĐ), không chạy.

## Quyết định trong lúc làm
- Biểu thức cũ `coalesce(fields.title, number, title)` (mywork, followups, todo, service-customers, ledger) giữ nhánh `number` (test W1/HD7 dựa vào) ⇒ gom thành `contractLabelSql`, không rơi về tên file khi đã có mã HĐ.
- Mã-trước (`coalesce(number, title)` của thông báo ký số, `contract_number` sổ cái) = `contractCodeSql`, nhánh dự phòng nay là tên thật.
- Số câu SQL không đổi; sắp xếp `title` nay trên biểu thức (tập đã lọc, trước khi cắt trang như cũ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Tên hợp đồng một nguồn ở mọi màn hình
Mọi nơi hiển thị tên hợp đồng (danh sách và chi tiết, Việc của tôi và Chờ tôi duyệt, nhật ký hoạt động, nhãn lượt duyệt, thông báo) dùng
trường "Tên hợp đồng"; chỉ khi trường này trống mới dùng tên file lúc tải lên. Sắp xếp theo tên cũng theo tên đó.
- Kịch bản: khi cột `title` là tên file còn trường "Tên hợp đồng" có giá trị thì danh sách, chi tiết và sắp xếp theo tên ra tên thật [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-name.int.test.ts » danh sách + chi tiết HĐ trả tên thật, sắp xếp theo tên thật (không theo tên file)]
- Kịch bản: khi HĐ có hạn xử lý thì Việc của tôi, nhãn lượt duyệt và nhãn trợ lý ra tên thật [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-name.int.test.ts » Việc của tôi (hạn xử lý HĐ) + nhãn lượt duyệt + nhãn ngữ cảnh trợ lý ra tên thật]
- Kịch bản: khi HĐ có sự kiện thì nhật ký hoạt động ra tên thật [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-name.int.test.ts » nhật ký hoạt động của một HĐ ra tên thật]
- Kịch bản: khi mã nguồn tự viết lại biểu thức tên HĐ hoặc đọc thô cột `title` ngoài định nghĩa chung thì check báo lỗi [test: tools/scripts/src/check-contract-name.test.ts » bắt tự viết tên HĐ từ fields.title và đọc thô c.title]

## Việc còn lại
- `contract_delete_log.title` còn là tên file (ảnh chụp lúc xoá, cần migration/trigger) — để lát có migration.
- Hiển thị `title` mới nhận tên thật cho cả HĐ cũ chưa có trường "Tên hợp đồng": vẫn ra tên file (dự phòng), không backfill.
