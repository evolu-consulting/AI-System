---
id: fix-flaky-1116
lát: fix-flaky-1116
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Điều tra 3 ca e2e chập chờn (đỏ một lượt, xanh lượt khác, code sản phẩm không đổi). Kết luận: cả 3 là test chờ sai theo tải máy, không phải lỗi sản phẩm.

## Làm
| Ca | Nguyên nhân gốc | Bằng chứng | Cách sửa | Chạy lặp trước → sau |
|---|---|---|---|---|
| `chat/send.chat.ts` CHAT-AC-06 (đếm «tăng dần ≥ 3») | TEST. Mock `normal` ở MOCK_FAST nhả 30 delta × 4 ms (~0,15 s); web gom delta 1 lần/khung hình (đúng spec §6) ⇒ máy tải chậm chỉ vẽ 1–2 trạng thái chữ, số đếm phụ thuộc tốc độ máy. Không phải lỗi sản phẩm. | `tools/mocks/src/chat/scenarios.ts` (`realWait`), `run-driver.ts` (`createBatcher`). Tái hiện: CPU chậm 6 lần (CDP `Emulation.setCPUThrottlingRate`) | Đặt mặc định mock = `slow` (100 ms/delta, hằng số) bằng `setMockScenario` mới (`_support.ts`); `resetMock` ở `beforeEach` trả về `normal`. Giữ nguyên ý AC: chữ hiện dần ≥ 3 trạng thái, cuối = `run.finished.content`, tiêu đề «Xin chào» | 3/15 xanh (đỏ 12) → 15/15 xanh (cùng điều kiện CPU chậm 6 lần) |
| `contracts-web/contract-flow.cw.ts` «bước chỉ trưởng phòng…» và «lối vào Chỉnh quy trình duyệt…» (cả biến thể tenant_admin) | TEST. Mỗi ca mở trang mới, tải nguội ~80 chunk JS qua tối đa 6 kết nối; lúc tải nặng thẻ duyệt vẽ sau goto ~7 s dù dữ liệu (approval + flow view) về từ ~3 s; phép chờ đầu dùng trần mặc định 5 s ⇒ «element(s) not found». Backend đã mock bằng `page.route`, không liên quan. | Trace log cũ `20261116-144658-23100-e2e` (e2e-2): goto→load 1,9 s; approval/flow 200 ở +3,1 s; request `groups` ở +5,2 s; hết 5 s ở +5,0 s. Tái hiện: CPU chậm 6 lần | Hằng `COLD = {timeout: 20_000}` cho phép chờ ĐẦU sau `goto` (chờ đúng phần tử thẻ duyệt / bước 1); các phép chờ sau giữ trần mặc định; không thêm retries, không đổi config chung | 30/36 xanh (đỏ 6, ba ca × 12) → 36/36 xanh |
| `cr127/j07-…spec.ts` «HĐ đối tác gửi hiện trong danh sách…» (`status-chip`) | TEST (suy luận, CHƯA tái hiện được). Lần gửi bị giữ chỉ thả ở B SAU khi B bấm Nhận (ca trước), bất đồng bộ ở nền tảng; ca này chờ `status-chip` của dòng đầu ngoài vòng `toPass` (trần 5 s, không tải lại) ⇒ dòng chưa tới là đỏ, trong khi phần «Đang chờ» ngay sau đã có vòng tải lại 60 s. | Mã `j07…spec.ts:35-48`; log cũ đã mất; chạy lặp 1 lần trên evotest (job rút còn j07, tải nhẹ) xanh cả trước lẫn sau | Đưa `status-chip` vào cùng vòng `toPass` (tải lại tới khi có dòng + chip + «Đang chờ») | trước 1/1 xanh (không tái hiện) → sau 1/1 xanh. Kết luận chưa chắc 100% (không thấy đỏ) |

## Không làm / Chạm
Chạm test: `e2e/chat/_support.ts`, `e2e/chat/send.chat.ts`, `e2e/contracts-web/contract-flow.cw.ts`, `e2e/cr127/j07-hai-cong-ty-gui-nhan.spec.ts`. Không chạm code sản phẩm, mock, config, known-red.

## Test tối thiểu
Chạy lặp trên evotest bằng cấu hình tạm (không commit): `repeatEach` + `grep` + CPU chậm 6 lần; xem bảng trên.

## Quyết định trong lúc làm
- Không thêm biến môi trường «chạy lặp» vào runner: sửa tạm cấu hình Playwright trong cây làm việc rồi hoàn lại trước khi commit (`-Dirty`), đỡ đổi hạ tầng.
- CHAT-AC-06 dùng kịch bản `slow` thay vì ép số khung hình: độ trễ mock cố định là cách đúng ý AC («chữ hiện dần theo delta») và không phụ thuộc máy.
- contracts-web: trần 20 s chỉ ở phép chờ ĐẦU sau goto (đúng điều kiện = thẻ duyệt hiện), không nâng `expect.timeout` toàn bộ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

Không thay đổi hành vi (lý do: chỉ sửa test e2e chờ sai theo tải máy; code sản phẩm, mock và cấu hình không đổi)

## Việc còn lại
- j07: chưa thấy đỏ để chứng minh; nếu còn đỏ lượt sau, lấy trace (`status-chip` / số dòng danh sách `source=partner`) rồi xét lại.
- Các ca contracts-web khác có phép chờ đầu sau `goto` mặc định 5 s có thể cùng bệnh tải nguội; chưa sửa (ngoài 3 ca được giao).
