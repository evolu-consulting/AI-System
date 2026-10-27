# esign-sweep · vòng nền bước Ký số

Trạng thái gộp: đã gộp 2026-10-27 (đợt ký số) — Đã gộp vào docs/current 2026-10-27
Nhánh: `slice/esign-sweep` (từ `platform/gd0` @ c8d268fc) · Làn: **đầy đủ** (vòng nền scope hệ thống quét mọi tenant + migration).

## Plan
- `domain/esign-sweep.rules.ts` · `esignDueOf(row, now, staleMin)` — luật thuần: kẹt `sending` > `ESIGN_SENDING_STALE_MIN`; nhắc mỗi `remind_every_h` từ `max(esign_at, esign_reminded_at)`; quá `due_h` từ `esign_at` mà `esign_escalated_at` trống/cũ hơn `esign_at`.
- `adapters/esign-sweep.repo.ts` · MỘT câu CTE mỗi tenant (≡ vị từ trên): chọn bước mở của LƯỢT hiện tại (`contracts.run_id`), `FOR UPDATE SKIP LOCKED`, lô ≤ 200; `sending` ⇒ `needs_decision SEND_FAILED`; `sent` ⇒ đặt mốc nhắc/chuyển cấp (một UPDATE, CASE). `escalateTargetsOf` MỘT câu hub scope cho cả lô Group.
- `application/esign-sweep.ts` · `sweepEsignOnce(d, now?)` (đồng hồ giả cho test), `startEsignSweeper` (ngủ chỉ giữa lượt), `esignSweepBells` (thuần). Mỗi tenant một tx: quét → (danh bạ nếu có Group) → `notify.enqueue` một lần ⇒ ≤ 3 câu/tenant, không phụ thuộc số hàng; chuông trong tx tenant ⇒ đúng tenant HĐ.
- `esign.mount.ts` · `ESignModule.startSweep(view)` (gọi trong `esignUserRoutes`, bật một lần): `APP_ENV` development/production và `CONTRACTS_ESIGN_SWEEP` ≠ `off`; chu kỳ `CONTRACTS_ESIGN_SWEEP_EVERY_MS` (mặc định 300 000, ≥ 1000).
- Migration `0064_esign_sweep`: `approvals.esign_reminded_at`, `esign_escalated_at` + index một phần `approvals_esign_open_idx (tenant_id, esign_at, id) where esign_status in ('sending','sent')`.

## Quyết định trong lúc làm
- Kẹt `sending` KHÔNG tự gửi lại (tránh phong bì đôi) — chỉ cần quyết + chuông người phụ trách (cùng câu chữ chuông "cần quyết" hiện có). Gửi lại tay vẫn như cũ (`needs_decision` vốn được Gửi lại).
- Mốc nhắc/chuyển cấp so với `esign_at` của lần gửi hiện tại ⇒ Gửi lại tự "reset" mà không sửa `claim`/`set` (không đổi hành vi bước esign đã có).
- Người nhận chuyển cấp: trưởng phòng (`admin.departments.head_user_id`) của Group còn dùng được; Group không có trưởng ⇒ thành viên còn dùng được (≤ 50). Kèm người phụ trách HĐ; bỏ trùng. Group khác tenant ⇒ không thấy (lọc `tenant_id`).
- Nhắc chỉ chuông nội bộ người ký công ty (`esign_signer`); không gọi nhà cung cấp (Luật 4c: chỉ trạng thái DB). Nhắc tiếp tục sau quá hạn tới khi phong bì xong.
- Mốc giờ là tham số `now` của câu SQL (không `now()` DB) ⇒ test đồng hồ giả không cần sửa hàng.
- `packs.mount.ts` đã 398 dòng ⇒ gắn vòng qua `esignUserRoutes` (không thêm dòng); `contractsTenants` lặp 5 dòng `packTenants` (tránh import vòng packs.mount ⇄ esign.mount).

## Delta (so với docs/current/sht/duyet-ky-so.md §4)
- Bước Ký số của luồng duyệt có vòng nền (mỗi 5'): kẹt "đang gửi" > 10' ⇒ "cần quyết" lý do gửi không thành công + chuông người phụ trách; phong bì chờ ký ⇒ chuông "Nhắc ký số HĐ …" cho người ký công ty mỗi `remind_every_h` giờ; quá `due_h` giờ ⇒ chuông "Ký số HĐ … quá hạn" cho người phụ trách + trưởng phòng/thành viên Group chuyển cấp, một lần mỗi lần gửi. Env `CONTRACTS_ESIGN_SWEEP=off`, `CONTRACTS_ESIGN_SWEEP_EVERY_MS`. Migration `MG/0064_esign_sweep.sql`.

## Test
- Unit: `application/esign-sweep.test.ts` (luật đến hạn, đồng hồ giả; chuông của lô).
- Int: `adapters/esign-sweep.repo.int.test.ts` — kẹt ⇒ needs_decision SEND_FAILED; nhắc đúng một lần mỗi chu kỳ; quá hạn chuyển cấp một lần (trưởng phòng); chuông đúng tenant (2 tenant); số câu SQL/lượt cố định (4 / 2 / 5).
- Đã chạy: `test:int:par` (esign-sweep + approval-sweep.repo + tests/acceptance/esign-flow/) 18/18; unit liên quan 25/25; typecheck (trừ `@ai/agent-runtime`: script cần `docker` trong PATH — môi trường); biome sạch trên file của lát.

## Việc còn lại
- Thẻ HĐ chưa hiện mốc nhắc/quá hạn của bước Ký số (không bắt buộc).
- Chưa có `*.perf.int.test.ts` (chưa có ngưỡng cho vòng này); lô 200/tenant/lượt — tồn đọng lớn xả dần qua các lượt.
- Đồng bộ trạng thái phong bì với nhà cung cấp trước khi nhắc (cần vòng riêng ngoài lô, có giới hạn tốc độ) — không làm.
