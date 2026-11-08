---
id: cr123-u10b-final-status
lát: cr123-u10b-final-status
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: cr123-u10-step-column
---
## Plan (ngắn)
Dòng danh sách HĐ sau "Kết thúc · Đã duyệt" vẫn đọc "Đang thực hiện · …". Cần đọc "Đã duyệt · Đang hiệu lực"; các kết cục khác đọc rõ: "Từ chối", "Đã huỷ", "Trả lại — chờ sửa".

## Làm
- Hub: `stepLabelOf` (MỘT helper, nguồn của `step_label`) — kết cục cuối đổi tên: "Từ chối" (bước bị từ chối thắng cả run đã huỷ/xong), "Đã huỷ", "Trả lại — chờ sửa", "Đã duyệt".
- Web: HĐ đã vào theo dõi mà `step_label` = "Đã duyệt" ⇒ nhãn "Đã duyệt · <trạng thái HĐ>" (`approvedLabel`); HĐ chưa vào theo dõi (từ chối / huỷ / trả lại) dùng thẳng `step_label` như u10.

## Không làm / Chạm
Không canvas, esign, partner; không đổi API (khoá `step_label` đã có từ u10).

## Test tối thiểu
unit `approval-step-label.rules.test.ts` (mỗi kết cục một ca) + `approved-label.test.ts`; journey e2e G2 một lần + ảnh.

## Quyết định trong lúc làm
- "Có hiệu lực" lấy đúng nhãn trạng thái đang dùng ở mọi nơi ("Đang hiệu lực") — không thêm chuỗi thứ hai cho cùng khái niệm.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Danh sách hợp đồng
Kết cục cuối của lượt duyệt đọc rõ trên dòng danh sách: Đã duyệt · Đang hiệu lực, Từ chối, Đã huỷ, Trả lại — chờ sửa; cùng một helper với bước hiện tại (`step_label`).
- Kịch bản: khi lượt duyệt kết thúc Đã duyệt, bị từ chối, bị huỷ hoặc bị trả lại thì nhãn lần lượt là Đã duyệt, Từ chối, Đã huỷ, Trả lại — chờ sửa [test: apps/hub-api/src/modules/packs/contracts/domain/approval-step-label.rules.test.ts » CR-123 · u10b · kết cục cuối đọc rõ: Từ chối (run xong hay đã huỷ đều là Từ chối khi có bước bị từ chối)]
- Kịch bản: khi HĐ đã duyệt xong và đang hiệu lực thì dòng danh sách đọc Đã duyệt · Đang hiệu lực [test: apps/workspace-web/src/features/contracts-list/lib/approved-label.test.ts » lượt duyệt Đã duyệt ⇒ ghép với trạng thái HĐ]
- Kịch bản: khi nhân viên mở danh sách có HĐ đã duyệt và HĐ đang chờ thì thấy cả hai nhãn [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại
