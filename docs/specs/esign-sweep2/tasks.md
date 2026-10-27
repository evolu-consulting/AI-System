# esign-sweep2 · thẻ bước Ký số (hạn/quá hạn/đã nhắc) + đồng bộ phong bì nền

Trạng thái gộp: đã gộp 2026-10-27 (đợt ký số) — Đã gộp vào docs/current 2026-10-27
Nhánh: `slice/esign-sweep2` (từ `platform/gd0` @ ac94ad6d) · Làn: **đầy đủ** cho phần quyền role `contracts_job` + migration; còn lại làn nhanh.

## Plan
1. Thẻ HĐ: `approval.repo` `state` đọc thêm `esign_at`, `esign_reminded_at` (ISO UTC). Luật thuần `esignDue` (`domain/approval-flow-esign.rules.ts`): `due_at = esign_at + due_h` chỉ khi `sent`; `overdue = now ≥ due_at` (giờ server); `reminded_at` chỉ khi ≥ `esign_at` (lần gửi hiện tại). `esignCard` trả thêm 3 trường; `@ai/contracts` `ContractApproval.esign` THÊM `due_at?`, `overdue?`, `reminded_at?` (tuỳ chọn, không phá). UI `EsignStepRow`: "Hạn ký: …", nhãn "Quá hạn" (màu `late`), "Đã nhắc lúc …"; i18n vi/en trong `esignflow` (không đổi thứ tự tuple).
2. Đồng bộ nền: `application/esign-sync.ts` (`syncEsignOnce`, `esignSyncEnv`) chạy SAU phần SQL của `sweepEsignOnce`, ngoài tx. `adapters/esign-sync.repo.ts` MỘT câu (role `contracts_job`, chéo tenant): phong bì `sent`/`delivered`, nhà cung cấp khả dụng KHÔNG demo, tenant bật gói (hai tham số JSON), `greatest(updated_at, sync_checked_at)` cũ hơn `now − MIN'`, cũ nhất trước, `limit MAX`, `FOR UPDATE SKIP LOCKED` + `sync_checked_at = now` trong cùng câu. Mỗi phong bì gọi `ESignUsecase.syncEnvelope` (tách từ webhook — CÙNG đường `sync`: void treo, cập nhật hàng, bản đã ký, `finalHook ⇒ onStatus` esign-flow), song song ≤ 4, lỗi chỉ log tên lỗi + tenant + provider.
3. Migration `0065_esign_sync`: cột `esign_envelopes.sync_checked_at`, index một phần `esign_envelopes_sync_idx ((greatest(updated_at, sync_checked_at)), id) where status in ('sent','delivered')`; `contracts_job` thêm SELECT (id, status, updated_at, sync_checked_at) + UPDATE (sync_checked_at) + policy UPDATE `esign_envelopes_job_sync` chỉ trên phong bì mở.

## Quyết định trong lúc làm
- Câu chọn chéo tenant dưới `contracts_job` (không lặp từng tenant) để giới hạn N là toàn cục và đúng "một câu"; quyền ghi của role job chỉ MỘT cột sổ sách `sync_checked_at` trên phong bì mở (không đọc người ký/lý do/tệp). Đồng bộ thật chạy trong tx hệ thống của đúng tenant (`syncEnvelope` ⇒ `uow.system(tid)`, `byEnvelope` lọc `tenant_id` + kiểm `provider`).
- Danh sách nhà cung cấp lọc = khả dụng trong registry và `demo === false` (ký thử không có trạng thái từ xa); danh sách rỗng ⇒ 0 câu SQL.
- Lọc tenant theo danh sách tenant bật gói của vòng (`contractsTenants`) ⇒ tenant tắt gói không bị gọi nhà cung cấp.
- Mốc "cũ" = `greatest(updated_at, sync_checked_at)` (GREATEST bỏ NULL) ⇒ phong bì vừa đổi (webhook/làm mới) cũng không bị hỏi lại sớm.
- Env: `CONTRACTS_ESIGN_SYNC_MAX` (mặc định 20, 0 = tắt, trần 200), `CONTRACTS_ESIGN_SYNC_MIN` phút (mặc định 15, ≥ 1). Bật/tắt cả vòng vẫn theo `CONTRACTS_ESIGN_SWEEP`.
- `overdue` tính ở server bằng giờ server lúc dựng thẻ (không thêm câu SQL: dùng hàng `state` đã đọc).
- `esign.usecase.ts` giữ ≤ 400 dòng: webhook gọi `syncEnvelope` (cùng hành vi cũ).

## Delta (so với docs/current/sht/duyet-ky-so.md §4)
- Thẻ duyệt, dòng Ký số khi đã gửi chờ ký: "Hạn ký: <giờ>", nhãn "Quá hạn" khi quá `due_h`, "Đã nhắc lúc <giờ>" khi vòng nền đã nhắc người ký lần gửi này.
- Vòng nền ký số (mỗi 5') hỏi lại nhà cung cấp tối đa 20 phong bì đang chờ mà ≥ 15' chưa đổi/chưa kiểm (lưới an toàn khi webhook không tới); phong bì xong/từ chối/huỷ ⇒ bước Ký số cập nhật + chuông như webhook. Migration `MG/0065_esign_sync.sql`.

## Test
- Unit: `domain/esign-card-due.test.ts` (hạn/quá hạn/đã nhắc, trạng thái khác `sent`, schema nhận trường mới + thiếu trường cũ vẫn hợp lệ).
- Int: `adapters/esign-sync.int.test.ts` — chọn đúng (bỏ phong bì mới đổi, ký thử, tenant không bật gói), đánh dấu lần kiểm, ký xong ⇒ bước Ký số `completed` cả T1 lẫn T2 (đúng tenant), chạy lại cùng mốc 0 lần gọi, +20' gọi lại đúng 2; câu chọn = 1 câu SQL.
- e2e (VIẾT, CHƯA CHẠY): `e2e/contracts-web/esign-flow.cw.ts` thêm 2 test thẻ (quá hạn + đã nhắc; chưa quá hạn).
- Đã chạy: `test:int:par` (esign-sync + esign-sweep.repo + tests/acceptance/esign-flow + cf-esign) 22/22; `bun test apps/hub-api/src/modules/packs/contracts` 703/703; i18n 11/11; typecheck hub-api, contracts-web, contracts, i18n xanh; biome sạch trên file của lát; `test:lock:write`.

## Việc còn lại
- Chưa có `*.perf.int.test.ts` cho câu chọn (chưa có ngưỡng; số phong bì mở nhỏ, index một phần).
- Thẻ chưa hiện lần kiểm nhà cung cấp gần nhất (không bắt buộc).
- Review security cuối đợt nên xem quyền mới của `contracts_job` (UPDATE một cột + policy UPDATE).
