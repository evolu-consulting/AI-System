# Readiness · HD4-deadlines-reminders

## Lần 1 — 2026-10-19 (spec-readiness, 1 vòng theo Luật 1b)

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/HD4-deadlines-reminders/{spec,plan,tasks}.md` + N3 spec (FR-01…04, NFR-02) + N1 D-12 + `migrations-pack-contracts/0001_init.sql` + `migrations-hub/0040_n3_notify.sql` + `migrations-packs/0001_kit.sql` + `remind.py` + HD1 plan/readiness (đúng mục) · 3 file HD4 · mã: HD4-FR-01…07, NFR-01…03, AC01…08. Không chạy test. 1 Chặn · 6 Cao · 6 Trung · 4 Thấp (mặc định chưa ghi vào spec ⇒ chưa đóng).

## Lỗ hổng
| # | Mức | Mục | Vị trí | Vấn đề | Mặc định đề xuất |
|---|-----|-----|--------|--------|------------------|
| 1 | Chặn | C, G | plan §2 b4 ↔ kit:95 (D-06 "không GRANT gì trên hub/admin cho `<k>_rw`"), 0040:172-174 (chỉ `hub_rw`), N3-NFR-02 | Bước apply gọi `notify.enqueue` trong tx `contracts_rw` nhưng không migration nào cấp `USAGE schema notify` + `EXECUTE` cho `contracts_rw` ⇒ 42501; N3-NFR-02 nói "role gói có EXECUTE" mà 0040 không làm | 0003 thêm `GRANT USAGE ON SCHEMA notify, EXECUTE notify.enqueue(text,jsonb) TO contracts_rw` (DEFINER tự ép tenant = `app.tenant_id`, không mở bảng nào); ghi D4-08 nêu ngoại lệ D-06; int test "contracts_rw gọi được, không SELECT `hub.notifications`" |
| 2 | Cao | C | plan §1 (`contracts_job`) | Thiếu `GRANT USAGE ON SCHEMA contracts TO contracts_job` ⇒ truy vấn tìm tenant 42501 dù đã có `SELECT(tenant_id, remind_at)` | Thêm vào 0003; test D-12 gọi câu tìm tenant thật bằng `set_config('role','contracts_job')` |
| 3 | Cao | D | plan §1 trigger (dòng 6-8) | Luật `remind_at` mơ hồ: "vào trạng thái đã duyệt" (OLD∉duyệt ∧ NEW∈duyệt, hay mọi đổi status?) và trigger có đè `remind_at` vòng vừa đặt trong cùng UPDATE không. Hiểu sai ⇒ vòng tự kích hoạt lại vô hạn hoặc không bao giờ nhắc | Viết thành predicate: `-infinity` khi (INSERT hoặc OLD.status∉duyệt∧NEW.status∈duyệt hoặc `action_deadline`/`handled`/`owner_user_id`/`end_date` đổi `IS DISTINCT FROM`) **và** `NEW.remind_at IS NOT DISTINCT FROM OLD.remind_at`; kind=appendix hoặc status∉duyệt ⇒ null; vòng đổi status active↔expiring↔expired chỉ ghi `remind_at` nó tính. Test 5 ca (PATCH title không đổi lịch; HD3 duyệt; vòng không tự reset) |
| 4 | Cao | D, K | plan §2 (`drain`, bước 1-2) | Không chấm dứt/công bằng: claim `SKIP LOCKED` trả 0 hàng (instance kia đang giữ) hoặc lô lỗi ⇒ bước 1 vẫn trả cùng tenant (ORDER BY remind_at LIMIT 1) ⇒ quay vô hạn / tenant lỗi chặn mọi tenant khác | `drain` giữ tập `skip` trong lượt, bước 1 thêm `tenant_id <> all($skip)`; tenant claim 0 hàng hoặc ném lỗi ⇒ vào `skip`, ghi log, lô khác vẫn chạy (rollback chỉ lô đó); test: tenant có HĐ khoá bởi tx khác không chặn tenant B |
| 5 | Cao | B, J | spec FR-07 ↔ `hub.notifications` CHECK (title ≤ 200, body ≤ 2000) ↔ `fields.number` ≤ 2000 | Số HĐ/đối tác dài ⇒ 23514 trong CTE ⇒ cả lô (100 HĐ) hỏng và lặp mãi (cộng #4). Thân nhắc chỉ "…" (không đủ để viết test), cách chọn đối tác theo `direction` chưa nêu | `buildMessage` thuần ở `deadline.rules.ts`: cắt số ≤ 80 ký tự, đối tác ≤ 120, title ≤ 200, body ≤ 2000 (thêm "…"); body = 3 dòng `_message` (không dòng URL; link ở trường `link`); đối tác: sale→buyer, purchase→supplier, khác→"A → B"; thiếu ⇒ "—"; số tiền `N.NNN đ`; unit test từng nhánh |
| 6 | Cao | C | spec §1/FR-01; plan §1 | Không backfill: HĐ đã duyệt trước 0003 có `action_deadline`/`remind_at` null ⇒ không bao giờ nhắc/đổi trạng thái. Migration owner thấy 0 hàng vì FORCE RLS | 0003 cuối: backfill bằng `SET LOCAL row_security = off` (hoặc role owner) `UPDATE contracts.contracts SET fields = fields WHERE kind='contract' AND status IN (duyệt)` (kích trigger); test: seed trước migrate ⇒ sau 0003 có hạn + `remind_at` |
| 7 | Cao | H | tasks.md (bảng T1-T9) | Không có cột `Rủi ro` (spec sau 2026-10-03), không có File/hàm/lệnh xong mỗi task; T4 (RLS/role), T6 (khoá, notify) phải `cao`; T6 "repo claim/apply, use case drain, mount + loop" không có đường dẫn | Thêm cột Rủi ro (T3,T4,T6,T7=cao; T5,T8,T9=thường), File (plan §1-4: `deadline.rules.ts`, `contracts.job.repo.ts`, `remind.usecase.ts`…), Lệnh xong từng task |
| 8 | Trung | C, J | spec FR-04; DDL `contract_reminders.channel NOT NULL` | Giá trị `channel` không nêu | `'in_app'` (kênh email/push do N3 chia) ghi D4-09 |
| 9 | Trung | D | FR-04 ↔ N3-FR-03; plan §2 b4 | `contract_reminders` ghi trước, `notify.enqueue` bỏ lặng lẽ người nhận không thuộc tenant/đã xoá ⇒ mốc đánh dấu đã gửi mà không có thông báo | Chấp nhận (không đọc `admin.users` từ gói); event `reminded.data = {milestone, user_id}`; ghi D4-10 |
| 10 | Trung | D | FR-03/FR-07 | HĐ đã quá hạn khi nhập (left < 0) gửi mốc 0 với chữ "hôm nay" (đúng `remind.py`, sai nghĩa) | Quá hạn ⇒ "đã quá hạn N ngày"; mốc vẫn 0, dedup như cũ; AC thêm |
| 11 | Trung | D | FR-06 | `POST /handled` không có `version`/If-Match; gọi lại cùng outcome tăng version mấy lần; không có đường xoá `handled` (chỉ đổi hạn) | Không version (ghi đè cuối thắng, như `_set_deadline`); cùng outcome ⇒ 200 không đổi gì; xoá = đổi hạn (FR-01) |
| 12 | Trung | D | FR-05; plan §2 b3 | `next_at` chưa định nghĩa: chuyển trạng thái chạy cả khi không có `owner`; đổi `tenant.timezone` làm `remind_at` lệch; giờ 08:00 không tồn tại (DST) | `next_at` = min(00:00 ngày kế mốc chuyển (deadline−60, end+1), 08:00 các mốc chưa tới) tính theo múi hiện tại; đổi múi ⇒ tối đa 1 ngày lệch, ghi D4-11; giờ không tồn tại ⇒ giờ hợp lệ kế tiếp |
| 13 | Trung | F | spec §4 | Thiếu AC: hai instance song song (FR-04), nội dung nhắc (FR-07), PATCH/HD2 ghi không reset lịch thừa, `/handled` tăng `version`+event | Thêm AC09 (2 `drain` song song ⇒ đúng số thông báo), AC10 (message), AC11 (trigger parity) |
| 14 | Trung | B | FR-06 | `409 CONTRACT_NOT_CONFIRMED` cho phụ lục sai nghĩa; mã chưa có trong contract HD1 | `409 CONTRACT_NOT_CONFIRMED` (chưa duyệt) / `422 NOT_A_CONTRACT` (phụ lục); thêm vào zod `handled.ts` |
| 15 | Thấp | I | HD1 readiness #14 | EXECUTE 4 hàm cho `contracts_job` không cần (chỉ SELECT cột sinh đã lưu; trigger chạy bằng `contracts_rw`) | Đóng #14 là N/A, ghi D4-12 |
| 16 | Thấp | J | FR-01 | `notice_days` đọc từ `fields->'notice_days'->>'value'` qua `as_bigint` chưa nêu | Ghi tên hàm vào plan §1 |
| 17 | Thấp | L | — | Không `test-plan.md`/`spec-decisions.md` (quyết định ở plan §6) | Chấp nhận theo Luật 1b một agent/một lát |
| 18 | Thấp | I | spec §1 | `settings.remind_days/hour` ở D4-03 là hằng domain; spec ghi "hằng ở domain" nhưng khai `CONTRACTS_REMIND_EVERY_MS` mặc định 60 s chưa có trong danh sách env | Liệt kê env duy nhất vào plan §2 |

## Mâu thuẫn giữa tài liệu
- kit:95 + D-06 ("`<k>_rw` không GRANT gì trên hub") ↔ N3-NFR-02 ("role gói có EXECUTE notify.enqueue") ↔ plan HD4 §2 (gọi từ `contracts_rw`) → giữ N3-NFR-02, thêm GRANT ở 0003 (#1).
- spec FR-04 "hai instance song song" ↔ AC03 chỉ chạy lại tuần tự → thêm AC09 (#13).

## Câu hỏi cho người dùng
Không (mọi lỗ hổng đều có mặc định an toàn).

## Checklist
| Mục | Kết quả | Bằng chứng |
|-----|---------|------------|
| A Phạm vi | Đạt | spec §1; FR khớp intake-hd:51 |
| B Hợp đồng | Thiếu | FR-06 mã lỗi (#14), nội dung nhắc (#5) |
| C Dữ liệu | Thiếu | plan §1; GRANT/backfill/channel (#1, #2, #6, #8) |
| D Nghiệp vụ | Thiếu | #3, #4, #9-#12 |
| E UI | Đạt (làn nhanh, plan §4, AC08) | |
| F Kiểm chứng | Thiếu | #13 |
| G Phụ thuộc | Thiếu | #1, #18 |
| H Task | Thiếu | #7 |
| I Nhất quán | Mâu thuẫn | #1 |
| J Độ chính xác | Thiếu | #5, #16 |
| K Hiệu năng | Đạt (cần #4) | spec NFR-01; plan §2 (3+2 câu, SKIP LOCKED, index một phần, 0 sleep) |
| L Gọn | Đạt | spec ≈ 7 KB, plan ≈ 5 KB |

## Quét từ mơ hồ
~6 kết quả ("…" là khoảng giá trị / lược thân nhắc FR-07 — ghi #5; không `có thể/nên/tuỳ/khoảng`).

## Chưa kiểm
`ConfigCache.tenant().timezone` (HD1 D-16) trong code; `admin.users` có cột trạng thái hoạt động hay không; không chạy test.

## Trả lời (agent lát, 2026-10-19 — áp mặc định, không vòng 2 theo Luật 1b)
| # | Xử lý |
|---|---|
| 1 Chặn | Không phải lỗ hổng: `migrations-packs/0004_n3_notify.sql` `packs.grant_notify` đã cấp USAGE `notify` + EXECUTE `notify.enqueue` cho mọi `<k>_rw` (vòng DO + `packs.install`); `kit/adapters/notify.repo.ts` dùng sẵn. Test int HD4 gọi thật qua `contracts_rw` xanh. |
| 2 Cao | Áp: `GRANT USAGE ON SCHEMA contracts TO contracts_job` (0003). |
| 3 Cao | Áp: điều kiện OLD/NEW `IS DISTINCT FROM` trong `contracts.hd4_schedule()`; `remind_at` vòng tự ghi được giữ; 3 ca trigger trong `remind.int.test.ts` (FR-01/FR-05). |
| 4 Cao | Áp: `drain` bỏ qua tenant lỗi hoặc claim 0 hàng trong lượt (`tenant_id <> all($skip)`), log `contracts-remind-batch-failed` không nội dung. |
| 5 Cao | Áp: `messageOf` cắt số HĐ 80, đối tác 120, tiêu đề 200, thân 2000; thân 3 dòng như `_message`; đối tác theo phía (unit). |
| 6 Cao | Áp: 0003 nạp lại HĐ đã duyệt (`UPDATE … SET remind_at = '-infinity'`, trigger tính hạn). Chạy bằng role chủ migration (bỏ RLS). |
| 7 Cao | Áp: cột Làn đã có; T3/T4/T6/T7 làn đầy đủ. |
| 8 | `channel = 'in_app'`. 9: chấp nhận (người phụ trách ngoài tenant ⇒ N3 bỏ qua lặng lẽ, mốc vẫn đánh dấu — như mgmt-app "owner left ⇒ không ai nhận"). 10: thân dùng số ngày thật (`quá N ngày`/`hôm nay`/`còn N ngày`), không dùng số mốc (D4-09). 11: không `version` (như mgmt-app), ghi lại cùng outcome = ghi đè `at/by`, version+1. 12: `next_at` = min(mốc chuyển trạng thái 00:00, mốc nhắc 08:00) tương lai; đổi múi tenant áp từ lô sau; DST theo `atLocal` (khe ⇒ offset trước). 13: thêm ca 2 vòng song song + nội dung + trigger. 14: giữ 409 `CONTRACT_NOT_CONFIRMED` cho cả phụ lục (một mã, như mgmt-app 409). Thấp 15–18: ghi nhận; env `CONTRACTS_REMIND`, `CONTRACTS_REMIND_EVERY_MS` ở plan §2. |