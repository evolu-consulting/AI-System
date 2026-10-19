# Review HD4 — hạn chót, trạng thái theo ngày, vòng nhắc (code + bảo mật, một vòng)

## Kết luận
- **Code: CHANGES REQUESTED** · Spec: `docs/specs/HD4-deadlines-reminders/` · Vòng: 1
- **Bảo mật: SAFE**. Không có hard stop. Không có đường nhắc hay đọc chéo tenant. Role `contracts_job` tối thiểu, RLS giữ được.
  Payload nhắc chỉ tới người phụ trách cùng tenant (`notify.enqueue` lấy tenant từ `app.tenant_id` và lọc `admin.users.tenant_id`).

Phạm vi: `git show 95890814 bba61b37 fef769af 3684f129` (nhánh `platform/gd0`). Đọc kỹ migration `0003`, `reminders.repo.ts`,
`remind-due.usecase.ts`, `deadline.rules.ts`, `local-time.rules.ts`, `pack-scope.ts`, `handled.*`, test `job-role` và RLS suite.
FE (bba61b37) chỉ đọc lướt. Đối chiếu thêm phần HD3 **chưa commit** trong cây làm việc (`approval-edit.rules.ts`, `patch-fields.*`).

## Lệnh đã chạy
- Chỉ đọc (`git show`, `git log`, `git diff`, `git status`). **Không chạy int**: máy đang tải nặng, và bằng chứng tĩnh đã đủ.
  Số liệu trong `tasks.md` (int HD4 xanh, perf 5 câu/lô, 0 Seq Scan) là của agent làm lát, reviewer chưa chạy lại.

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| M1 | Major | 2 Đúng đắn / 5 Hiệu năng | `adapters/reminders.repo.ts:68` (claim `for update of s`) ↔ `:92` (`upd`), trigger `hd4_schedule` (`0003`) | **Đảo thứ tự khoá ⇒ deadlock với mọi đường ghi HĐ.** Lô khoá hàng **lịch** trước (claim), rồi mới khoá hàng **HĐ** khi `upd` đổi trạng thái. Đường người dùng làm ngược lại: PATCH fields (HD1/HD3 reopen), `POST /handled` khoá hàng HĐ (`for update`) trước, rồi trigger BEFORE upsert/delete hàng lịch ⇒ chờ khoá của lô. Lô thì chờ hàng HĐ ⇒ 40P01. Sau `deadlock_timeout` (1 s) một bên bị huỷ rồi thử lại. Hậu quả: request người dùng treo khoảng 1 s, hoặc cả lô 100 HĐ của tenant làm lại. Ca hay gặp: HD3 reopen (sửa tiền ⇒ `needs_review` ⇒ trigger DELETE lịch) đúng lúc HĐ đang trong lô đổi `active→expiring`. Thêm nữa, `upd` ghi `status` từ ảnh chụp **không khoá** của HĐ và không kiểm `c.status = x.prev`. | Claim khoá cả hai: `for no key update of c, s skip locked` (hàng HĐ đang bị người dùng giữ ⇒ bỏ qua, lượt sau làm). `FOR NO KEY UPDATE` không ghi lại tuple nên không tính lại cột sinh. Thêm guard `and c.status = x.prev` trong `upd`. Thêm int: một tx giữ `select … for update` một HĐ đã duyệt, chạy `once()` ⇒ HĐ đó không bị claim, không 40P01. | backend |
| M2 | Major | 5 Hiệu năng (Luật 4c) | `tasks.md` T9, `perf/remind.perf.int.test.ts` | HD4-NFR-01 **chưa đạt** ở ca xấu nhất: p95 61–67 ms (sau ANALYZE), 108 ms (trước ANALYZE), ngưỡng 50 ms. Agent đã báo trung thực. Câu hỏi (g): `upd` **đã** chỉ chạy khi trạng thái đổi thật (`where … and x.changed`), nên không còn gì để bớt theo hướng "chỉ update khi đổi". 18–20 ms là giá thật của PG16: UPDATE tính lại cả 14 cột sinh STORED (`0001` + `0004`), cộng bảo trì index `status` (không HOT). Mỗi HĐ chỉ đổi trạng thái tối đa khoảng 3 lần trong đời (`active→expiring→expired`). Lô thường ngày đo được 25–29 ms. | Không bắt sửa code. Cần **người dùng chốt** một trong hai: (a) tách ngưỡng NFR-01 thành lô thường ≤ 50 ms và lô "mọi hàng đổi trạng thái" (backfill/nhập hàng loạt) ≤ 80 ms; hoặc (b) giữ 50 ms, đo lại trên máy yên hoặc staging trước khi đóng lát. Không nên chuyển trạng thái theo ngày thành tính lúc đọc: HD5 cần cột `status` có index. | người dùng + backend |
| m1 | Minor | 2 Đúng đắn | `0003` (bảng `contract_schedule` không FK) ↔ `remind-due.usecase.ts:70`, `reminders.repo.ts:64` | Hàng lịch **mồ côi** (HĐ mất mà trigger không chạy: `session_replication_role=replica`, restore một phần, sửa tay) không bao giờ bị xoá. Claim `join` nên không nhắc ma, **không rò**. Nhưng `finder` cứ trả tenant đó, claim ra 0 hàng ⇒ `skip`, tốn 2 câu mỗi lượt `drain`, mãi mãi. Ngoài ra PK chỉ là `contract_id`: một hàng lịch "giả" mang `contract_id` của tenant khác (chỉ ghi được khi chạy SQL tuỳ ý bằng `contracts_rw`, app không có đường này) sẽ làm upsert của tenant thật vướng RLS ⇒ ghi HĐ lỗi. Đây chỉ là phòng thủ chiều sâu. | Claim dùng `left join` và xoá luôn hàng lịch không có HĐ trong câu `apply`, hoặc dọn định kỳ. Cân nhắc PK `(contract_id, tenant_id)`. | backend |
| m2 | Minor | 2 Đúng đắn | `0003` `hd4_schedule` (trigger BEFORE có tác dụng phụ) | Lịch được ghi trong trigger **BEFORE**. PG chạy BEFORE theo tên ABC, nên nếu sau này có trigger BEFORE tên sau `contracts_hd4_*` sửa `NEW.status`/`kind` (vd HD5), lịch sẽ quyết theo NEW cũ. Hiện chỉ có 2 trigger BEFORE của HD4 nên chưa lỗi. | Ghi chú trong `CONVENTIONS`/plan: trigger BEFORE mới trên `contracts` phải đặt tên trước `contracts_hd4_`. Hoặc tách phần ghi lịch sang trigger AFTER ROW (vẫn giữ `WHEN`). | backend |
| m3 | Minor | 6 Vận hành | `remind-due.usecase.ts:74-81`, `reminders.mount.ts` (`timeZoneOf`) | Một tenant lỗi cố định (vd `timezone` IANA sai ⇒ `Intl` ném `RangeError`) bị bỏ qua **mỗi lượt, mãi mãi**. Log chỉ ghi `error.name`, không có số lần, nên không ai thấy tenant đó không còn được nhắc. Không mất dữ liệu: lô rollback trọn, lịch giữ nguyên. | `timeZoneOf` rơi về `DEFAULT_TENANT_TZ` khi tz không hợp lệ. Log thêm `sqlState` (không log nội dung HĐ). | backend |
| m4 | Minor | 7 Migration | `0003_hd4_reminders.sql` (sửa tại chỗ ở fef769af) | (f) Sửa tại chỗ là **an toàn** vì: chưa push (không có nhánh remote nào chứa 95890814); DB test dựng lại theo sha256 nội dung `migrations*` (`test-db-template.ts:2,49`); migrate mới từ đầu đúng (journal `0003` có `when` 1792890000000, sau `0005`, trước `0004_cks`). **Còn rủi ro:** DB dev bền (volume compose) nào đã `db:migrate` trong khoảng 21:14–21:51 ngày 2026-10-19 đang giữ bản cũ: có cột `contracts.remind_at` và grant `contracts_job` trên `contracts`, thiếu `contract_schedule`. Drizzle không áp lại vì chỉ so `when`. | Trên DB dev: nếu `select to_regclass('contracts.contract_schedule')` trả null ⇒ dựng lại volume. Không cần migration sửa vì chưa có môi trường chung nào. Từ nay, migration đã commit thì không sửa tại chỗ nữa, thêm `0007` thay vào. | người dùng / dev |
| m5 | Minor | 1 Đúng spec | `packages/contracts/src/pack-contracts/handled.ts:2` | Comment ghi "outcome lạ 422" nhưng spec D4-10 và code trả 400 `VALIDATION_ERROR`. | Sửa comment. | backend |
| m6 | Minor | 4 Vệ sinh | gốc repo `remind.int.test.ts` (untracked) | Có file test lạc ở gốc repo, không nằm trong commit nào. | Chủ file xoá hoặc chuyển đi (reviewer không đụng). | người làm lát |

## Trả lời các trọng tâm
**(a) Trigger hạn chót.**
- `deadline_of` là phép tính ngày thuần (`date − int`), không dính múi giờ, nên đúng ở mọi tenant.
- Múi tenant chỉ dùng trong TS: `localDate` cho trạng thái theo ngày; `atLocal` cho mốc 00:00 và 08:00, xử lý được DST lặp/khe.
- **Không có đệ quy.** Trigger chỉ ghi `contract_schedule`, và bảng này không có trigger. Khi vòng nhắc đổi trạng thái giữa các mức đã duyệt, `WHEN` của trigger UPDATE là false nên plpgsql không chạy.
- Mở lại khi hạn đổi: chỉ chạy khi `handled` không đổi trong cùng lệnh, đúng `_set_deadline`.

**Đối chiếu HD3 "sửa tiền ⇒ mở lại duyệt"** (bản chưa commit): **không xung đột trạng thái.**
- `save` (fields đổi) kích hoạt trigger ⇒ lịch `-infinity`. Sau đó `reopen` đặt `needs_review`; `WHEN` bắt chuyển đã duyệt → chưa duyệt ⇒ xoá lịch. Kết quả: HĐ `needs_review` không có lịch, không bị nhắc.
- Khi duyệt lại về `active`, trigger xếp lịch `-infinity`. Vòng nhắc tính lại theo ngày, và theo `handled` nếu còn: `reopen` của HD3 không xoá `handled`, nên HĐ `renewed` sẽ về lại `renewed` sau ≤ 1 lượt. Hợp lý vì hạn không đổi. Nếu muốn mở lại duyệt thì cũng mở lại xử lý, HD3 phải chốt.
- Nếu một PATCH đổi cả `end_date` lẫn tiền: trigger đưa `renewed→active` và xoá `handled`, rồi `reopen` đặt `needs_review`. Nhất quán.
- Rủi ro thật với HD3 là **deadlock M1**, không phải trạng thái sai.
- Danh sách trạng thái đã duyệt hiện lặp ở 3 nơi (SQL `0003`, `deadline.rules.ts`, `approval-edit.rules.ts` của HD3). Nên có một nguồn duy nhất (nợ).

**(b) Lịch không FK.**
- Có trigger AFTER DELETE (row) và AFTER TRUNCATE dọn lịch. Xoá theo cascade tenant vẫn kích hoạt trigger row.
- Nhắc ma: **không có**, vì claim `join contracts` theo `(id, tenant_id)`.
- Hàng mồ côi: có thể sinh ra nhưng không gây hại ngoài tốn câu SQL (m1).
- Không có đường xoá HĐ nào bỏ sót lịch trong code app.

**(c) `contracts_job`.**
- Cờ: NOLOGIN NOINHERIT NOBYPASSRLS, không quyền tạo. Thành viên của `hub_api` với `INHERIT FALSE, SET TRUE`.
- Quyền: `USAGE` schema; `SELECT (tenant_id, remind_at)` trên đúng một bảng; policy `USING(true)` chỉ gắn `contracts_job`.
- Policy tenant của `contracts_rw` không đổi (test `job-role` khẳng định beta thấy 0 hàng của acme). Đọc `contract_id` hoặc bảng HĐ ⇒ 42501. Không ghi được. Không gọi được `notify.enqueue`.
- `withPackJobScope` không đặt `app.tenant_id`, và mọi việc theo tenant đều chạy trong `withPackScope` riêng.

**(d) Lô.**
- Có `FOR UPDATE … SKIP LOCKED`. Một tenant một lô, và `tenant_id` được lọc tường minh trong mọi CTE.
- **Không gửi hai lần**:
  - `contract_reminders_once_uq (contract, tenant, deadline, milestone, user)` + `ON CONFLICT DO NOTHING`, và chỉ hàng vừa chèn mới được enqueue;
  - N3 có `UNIQUE (tenant, user, source, dedup_key)`, khoá `remind:<hđ>:<hạn>:<mốc>` dài ≤ 60 ký tự;
  - người phụ trách đổi ⇒ người mới nhận đúng một lần.
- **Không mất nhắc khi lô hỏng giữa chừng**: claim, apply và `notify.enqueue` nằm cùng một tx, lỗi ⇒ rollback trọn, lịch giữ nguyên, lượt sau làm lại.
- Lỗ còn lại: M1 (deadlock, tự lành nhờ thử lại nhưng treo) và m3.

**(e) Payload.**
- Nội dung gồm số HĐ, đối tác, giá trị, ngày; chỉ gửi tới `owner_user_id` cùng tenant.
- `enqueue` lọc người dùng khác tenant ⇒ bỏ lặng. Hàng `contract_reminders` vẫn được ghi, nên không gửi lại cho người đó. Chấp nhận được.
- Lô không ghi log nội dung HĐ.
- Ghi nhận (không lỗi): người phụ trách bị hạ quyền gói vẫn nhận giá trị/đối tác qua thông báo. Đây là luật N3 hiện hành.

**(f)** Xem m4: an toàn cho test và cho migrate mới, chỉ còn DB dev bền là cần kiểm tra.

**(g)** Xem M2: đã update chỉ khi trạng thái đổi. Phần chi phí còn lại là bản chất của cột sinh STORED trên PG16; cần chốt ngưỡng chứ không phải sửa code.

## Điều kiện để APPROVED
1. Sửa M1 (khoá `c` trong claim + guard `prev`) và thêm int test.
2. Người dùng chốt M2 (tách ngưỡng hoặc đo lại trên máy yên).
3. Các mục Minor có thể làm cùng lúc, hoặc ghi vào `docs/TECH-DEBT.md`.
