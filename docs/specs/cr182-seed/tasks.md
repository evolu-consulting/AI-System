---
id: cr182-seed
lát: cr182-seed
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-roles, cr182-partner-api, cr182-annex-verify
---
# cr182-seed — seed `--sign-only` theo vai + tài liệu UAT đợt 2

## Plan (ngắn)
Quy trình «Duyệt và ký hợp đồng (ký trên tài liệu)» dùng VAI (`after.role` «Trưởng phòng duyệt», `args.signer_role` «Người ký hợp đồng»); giao việc bằng `PUT /pack/contracts/approval-flow/roles` (token `demo-owner`, quản trị công ty). Thêm quy trình phụ có vai «Giám đốc duyệt» chưa giao (điều kiện `total_value < -1` ⇒ không khớp HĐ nào; đứng CUỐI thứ tự). HĐ mẫu Nháp + liên hệ đối tác có email đã có từ lát trước (đời 17).

## Làm
- [x] `seed-cr181-sign.data.ts`: `roleApprove`, `withSignerRole` (bỏ `withOnDocSigner`: không còn «Ký qua»/người ký cố định), `roleAssignPlan`, quy trình phụ, `signFlowOrder(…, last)`.
- [x] `seed-cr181-sign.flows.ts` (mới): tạo/áp dụng 2 quy trình, đặt thứ tự, giao vai; `seed-cr181-sign.http.ts` (mới): helper HTTP tách khỏi file chính (≤ 400 dòng).
- [x] Unit test (19 ca): bước Duyệt theo vai, bước Ký `signer_role`, quy trình phụ, thứ tự, kế hoạch giao việc.
- [x] `docs/uat/ky-tren-tai-lieu.md` mục 5 (đợt 2): giao việc trên sơ đồ, Xoè quạt/Liền mép, đối tác ký qua link (lệnh lấy link từ log), gửi lại/từ chối, phụ lục, Kiểm tra tệp, uỷ quyền + lịch sử.

## Không làm / Chạm
Không chạy trên máy chủ; không sửa/tắt quy trình UAT cũ.

## Test tối thiểu
`bun test tools/scripts/src/seed-cr181-sign*.test.ts` → 19 xanh; `tsc` tools/scripts.

## Quyết định trong lúc làm
- Bỏ `approver_mode: starter_head` ở bước Duyệt: người duyệt do giao việc (`binh.tran`), không theo phòng người đề xuất.
- Bước Ký không ghi `provider`: công ty bật `on_doc_enabled` ⇒ engine tự chạy `ondoc` (R3).
- Chưa kiểm chạy thật: PUT roles với `flow_id` = `flow_id` của quy trình công ty; nếu API chấp nhận id khác thì sửa ở `seed-cr181-sign.flows.ts`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: seed + tài liệu UAT)

## Việc còn lại
Điều phối chạy `seed-demo.sh --sign-only` trên bản test và soát log bước «giao vai».
