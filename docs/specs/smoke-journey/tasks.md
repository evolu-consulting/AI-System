# smoke-journey — CR-159 (bài kiểm hành trình thật trên bản test / prod)

## Plan
Một lệnh kiểm môi trường đã deploy: tạo 2 công ty TẠM `smoke-a` / `smoke-b` (CLI onboarding + quy trình), chạy hành trình Playwright từ máy local tới URL công khai, rồi XOÁ SẠCH hai công ty (`tenant-purge --apply --confirm`, kể cả khi lỗi). Không đụng evolu / nitigroup / preschool (khoá cứng ở `smoke-flows.ts` + `smoke-server.sh`). Mật khẩu tạm sinh ngẫu nhiên trong bộ nhớ, đi qua stdin, không ghi đĩa.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ kiểm môi trường)

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Công ty tạm (giám đốc + trưởng phòng + nhân viên, hồ sơ MST giả, gói contracts + 2 add-on) | `deploy/smoke/tenants/smoke-a.yaml`, `smoke-b.yaml` | [x] |
| 2 | Dựng quy trình cho công ty tạm (dùng bộ của preschool) + bật Danh bạ như quản trị công ty (in mặc định) | `tools/scripts/src/smoke-flows.ts` | [x] |
| 3 | Phía máy chủ: setup / purge / probe (CR-169) | `deploy/smoke/smoke-server.sh` | [x] |
| 4 | Runner: `-Env test\|prod` (prod bắt buộc `-IKnowProd`), bảng Đạt/Không đạt, ảnh `.data/smoke/<lượt>/` | `deploy/smoke/smoke-journey.ps1` (+ vỏ `deploy/stg-test/`, `deploy/prod-sohoptac2/`) | [x] |
| 5 | Hành trình Playwright (S1…S18 + AI), không bằng bun | `e2e/smoke-journey/*.smoke.ts` | [x] |

## Cách chạy
`powershell -File deploy/stg-test/smoke-journey.ps1` (bản test) · `powershell -File deploy/prod-sohoptac2/smoke-journey.ps1 -IKnowProd` (prod; cần người dùng đồng ý từng lần). Cần khoá SSH `$HOME\.ssh\evoc_key`, Node. Thoát 0 = đạt · 1 = có bước sản phẩm không đạt · 2 = không dựng/dọn được công ty tạm.

## Quyết định trong lúc làm
- Image trên máy chủ KHÔNG đồng bộ nhánh (bản test thiếu `RECV_OWNER`): `smoke-flows.ts` chỉ import `flowsFor` + `WHO` (có ở cả hai bản), phần còn lại chạy bằng mã trong image ⇒ bài kiểm đúng cái đã deploy. File chép lên máy chủ qua base64/stdin (scp Windows hỏng khi đường dẫn khoá SSH có dấu cách).
- HĐ tạo bằng tải PDF (AI đọc); «nhập tay + chọn Loại» chỉ làm khi AI báo lỗi (màn Nhập tay chỉ có sau khi đọc lỗi/hết giờ, CR-157). Bước AI báo riêng, không làm hỏng bài.
- Bước tin nhắn (S18) chỉ chạy khi image có CR-169 (`pmsg_send`); viết theo nhãn CR-161/169 hiện có, CHƯA chạy thật (bản test chưa có CR-169).
- Danh bạ công ty TẮT mặc định ở công ty mới ⇒ bài ghi «Không đạt» ở S4 rồi bật bằng API như quản trị công ty để chạy tiếp.

## Việc còn lại
- Kết quả lượt chạy bản test + lỗi sản phẩm tìm thấy: xem báo cáo của điều phối. Chưa chạy prod (cần người dùng đồng ý, cờ `-IKnowProd`).
- S12 (chọn đối tác từ sổ đối tác), S15 (B ký + Đồng ý) viết theo mã hiện có, cần chỉnh nếu UI khác khi chạy thật.
