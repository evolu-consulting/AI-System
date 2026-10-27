# esign-flow · Bước Ký số trong luồng duyệt HĐ + người duyệt cụ thể

Trạng thái gộp: chưa gộp
Nhánh: `slice/esign-flow` · Làn: **đầy đủ** (engine + quyền + tenant) · Luật 0b (một agent làm trọn).

## Plan ngắn
1. DTO `@ai/contracts`: bước `kind:"esign"` (`company_signer{mode owner|dept_head|user, department_group_id?, user_id?}`, `partner_signs`, `order`, `provider|null`, `due_h`, `remind_every_h`, `escalate_group_id`); bước review thêm `approver_user_id?`; thẻ duyệt thêm `esign{key,name,status,reason,can_resend}`; luật `ESIGN_MULTI`, `ESIGN_NOT_LAST`, `SIGNER_GROUP_REQUIRED`, `SIGNER_USER_REQUIRED`, `USER_NOT_MEMBER`.
2. Domain gói: `approval-flow-esign.rules.ts` (kiểm bước Ký số, người cụ thể, người ký, thứ tự ký, ô thẻ); `engineSteps()` bỏ bước Ký số khỏi def/route/finalize (Ký số luôn cuối ⇒ chỉ số stage không đổi).
3. Engine (frozen, lát yêu cầu): `after.review.approver_user_id` = cửa một người (như `head_only`, thắng nó): `headGate`, `headGateSql` (chuông/nhắc/Việc của tôi), `gate-task.repo` (cổng quyết), `reviewGroupMember`. Group gắn task = phòng của bước, không phòng ⇒ Group Toàn quyền đầu tiên; Group Toàn quyền vẫn quyết qua `also_group_ids`.
4. Gói: migration `0062_esign_flow` (approvals: `esign_status|reason|signer|at`). `esign-flow.usecase.ts`: tool finalize SAU commit ⇒ `afterApproved` (claim idempotent) ⇒ người ký theo cấu hình ⇒ email đối tác từ liên hệ đối tác ⇒ `esign.sendSystem` (scope hệ thống, người ký ≠ người bấm) ⇒ `sent` + chuông người ký; hook `onStatus` của use case ký số (webhook/làm mới): completed ⇒ `completed`, declined/voided ⇒ `needs_decision` + chuông người phụ trách. `POST /contracts/:id/approval/esign-resend` (người phụ trách/owner). K4 mở lại HĐ ⇒ `esign.voidOpen` (bản đã ký cũ giữ).
5. Lưu mẫu: người cụ thể (duyệt + ký) phải thuộc tenant + quyền `write` gói (`packWriters`, một câu) ⇒ khác ⇒ 422 `APPROVAL_FLOW_INVALID` `USER_NOT_MEMBER`.
6. FE: Cài đặt › Quy trình duyệt: "Thêm bước Ký số" (`FlowEsignFields`), "Người duyệt cụ thể" ở bước duyệt; trang chi tiết: dòng Ký số trong tiến trình (`EsignStepRow`, nút Gửi lại). i18n `esignflow.{vi,en}.json` (trước `docframe`, gộp sâu vào `flow`/`approval`).

## Delta (so với docs/current)
- `docs/current/sht/duyet-ky-so.md` §1b: mẫu luồng có thêm bước **Ký số** (tối đa 1, bước cuối; không là stage engine — gói chạy sau "Đã duyệt"); bước review có **người duyệt cụ thể** `approver_user_id` (thay phòng; engine: cửa một người như `head_only`). Thẻ duyệt có `esign`. Route mới `POST /contracts/:id/approval/esign-resend`. Lưu mẫu kiểm người cụ thể thuộc tenant + quyền ghi gói (422 `USER_NOT_MEMBER`).
- §4 Ký số: gửi ký có đường **tự động** (scope hệ thống, người ký công ty theo cấu hình bước, không phải người bấm); trạng thái cuối của phong bì cập nhật bước Ký số + chuông (`contract.esign`). Mở lại HĐ (K4) **huỷ phong bì đang mở** (gỡ "Chưa rõ" mục 3 phần HĐ mở lại). Không có bước Ký số ⇒ như cũ (Gửi ký tay).
- Migration gói `0062_esign_flow` (idx 58). Hub không cần migration (snapshot jsonb).

## Quyết định trong lúc làm
- Bước Ký số không biên dịch thành stage engine (engine không có "chờ sự kiện ngoài"); trạng thái bước ở `contracts.approvals.esign_*` của lượt hiện tại (`contracts.run_id`). Hook `onStatus` chỉ tác động lượt hiện tại đang `sent` (mở lại HĐ ⇒ lượt mới ⇒ webhook muộn của phong bì cũ không đổi gì).
- `due_h`/`remind_every_h`/`escalate_group_id` của bước Ký số: lưu + kiểm giới hạn; **chưa** có vòng nhắc/chuyển cấp cho phong bì chờ ký (xem Việc còn lại).
- Quyền người cụ thể = Group được cấp `write` gói (người duyệt phải `write` để quyết qua route thẻ duyệt).
- Lỗi gửi tự động (nhà cung cấp tắt/không PDF/…) ⇒ `needs_decision` `SEND_FAILED`, không ném lại tool finalize (HĐ đã khoá).

## Test
- Unit: `domain/approval-flow-esign.rules.test.ts`, `application/esign-flow.usecase.test.ts`, `approval-engine.usecase.test.ts` (finalize ⇒ Ký số), `processes/domain/tasks/approver-user.rules.test.ts`, FE `settings/lib/flow-esign.test.ts`.
- Int: `tests/acceptance/esign-flow/esign-flow.int.test.ts` (tự gửi ký đúng người ký, completed ⇒ xong, declined/thiếu email ⇒ cần quyết + chuông, mở lại HĐ ⇒ void, lưu mẫu cross-tenant/viewer ⇒ 422), `approver-user.int.test.ts` (engine thật: chỉ người cụ thể quyết, Việc của tôi + chuông, chéo tenant).
- e2e: `e2e/contracts-web/esign-flow.cw.ts` (đã chạy cùng `flow-editor.cw.ts`: 9/9).

## Việc còn lại
- [ ] Vòng nhắc/chuyển cấp cho bước Ký số chờ ký (`remind_every_h`, `due_h` + `escalate_group_id`) — cần vòng nền (approval-sweep) đọc `esign_status='sent'` + `esign_at`.
- [ ] Engine `def.rules` chưa kiểm `approver_user_id` thuộc tenant cho def nhập tay ở Studio (gói đã kiểm khi lưu mẫu).
- [ ] UAT trình duyệt thật + `test:all` cuối đợt.
