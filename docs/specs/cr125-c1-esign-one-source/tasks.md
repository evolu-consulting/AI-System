---
id: cr125-c1-esign-one-source
lát: cr125-c1-esign-one-source
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa các dòng "ký số" của `docs/specs/CR-125/consistency-audit.md` (1, 6, 7, 8, 11, 12) theo Luật GỐC 1–2: một nguồn cho trạng thái ký, một định nghĩa "đã ký", ngày ký không lệch múi giờ, một luật + một bộ câu lỗi bước Ký số, một hằng giới hạn nhắc.

## Làm
1. Trạng thái: `esignLabelKey` (packages/contracts) — nguồn = trạng thái phong bì; dòng ký số của thẻ duyệt và khối Ký số cùng dùng nhóm khoá `contracts.esign.*`; bỏ khoá trùng "Đã ký xong / Đã gửi, chờ ký / Đang gửi ký" trong `esignflow`.
2. `isSigned` (hub `domain/esign-signer.rules.ts`) dùng ở nhắc ký (`esign-sweep.rules`), đổi cách ký (`esign-switch`), đầu ra node (`esign-outputs.rules`).
3. Đầu ra `signed_at` giữ mốc ISO đầy đủ; ngày hiển thị cắt theo giờ VN (`viDayOf`, `vn-day.ts`) — mẫu thông báo `notifyVars` đổi mốc ISO sang dd/mm/yyyy giờ VN.
4. `esignStepIssues` (packages/contracts) — hub `approval-flow-esign.rules` và admin `flow-form.ts` cùng gọi; `ESIGN_STEP_TEXT` là bộ câu lỗi duy nhất (hub messages dùng thẳng; i18n contracts + admin khớp bằng test).
5. Hằng nhắc 4–168 giờ: `max/min` của hai ô nhập (`StageRemind`, `StageApproveBasics`) và câu lỗi hub lấy từ `REMIND_EVERY_H`.

## Không làm / Chạm
Không migration; không đổi chữ đường dẫn cài đặt (agent khác). `node.ts` giữ `signed_at` kiểu "date" (sổ module đóng băng) — giá trị là mốc đầy đủ.

## Test tối thiểu
Unit: `esign-step-rules.test.ts`, `esign-labels.test.ts`, `esign-signer.rules.test.ts`, `esign-outputs.rules.test.ts` (ca 00:00–07:00 giờ VN), `library-publish.messages.test.ts`, `flow-form.test.ts`. Hành trình `journey-approval` một lần.

## Quyết định trong lúc làm
Nguồn trạng thái = phong bì; "Chờ duyệt xong" và "Cần xử lý" là trạng thái riêng của dòng thẻ (chưa có phong bì), giữ khoá riêng. Nhãn "Đã ký số lúc {at}" của khối Ký số là cùng nhãn "Đã ký số" kèm thời điểm.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Một mô hình trạng thái và một luật ký số
Thẻ duyệt và khối Ký số dùng cùng nhãn trạng thái ký; "đã ký" có một định nghĩa; ngày ký hiển thị theo giờ Việt Nam; luật và câu lỗi bước Ký số dùng chung giữa máy chủ và màn hình quản trị.
- Kịch bản: ký lúc 01:30 giờ VN thì ngày hiển thị là ngày VN và đầu ra giữ mốc đầy đủ [test: apps/hub-api/src/modules/packs/contracts/domain/esign-outputs.rules.test.ts » ký 00:00–07:00 giờ VN (UTC hôm trước): đầu ra giữ mốc UTC, ngày hiển thị là ngày VN]