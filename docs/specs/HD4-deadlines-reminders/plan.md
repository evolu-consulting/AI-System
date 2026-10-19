# HD4 · Plan (≤ 1 trang)

## 1. Dữ liệu — `migrations-pack-contracts/0003_hd4_reminders.sql` (chỉ cộng thêm)
- Bảng lịch `contracts.contract_schedule (contract_id PK, tenant_id, remind_at)` + index `(remind_at)` (tìm tenant) và `(tenant_id, remind_at)` (claim), RLS `secure_table`; không FK (`truncate` test HD1 khoá) — trigger AFTER DELETE/TRUNCATE dọn (D4-11).
- Trigger `BEFORE INSERT OR UPDATE` `contracts.hd4_schedule()`: tính `action_deadline` từ `fields` (cột sinh chưa có trong BEFORE),
  mở lại khi hạn đổi, đặt `remind_at = '-infinity'` khi HĐ vào trạng thái đã duyệt hoặc đổi hạn/handled/người phụ trách/end_date;
  HĐ chưa duyệt/phụ lục ⇒ null. `-infinity` không phụ thuộc đồng hồ (FakeClock trong test).
- Role `contracts_job` (D-12): NOLOGIN NOINHERIT NOBYPASSRLS, `GRANT SELECT (tenant_id, remind_at) ON contract_schedule`, policy
  `FOR SELECT TO contracts_job USING (true)` trên bảng lịch, `GRANT contracts_job TO hub_api WITH INHERIT FALSE, SET TRUE`.

## 2. Vòng nhắc (một lô = một tenant, số câu cố định)
1. `contracts_job` (tx riêng): `select tenant_id … where remind_at <= $now order by remind_at limit 1` — 1 câu.
2. `system(tenant)` (role `contracts_rw`): claim ≤ 100 hàng `FOR UPDATE SKIP LOCKED` theo `(tenant_id, remind_at)` — 1 câu.
3. Domain thuần (`deadline.rules.ts`): trạng thái theo ngày, mốc gửi, `next_at` (min các mốc chuyển/nhắc tương lai).
4. MỘT câu CTE (dữ liệu lô qua 1 tham số jsonb): update status/remind_at · insert `contract_reminders` ON CONFLICT DO NOTHING
   RETURNING · event `status_changed`/`reminded` · outbox · `notify.enqueue('contracts', …)` chỉ cho hàng nhắc vừa chèn.
Mỗi lô: `set_config` + claim + apply = 3 câu (+ 2 câu tìm tenant). `drain` lặp tới hết việc; vòng nền `startLoop` chỉ chạy
lại sau `CONTRACTS_REMIND_EVERY_MS` (mặc định 60 s) khi hết việc. Múi tenant: `ConfigCache.tenant(tid).timezone` (0 SQL).

## 3. API — `packages/contracts/src/pack-contracts/handled.ts`
`POST /pack/contracts/contracts/:id/handled` `{outcome}` → `200 {id, status, handled, action_deadline, version}`; lỗi theo spec FR-06.
Một tx: khoá hàng + update (CTE) + event + outbox = 2 câu sau `set_config`.

## 4. UI — `apps/contracts-web/src/features/contract-deadline/`
`DeadlinePanel` (port cm-web `page.tsx:324-341` + `ui.tsx:92-105` `Deadline`): chỉ hiện khi HĐ đã duyệt; nhúng một dòng vào
`ContractReviewPage` (S05 needs_review không đổi ⇒ ảnh baseline S05 giữ). Bản SPA `web/` của mgmt-app không có thẻ này.

## 5. Test (rủi ro cao viết trước code phần đó)
- Trước: `tests/acceptance/HD4/job-role.int.test.ts` (D-12, cách ly), `remind.int.test.ts` (idempotent, múi giờ, 2 tenant),
  `perf/remind.perf.int.test.ts` (lô 100, 10.000, số câu, EXPLAIN).
- Cùng code: unit `deadline.rules.test.ts`, int `handled.int.test.ts`, FE unit, e2e `e2e/contracts-web/hd4-deadline.cw.ts`.

## 6. Quyết định
| # | Quyết định |
|---|---|
| D4-01 | Lịch bằng cột `remind_at` trên `contracts` (due_at), không timer N2 từng HĐ (intake "không `wait_until` mỗi HĐ"). |
| D4-02 | Lô theo một tenant: `notify.enqueue` lấy tenant từ `app.tenant_id` (N3-FR-01) ⇒ lô chéo tenant cần N câu; tìm tenant bằng `contracts_job`. |
| D4-03 | Mốc 60/30/7/1/0 (intake câu 6, `settings.remind_days`), giờ nhắc 08:00 (`remind_hour`), ngưỡng `expiring` = mốc lớn nhất; hằng ở domain. |
| D4-04 | `action_deadline` tính bằng trigger DB (mọi đường ghi: PATCH HD1, nhập tay HD2, duyệt HD3) — bản TS cùng luật để test parity. |
| D4-05 | Đổi trạng thái do vòng không tăng `version`/`updated_at` (không làm 409 người đang sửa, không đảo thứ tự danh sách). |
| D4-06 | notice ngoài 0…3650 ⇒ 0 (tránh tràn ngày; `verify.py` đã cảnh báo trường lạ). |
| D4-07 | Nhắc giá `valid_to`, nhắc quản lý, mốc riêng từng người: ngoài lát (§1), ghi nợ. |
| D4-08 | Journal: `0003_hd4_reminders` thêm SAU `0005` (HD3 commit trước) với `when` lớn hơn mọi mục — drizzle bỏ lặng lẽ mục có `when` ≤ bản áp cuối. |
| D4-09 | Thân nhắc dùng số ngày thật tới hạn (mgmt-app in số mốc) — duyệt muộn còn 5 ngày không báo "còn 7 ngày". |
| D4-11 | Lịch tách sang bảng `contract_schedule` (không FK; dọn bằng trigger DELETE/TRUNCATE): UPDATE hàng `contracts` tính lại mọi cột sinh (100 hàng ~12 ms) + trigger plpgsql (~22 ms); trigger UPDATE có `WHEN` để lệnh của vòng không vào plpgsql. `contracts_job` chỉ đọc bảng lịch. Đo: lô 100 p95 129,6 → 61,1 ms (trước tách bảng), xem ket-luan. |
| D4-10 | Lỗi thân `/handled` = 400 `VALIDATION_ERROR` theo `parseWith` chung (mgmt-app 422). |
| D4-12 | Review M1/m2 (`0007_hd4_lock_order`): claim khoá `FOR NO KEY UPDATE OF c, s SKIP LOCKED` (HĐ trước, lịch sau — cùng thứ tự PATCH/`/handled`/mở lại duyệt), `upd` thêm `c.status = x.prev`; ghi lịch chuyển sang trigger AFTER ROW (quyết theo hàng đã chốt, không phụ thuộc thứ tự tên trigger BEFORE), phần tính hạn giữ BEFORE (phải sửa NEW). Hàng lịch mồ côi dọn khi claim ra 0 hàng; múi tenant sai ⇒ mặc định + warn. PK lịch giữ `contract_id` (nợ: `(contract_id, tenant_id)`). |
