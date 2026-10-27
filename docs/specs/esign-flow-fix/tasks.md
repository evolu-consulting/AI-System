# esign-flow-fix · Sửa review cuối lát esign-flow

Trạng thái gộp: đã gộp 2026-10-27 (đợt ký số) — Đã gộp vào docs/current 2026-10-27
Nhánh: `slice/esign-flow-fix` · Làn: **đầy đủ** (engine + quyền + tenant).

## Đã sửa
1. (TB) `approver_user_id`: def Studio/gói kiểm user cùng tenant còn active (`def.rules` ⇒ `PROCESS_REF_INVALID` ref `user`). `approverSql(stage, tenant)` join `admin.users` (cùng tenant, active, không khoá); không thấy ⇒ NULL ⇒ rơi về cửa trưởng phòng / cả Group. Áp ở chuông/nhắc/Việc của tôi (`headGateSql`), cổng quyết (`gate-task.repo`), thẻ (`task-view`, `pack-runs-view`), `reviewGroupMember` (`approverOf`). `headGate` chỉ nhận người cụ thể khi SQL xác nhận.
2. (TB) Kẹt `sending` quá `ESIGN_SENDING_STALE_MIN` (10 phút, theo `esign_at`) ⇒ Gửi lại nhận (claim + `current.stale`); thẻ hiện nút Gửi lại.
3. (TB) Trước khi gửi: người ký công ty còn active/không khoá + còn quyền ghi gói (`packWriters`, gắn qua `bindView` lúc gắn route) + THẤY HĐ (RLS M1 của chính người đó); không ⇒ `NO_SIGNER`.
4. (TB) `voidOpen`: huỷ ở nhà cung cấp hụt ⇒ GIỮ phong bì mở, `reason = void-pending:contract-reopened` + log; `sync` (làm mới/webhook) thử huỷ lại (`application/esign-void.ts`).
5. (Thấp) Trạng thái cuối: MỘT câu `update … where esign_status='sent' returning`, chuông chỉ khi có hàng; lỗi hook ⇒ log.
6. (Thấp) Chuông cần quyết từ webhook có nhãn HĐ (số/tiêu đề).
7. (Thấp) Đối tác ký parse bằng `ESignSignerSchema` (adapter); sai ⇒ `NO_PARTNER_EMAIL`.
8. (Thấp) `can_resend` cho cả owner gói.
11. (Thấp) Người duyệt cụ thể không phòng + tenant không còn Group Toàn quyền ⇒ 422 `GROUP_REQUIRED` lúc lưu mẫu.
12. Migration `0062`: CHECK `NOT VALID` + `VALIDATE`.

## Delta (so với docs/current)
- `duyet-ky-so.md` §1b: người duyệt cụ thể chỉ hiệu lực khi user cùng tenant còn dùng được (khoá/xoá ⇒ cả Group duyệt quyết). Def engine kiểm `approver_user_id` thuộc tenant.
- §4: bước Ký số kẹt "đang gửi" > 10 phút ⇒ Gửi lại được; mở lại HĐ mà huỷ phong bì hụt ⇒ phong bì giữ mở, đánh dấu chờ huỷ, làm mới/webhook huỷ lại.

## Test
- Int (viết trước): `tests/acceptance/esign-flow/approver-guard.int.test.ts` (#1), `esign-flow-fix.int.test.ts` (#2–#5). Unit: `esign-flow.usecase.test.ts`, `approver-user.rules.test.ts`.
- Đã chạy: int esign-flow/CF/cf-esign/esign-multi/esign-anchor + approval-flow routes 62/62; e2e `esign-flow.cw.ts` 2/2.

## Việc còn lại
- Vòng nền tự quét `sending` kẹt (hiện chỉ Gửi lại tay) và nhắc/chuyển cấp phong bì chờ ký.
