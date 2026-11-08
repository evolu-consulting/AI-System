---
id: cr125-purchase-parent
lát: cr125-purchase-parent
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-subprocess-engine, cr125-parallel-approval-engine, cr125-manual-start-engine, cr125-purchase-templates
---
## Plan (ngắn)
Mẫu cha «Quy trình mua hàng» (phiếu → Phần 1 → 2 → 3 bằng node Quy trình con) + dòng 3 / 6 / 10 của 3 phần duyệt cùng lúc.

## Làm
- `library/purchase-templates.ts`: `mergeParallel` gộp các bước Duyệt liền nhau của bản xuất UI thành MỘT bước `after.parallel` (luật `all`):
  dòng 3 (Trưởng bộ phận + Tài chính), dòng 6 (Pháp chế + Kế toán + Trưởng bộ phận), dòng 10 (Kế toán trưởng + Người có thẩm quyền); đánh số lại
  bước, ánh xạ lại `back_to_steps`. Mẫu cha `PURCHASE_PARENT` (id `…d0`, khoá `quy-trinh-mua-hang`): `core.start-form` «Đề xuất mua hàng» (5 ô,
  mọi người trong công ty), 3 `core.subprocess` (rejected/cancelled → «Không mua»), «Đã xong». Phần 1 nhận phiếu qua `input_map`.
- `seed.cr125-config.ts`: ghi mẫu cha vào Thư viện + gán cho công ty có `contracts-read` (`assignManualFlows`, không điều kiện sự kiện).
- Test: unit `purchase-templates.test.ts`; int `tools/scripts/src/seed-cr125-config.int.test.ts`; e2e viết, chưa chạy: `e2e/journey-approval/cr125-purchase-full.spec.ts`.

## Không làm / Chạm
Không migration, không UI. 3 phần KHÔNG gán làm flow công ty (chỉ chạy làm lượt con, đọc thẳng từ Thư viện).

## Test tối thiểu
- unit 7 pass; int evotest -Dirty `seed-cr125-config.int.test.ts` 6 pass.

## Quyết định trong lúc làm
- Mở trùng: lượt con do node Quy trình con mở trực tiếp (`resolveSubprocessDef`, tìm theo khoá), phần không có `company_flows` ⇒ sự kiện HĐ không mở thêm. Bản xuất bản trong DB BẮT BUỘC có «Bắt đầu khi» (`process_defs_published_ck`, migration 0110) nên cả cha và 3 phần mang `NEVER_TRIGGER` = `contract.submitted` + `when total_value < -1` (không bao giờ đúng) ⇒ cha (đã gán) không tranh quyền duyệt HĐ.
- Đầu vào Phần 1 đổi từ `contract_id` sang 4 ô tuỳ chọn (nội dung, số lượng, dự toán, lý do); Phần 2–3 giữ `contract_id` không bắt buộc.
- Số lượng của phiếu là chữ ngắn (loại ô phiếu không có số).

## Việc còn lại
- Phần 2 «Ký số» cần `contract_id`, lượt cha không có HĐ ⇒ bước Ký số của Phần 2 chạy làm lượt con sẽ «Cần xử lý» cho tới khi có cách đưa HĐ vào (vd ô «Mã hợp đồng» ở phiếu hoặc bước tạo HĐ). Chưa quyết.
- e2e `cr125-purchase-full` chưa chạy; bước điền (form) dùng thẻ `form-step-card` của lát cr125-form-step-card (chưa gộp lúc viết).
- Tệp báo giá của phiếu không đi vào Phần 1 (ô tệp không có trong đầu vào lượt con).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Mẫu «Quy trình mua hàng» chạy bằng phiếu và ba phần cùng duyệt
Thư viện có mẫu cha «Quy trình mua hàng» bắt đầu bằng phiếu «Đề xuất mua hàng» rồi chạy lần lượt Phần 1, 2, 3 như quy trình con; một phần bị từ chối hoặc huỷ thì kết thúc «Không mua». Dòng 3, 6, 10 của ba phần có nhiều nhóm duyệt cùng lúc (luật tất cả). Ba phần không tự mở theo sự kiện hợp đồng.
- Kịch bản: khi seed cấu hình công ty thì mẫu cha qua templateReadiness, qua kiểm Quy trình con (không vòng, không quá sâu), dòng cùng duyệt hợp lệ và ba phần không có flow công ty [test: tools/scripts/src/seed-cr125-config.int.test.ts » «Quy trình mua hàng» (cha): readiness ready, guard Quy trình con (không vòng / sâu), cùng duyệt hợp lệ, 3 phần không gán và không bắt đầu theo sự kiện]
- Kịch bản: khi xem mẫu cha và ba phần thì dòng 3, 6, 10 là một bước cùng duyệt theo mã nhóm, số bước và Trả lại vẫn đúng [test: apps/hub-api/src/modules/processes/library/purchase-templates.test.ts » dòng 3 / 6 / 10 duyệt CÙNG LÚC (luật tất cả), nhóm theo mã]
- Kịch bản: khi nhân viên mở Tạo yêu cầu và gửi phiếu thì yêu cầu chạy qua ba phần tới Đã xong [test: thủ công — e2e/journey-approval/cr125-purchase-full.spec.ts chạy một lần ở đợt cuối]
