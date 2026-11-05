---
id: cr121-f5-notify-vars
lát: cr121-f5-notify-vars
cr: CR-121
làn: đầy đủ (ghi input run, CAS)
migration: không
phụ thuộc: cr121-d6-notify-node, cr121-d6b
---
## Plan (ngắn)
Lỗi e2e `cr121-d6b-notify` ca 3: chuông người tạo HĐ ra "Đã duyệt xong hợp đồng · hop-dong-…", {ma_hd} rỗng. Nguyên nhân: `openRun`
chụp input run lúc mở run, khi HĐ còn tên file và chưa có số; người dùng chỉ điền ở "Xác nhận và lưu".

## Làm
Chọn (a). Thêm `PackRunsPort.updateInputs(ref, patch)`. Đây là MỘT câu SQL, chỉ áp cho run CÒN MỞ gắn đúng (gói, bản ghi) của tenant,
thay input theo khoá, compare-and-set theo `contracts.version` (lưu ở input `pack-record-version`; bản cũ hơn hoặc bằng thì không ghi).
Gói contracts gọi hàm này TRƯỚC mỗi lần Đạt trên thẻ duyệt (`refreshInputs` trong `approval-engine-card.usecase.ts`). Bước 0 = "Xác nhận
và lưu" là chỗ duy nhất được sửa trường HĐ, nên Đạt bước 0 luôn mang dữ liệu đã xác nhận. Input HĐ dựng chung một hàm
`contractRunInputs` (`approval-run-inputs.rules.ts`).

## Không làm / Chạm
Không đổi UI. Quy trình không có bước Dify/Thông báo/Chờ tới thì không gọi gì (0 SQL thêm).

## Test tối thiểu
- unit `approval-run-inputs.rules.test.ts`.
- int `tests/acceptance/CR-121/notify-vars.int.test.ts` (đỏ trước khi sửa, xanh sau).
- e2e `journey-approval-journey` đã chạy 1 lượt (d79d45d0): 15 pass, 1 đỏ ở `cr121-d6b-notify` ca 1. Lỗi là strict-mode `Nhân bản`
  (bấm khi chưa rời danh sách), nên ca 2 và ca 3 bị bỏ qua và chưa xác nhận được ca 3 trên e2e. Đã sửa test ở cả `cr121-d6b-notify` và
  `cr121-editor`: chờ URL chi tiết và đúng 1 nút rồi mới bấm, không nới assert. Chưa chạy lại vì đã hết 3 lượt evotest.

- e2e lượt điều phối (1fe6c9d9): ca 3 đứng ở "Ban Giám đốc" pending. Nguyên nhân gốc là race ở client/test, KHÔNG phải `updateInputs`.
  Trace cho thấy nhân viên bấm "Xác nhận và lưu" khi thẻ duyệt chưa có task mở: chỉ có POST `/review` (lưu nháp), KHÔNG có POST `actions/approve`;
  client báo "Bước duyệt đã thay đổi… đã tải trạng thái mới" (`use-approval-ui.tsx` so `task_id`), nên bước xác nhận không được Đạt.
  Đã sửa spec: chờ bước "Xác nhận hợp đồng" ở trạng thái open rồi mới bấm, sau đó kiểm passed.
- e2e d42017cf: luồng đã chạy hết (xác nhận, BGĐ duyệt, Thông báo Đạt) nhưng chuông vẫn ra "· hop-dong-…". Nguyên nhân gốc thứ hai:
  `difyFacts` đọc cột `contracts.title`, mà cột này là tên file lúc tải lên. Tên HĐ thật là `fields.title` (sổ cái/xuất dùng
  `coalesce(fields.title, …)`). Đã sửa `difyFacts`: tên = `coalesce(fields.title, title)`, dùng cho cả input Dify và mẫu Thông báo.
  Nhãn Q-1 (`record-label.repo.ts`) cũng đọc `c.title`, đã ghi vào việc còn lại.

## Quyết định trong lúc làm
- Không chọn (b) `recordLabelRegistry`: nó mở tx gói riêng (`createPackUow`) ngay trong tx khoá run, vi phạm Luật 4c, và chỉ có nhãn, không có giá trị/ngày.
- Điều kiện rẽ (giá trị HĐ) KHÔNG đọc input run: tool `contracts-route`/`contracts-finalize` dựng `FlowFacts` từ HĐ hiện tại dưới khoá HĐ
  (D-1 R3), nên rẽ nhánh vốn đã dùng số đã xác nhận. `updateInputs` chỉ đổi input (Dify, mẫu Thông báo, ngày Chờ tới), không đụng bước đã chạy.
- Việc D-5 ca 5 phải sửa 600→100 trước khi xác nhận là do bước 0 chỉ sửa được trước khi Đạt, không do input chụp; (a) không đổi việc này.
- Cập nhật input lỗi thì chỉ ghi cảnh báo `contract-approval-inputs-refresh-failed`, không chặn duyệt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Dữ liệu HĐ của lượt duyệt theo bản đã xác nhận
Trước mỗi lần Đạt, gói cập nhật input của lượt (số HĐ, tên, giá trị, người phụ trách, ngày) theo HĐ hiện tại. Bản cũ hơn không đè bản mới,
lượt đã kết thúc hoặc bản ghi khác thì không đổi. Thông báo sau bước duyệt dùng số và tên đã xác nhận, không dùng tên file lúc mở lượt.
- Kịch bản: khi mở lượt lúc HĐ còn tên file rồi xác nhận số + tên và Đạt thì thông báo ghi "Đã duyệt HĐ HD-09 · Mua máy chủ"; cập nhật bản cũ / lặp / sai bản ghi / sau khi kết thúc đều bị từ chối [test: tests/acceptance/CR-121/notify-vars.int.test.ts » mở run với tên file ⇒ cập nhật v2 sau xác nhận ⇒ Thông báo dùng số + tên đã xác nhận, v1 cũ / lặp / sai bản ghi bị từ chối]
- Kịch bản: khi quy trình không có bước đọc dữ liệu HĐ thì không cập nhật gì [test: apps/hub-api/src/modules/packs/contracts/domain/approval-run-inputs.rules.test.ts » quy trình chỉ có bước duyệt ⇒ không input HĐ]

## Việc còn lại
- Nhãn bản ghi Q-1 (`packs/contracts/adapters/record-label.repo.ts`) dùng `c.title` (tên file); nên đổi sang `coalesce(fields.title, title)` (lát khác).
