# HD7 · Plan (≤ 1 trang)

## 1. Dữ liệu — `migrations-pack-contracts/0008_hd7_ledger.sql` (chỉ cộng thêm)
- `contracts.obligations` (uuid, `tenant_id`, `contract_id`, `party_key`, `direction`, `kind`, `seq`, `due_date`, `amount bigint`
  CHECK 0…10¹⁵, `status`, `done_at`, `done_by`, `postponed_to`, `postpones`, `reminders`, `overdue_for`, `source`, `estimated`,
  `basis`, `created_at`, `updated_at`). Không FK sang `contracts` (D9-02: test HD1 TRUNCATE không CASCADE). Index:
  `(tenant_id, contract_id, seq)`, `(tenant_id, status, due_date, id)`, `(tenant_id, party_key, due_date)`, `(tenant_id, done_at desc) where done`.
- `contracts.partner_events` (bigint identity, `party_key`, `role`, `type`, `at date`, `by_user`, `source`, `contract_id`,
  `obligation_id`, `days_late`, `amount`, `note`, `data jsonb`) + `contracts.partner_event_voids (event_id PK, by_user, at)`.
  REVOKE UPDATE, DELETE cả hai ⇒ sổ chỉ thêm, huỷ = thêm một hàng. Đợt: REVOKE DELETE.
- Hàm `contracts.party_key(name, tax)` IMMUTABLE (bản TS `ledger.rules.ts` cùng luật, dùng `fold`).
- Trigger `contracts_hd7_schedule` AFTER UPDATE … WHEN (chưa duyệt → đã duyệt, `kind='contract'`) ⇒ lập đợt mặc định (FR-02).
  Chạy trong UPDATE HĐ ⇒ thứ tự khoá HĐ → đợt. `secure_table` 3 bảng.

## 2. Ghi (một tx `PackUow`, role `contracts_rw`, số câu cố định)
`set_config` → ① khoá HĐ `FOR NO KEY UPDATE` (qua `contract_id` của đợt/sự kiện) + đọc đợt `FOR UPDATE` → luật thuần (`ledger.rules.ts`:
`daysLate`, `partyLate`, `undoOf`, `saneSchedule`) → ② MỘT câu CTE: cập nhật đợt + thêm sự kiện + `contract_events` (nhật ký) . PUT lịch:
② = CTE `replaced` + huỷ dòng quá hạn + chèn đợt mới (dữ liệu qua 1 tham số JSON) + event `schedule_set`.

## 3. Vòng quá hạn (theo tập)
Tenant có quyền gói (`packTenants`, 0 SQL như HD3) → mỗi tenant: `system(tid)` set_config + MỘT CTE (`SELECT … FOR UPDATE SKIP LOCKED
LIMIT 500` → UPDATE `overdue_for` → INSERT sự kiện) = 2 câu/lô; lặp tới < 500. Hôm nay = `localDate(now, tz)` (HD4, `safeTimeZone`).
Vòng nền `startLoop` mỗi `CONTRACTS_OVERDUE_EVERY_MS` (mặc định 1 giờ như `poll.py`), chỉ khi `worker`.

## 4. Đọc
`/payments`: MỘT câu (tổng theo `filter` aggregate + 500 hàng đầu theo `due_date,id` / `done_at desc` + `of` lateral). `/obligations`,
`/partner-events`, `/contracts/:id/partner`: MỘT câu mỗi route. CKS `paid`: CTE `k` của `liveCerts` thêm `exists/not exists` theo
`(tenant_id, contract_id)`.

## 5. UI — `apps/contracts-web/src/features/ledger/`
`ContractLog` (port `ContractPage.tsx:163-181`) nhúng cuối `ContractReviewPage` khi HĐ đã duyệt; `PartnerLog` + `InstalmentRow` +
`OtherForm` (port `PartnerLog.tsx`), chuỗi `ledger.{vi,en}.json`. Người ghi hiển thị qua danh bạ `members` (hệ thống ⇒ "Hệ thống tự ghi").

## 5b. Test (rủi ro cao viết trước code phần đó)
- Trước: `tests/acceptance/HD7/{money,access,overdue}.int.test.ts` (parity tiền/ngày, quyền/cách ly, quét quá hạn + múi), unit
  `ledger.rules.test.ts`, RLS (`rls-packs.int.test.ts`), `perf/ledger.perf.int.test.ts`.
- Cùng code: `cks-paid.int.test.ts`, FE unit, e2e `e2e/contracts-web/hd7-ledger.cw.ts` (hành vi + so màn).

## 6. Quyết định
| # | Quyết định |
|---|---|
| D7-01 | Migration 0008 (0007 là HD4). Journal: HEAD + mục của HD7, `when` > mục cuối của HEAD. |
| D7-02 | Đợt bị thay ⇒ `status='replaced'` (không xoá — sổ chỉ thêm, giữ dấu vết); mọi đọc/ghi coi như không tồn tại (404), như mgmt xoá. |
| D7-03 | Huỷ sự kiện = hàng `partner_event_voids` (không UPDATE sổ). `voided` suy ra khi đọc. |
| D7-04 | Đối tác = `party_key` (`tax:`/`name:`), không có bảng công ty (HD8 dựng danh bạ). Fold = `contracts.fold` (khác `match_form` ở `đ→d`, gộp khoảng trắng — khoá nội bộ, ghi chú cho HD8). |
| D7-05 | Thấy HĐ = cả tenant theo quyền gói (nền tảng không có phạm vi theo người phụ trách như `ctx.sees`); `manual_adjust` = quyền `admin` (mgmt `owner`). |
| D7-06 | Lỗi thân = 400 `VALIDATION_ERROR` (parseWith); lỗi luật 409/422 như mgmt. |
| D7-07 | Tổng tiền trong `stats` = chuỗi thập phân (NUMERIC), tiền từng đợt = số nguyên ≤ 10¹⁵ (an toàn JS, như D9-18). |
| D7-08 | `/payments` trả ≤ 500 hàng + `total` (mgmt trả hết; không có màn web dùng). |
| D7-09 | Lịch mặc định bằng trigger UPDATE (mọi đường duyệt: HD3), không chạm code HD3; CKS tự lập đợt nên trigger chỉ chạy khi UPDATE. AI đọc điều khoản: nợ (N2). |
| D7-10 | Vòng quá hạn liệt kê tenant từ cache quyền gói (không thêm role đọc chéo tenant); mỗi tenant ≥ 2 câu/giờ. |
| D7-11 | `by` của sự kiện = user id (mgmt: email); FE đổi ra tên qua `members`. `followups` (hẹn nhắc giờ) ngoài lát. |
| D7-12 | Readiness #1: sổ + bảng huỷ có `tenant_id`, FK kép `(event_id, tenant_id)`; RLS FORCE cả 3 bảng. |
| D7-13 | Readiness #2-3: "đã duyệt" = tập HD4; tiền lịch mặc định = giá trị khi 0…10¹⁵, ngược lại null; trigger không ném lỗi. |
| D7-14 | Readiness #5: index một phần cho vòng quá hạn (đợt mở có đối tác), lọc `overdue_for IS DISTINCT FROM due_date`. |
| D7-15 | Readiness #6: khoá HĐ (`FOR NO KEY UPDATE`) một câu, khoá + đọc lại đợt một câu, ghi một CTE ⇒ 3 câu sau set_config. |
| D7-16 | Readiness #7-8: huỷ = `ON CONFLICT DO NOTHING RETURNING` trên bảng huỷ; 0 hàng ⇒ không hoàn tác; trường hoàn tác như `obligations.undo`. |
| D7-17 | Readiness #9: đợt không có đối tác vẫn cập nhật, không ghi sổ (mgmt `if ob.get("company_id")`); nhật ký `contract_events` vẫn ghi. |
| D7-18 | Readiness #10: stats không phụ thuộc filter (`payments.py:35-39`). |
| D7-19 | Readiness #11: thân ghi việc tay strict; `at` mặc định hôm nay múi tenant. |
| D7-20 | Readiness #13: `saneSchedule` chỉ dùng khi có AI đọc điều khoản (nợ N2); PUT không kiểm tổng (như mgmt). |
