# CR-127 · readiness

## Lần chạy 1 · 2026-11-10 · NOT READY
Agent spec-readiness (Opus medium). Phạm vi: business.md, spec.md, tasks.md, gap-a…d + đối chiếu code. Lỗ hổng: **Chặn 6 · Cao 17 · TB 20 · Thấp 6**.

| # | Mức | Vị trí | Vấn đề | Mặc định đề xuất |
|---|-----|--------|--------|------------------|
| 1 | Chặn | spec §2.1, §3 #5–8, §11; `contract-flow.repo.ts:120-149` | Sau K3 `contracts.approvals` + `run_id` còn là lượt của HĐ không (`applyQ`, withdraw, Z1 dựa vào) | Giữ `approvals` (mode='engine', một hàng mỗi `submit_round`, `engine_run_id`), `run_id` trỏ hàng đó; chỉ gỡ `mode='machine'` |
| 2 | Chặn | spec §3 #1 | Thiếu trạng thái ban đầu cho deal, framework, promote (`promote-contract.usecase.ts:130`), create-manual, mgmt-import, cks | Thêm #1b `created_done`: deal/promote/import/cks INSERT `done`; framework như HĐ thường |
| 3 | Chặn | tasks §3, §5 K1/K2a | ≥15 file HP còn literal trạng thái cũ không thuộc lát nào (product-links.repo, cks-read.repo, review.rules, upload-contract.*, promote-contract, manage.usecase, tax-parties, esign.ports, request-extract, extract-job, run-extraction, extraction.ports, approval-flow.ts, deals.repo, create-manual) | Dán grep đầy đủ vào §3, gán từng file một lát (INSERT → K1, đọc → K2a) |
| 4 | Chặn | spec §2.4; gap-d §3 mục 2/4/7 | Hai phương án phiên ký + tên sự kiện lệch | Bảng phiên riêng FK `mailbox_id`, không đổi `partner_mailbox_outcome_ck`; sự kiện `sign.session.accepted|declined|signed|done|cancelled|expired`, khai ở E1 |
| 5 | Chặn | spec §3 #12–14; BR-64/65 | Thiếu chuyển "Huỷ phiên ký" và phiên quá hạn bên nhận | Huỷ: A draft, B draft "Chờ đối tác gửi bản sửa"; quá hạn + Gửi lại: như huỷ; Dừng: hai bên reject |
| 6 | Chặn | tasks §4 vs §6 W5/W9; U5 | Thứ tự lát tự mâu thuẫn | Khoá K3→X2→P1→X3→K6→X4; W9: U2 ∥ U4 → U5 → U3 ∥ U6 |
| 7 | Cao | tasks §4; `processes.mount.ts:33,201`; `library.routes.ts` | File mount route/vòng nền không có trong khoá file | Khoá E2→E3→E6→E7→E8, thêm vào cột file |
| 8 | Cao | spec §3 | Lượt `cancelled`/`failed` làm HĐ kẹt PROCESSING | `flow_cancelled|flow_failed`: processing → draft + `contract_events` có lý do |
| 9 | Cao | spec §2.1; `approval.repo.ts:20` | Backfill sót lượt máy cũ `extracting` | Mọi approvals mở (`extracting|level1|level2`) có `c.run_id=a.id` ⇒ processing; bỏ điều kiện sự kiện |
| 10 | Cao | spec §2.1, §7 K6; MIGC 0001/0003/0007 | `handled`/`action_deadline` chưa vào backfill + D6 | Backfill `effect_outcome` từ `handled` (renewed→renewed, replaced→terminated); gỡ cột/trigger ở K6 |
| 11 | Cao | spec §2.1, §5.5, §4.1 | Bản đã thay thế vẫn `done` ⇒ nhắc đôi, list hai bản | Mọi nguồn lọc `superseded_at IS NULL`; chip "Đã thay thế" |
| 12 | Cao | spec §5.5 | Hai flow cùng sự kiện khác N cùng chạy | facts thêm `days`; `match.rules` so `trigger.params.days === facts.days` |
| 13 | Cao | spec §5.2, §2.3 | Uỷ quyền với việc giao nhóm chưa rõ | Áp cho việc đích danh, need=head, phiếu `all` (user_id=A, `on_behalf_of`); việc nhóm `one` không áp |
| 14 | Cao | spec §5.4 | "Cần: tất cả" n=0 / người rời / quá hạn khi đã có phiếu | n=0 ⇒ chuyển "Quá hạn chuyển cho" (không có ⇒ quản trị công ty) + cảnh báo; người vô hiệu loại khỏi n; quá hạn ⇒ đóng task, giữ phiếu |
| 15 | Cao | BR-21; spec §8.1 | Người duyệt duy nhất là người gửi | Giao "Quá hạn chuyển cho"; không có ⇒ quản trị công ty; Chạy thử báo |
| 16 | Cao | spec §2.3 | Gói contracts đọc `hub.evidence` thế nào | DEFINER `hub.evidence_get(ids uuid[])` kiểm tenant; lọc BR-26 ở app |
| 17 | Cao | spec §2.4 | Hàm `sign_session_*` chưa có chữ ký + kiểm cách ly | Suy `side` từ `app.tenant_id`, RAISE nếu không thuộc phiên; `mark_signed` nhận + so sha256 |
| 18 | Cao | spec §4.1; BR-41 | Role từng endpoint; "quản lý" chưa định nghĩa | Ghi: owner ∪ uỷ quyền ∪ quản trị công ty; hold/release/penalty: owner ∪ trưởng phòng của owner ∪ quản trị công ty; submit/recreate: người tạo ∪ owner; sai tenant ⇒ 404 |
| 19 | Cao | spec §6 X2, §4.1 | Deal nhiều dòng/nhiều HĐ, vượt phần còn lại, mốc con | Một giao dịch = một mốc; dòng ngoài HĐ ⇒ 422 `LINK_MIXED`; vượt ⇒ `OVER_PLAN`; mốc con chép `milestone_items` còn lại cùng CTE |
| 20 | Cao | spec §11 D7; business §12 vs BR-72/76 | Gán 4 mẫu §12 cho mọi công ty prod ⇒ đổi hành vi ngay khi deploy | **Hỏi người dùng (Câu 1)** |
| 21 | Cao | spec §3 #9 | HĐ nhận khi bên nhận không có quy trình nhận | **Hỏi người dùng (Câu 2)** |
| 22 | Cao | tasks §1, §8.3 | Không commit + song song một working tree: `biome --changed`, `db:migrate`, DB test đụng phần dở; không khôi phục được | Cấm `--changed`; cuối lát lưu `git diff -- <file> > scratchpad/<lát>.patch` + `git stash create`; `db:migrate` chỉ điều phối chạy giữa đợt; ghi lệnh reset DB |
| 23 | Cao | tasks §5 K7; W6 | K7 sửa file của K1 + chỗ lập mốc AI | K1 khai port `onDone` rỗng; K7 chỉ cài adapter; K7 sau X3 |
| 24 | TB | spec §2.1 | GUC `state_gate` 'on' tới hết tx | Giá trị = id HĐ, trigger so `NEW.id` |
| 25 | TB | spec §3 | Thiếu cột phụ mỗi chuyển | Thêm cột "cột phụ" |
| 26 | TB | spec §3 #8 | Claim có chặn Rút về không | Chỉ quyết định/phiếu chặn; claim không chặn, báo người đã nhận |
| 27 | TB | BR-29; spec §5.1 | "Không thao tác" chưa định nghĩa; không trưởng phòng | Chỉ quyết/Trả về/Chuyển đóng claim; không trưởng phòng ⇒ quản trị công ty |
| 28 | TB | spec §4.1–4.2 | Mã lỗi thiếu HTTP + câu VI | 409 trạng thái, 422 thiếu/sai, 403 quyền; bảng câu VI trong tasks |
| 29 | TB | spec §4.1 | `evidence` chưa có schema | `EvidenceInputSchema {note 1..4000, signature_attachment_id?, attachment_ids ≤ 5}` |
| 30 | TB | BR-73; spec §8.2 | UI biết giao dịch đã ghi khi không poll | Trả `pending`; làm mới qua thông báo sẵn có / mở lại trang |
| 31 | TB | spec §2.4; MIGC 0087 | Chỗ lưu nhóm "Người ký HĐ" | `partner_settings.signer_group_id` |
| 32 | TB | tasks §1 | Thiếu env/mock (HUB_PARTNER_MAILBOX, worker sweep, fixture AI phạt, selfsign) | Ghi tasks §1 + fixture `bun run mocks` |
| 33 | TB | spec §5.2 | Cổng quyền xem HĐ chưa có | Port kit `ContractAccess.canView` |
| 34 | TB | spec §9 | Thiếu đo trước perf | X1/K2a/X2 chạy perf hiện có trước khi sửa |
| 35 | TB | tasks §5 | Thiếu cột Rủi ro + test trước code | Thêm cột; K1, X1, E1, E2, E3, P1 viết int trước |
| 36 | TB | tasks §7, spec §10 | Một số BR chưa có test; J1–J10 chưa có file | Bổ sung; `e2e/cr127/jNN-*.spec.ts` |
| 37 | TB | BR-10 | Luật khớp phòng của mẫu | Mã phòng → tên (không phân biệt hoa thường); không khớp ⇒ lỗi trên thẻ |
| 38 | TB | tasks U1 | Không có quyền truy cập prod | Dùng staging/seed |
| 39 | TB | spec §8.1 | Schema `core.notify/core.wait` | notify `{channel,to,text}`; wait `{until_date|duration_h}` + ánh xạ node cũ |
| 40 | TB | BR-68; K6 | HĐ gia hạn chưa có tệp | `ready`; submit thiếu tệp ⇒ 422 `FILE_REQUIRED` |
| 41 | TB | spec §4.1 recreate | Chép gì | Chép tệp + trường, `ready`, draft |
| 42 | TB | tasks §3 | Thiếu drizzle schema + usecase mới K3 | Thêm vào §3 |
| 43 | TB | spec §2.3 | Ai xem uỷ quyền người khác | Bản thân ∪ quản trị công ty ∪ trưởng phòng |
| 44 | Thấp | business.md:3 | Header "BẢN NHÁP" | Đổi trạng thái |
| 45 | Thấp | spec/tasks | Dài | Cắt §8 UI lặp business |
| 46 | Thấp | spec §2.1 | GUC không phải ranh giới bảo mật | Ghi rõ |
| 47 | Thấp | BR-55 | "Cần chú ý" để mở | Liệt kê cố định |
| 48 | Thấp | spec §5.1 | Đường test lock-order | Ghi đủ `PR/adapters/notify/` |
| 49 | Thấp | gap-c §3.2 vs spec §2.2 | Hai cách "keep" | Spec thắng |

### Câu hỏi cho người dùng
1. Gán 4 quy trình mẫu §12 cho mọi công ty prod đang có app Hợp đồng, hay chỉ công ty mới (công ty cũ quản trị nền tảng áp tay)?
2. Bên nhận không có quy trình nhận khớp: tự Đồng ý, hay giữ việc cho người phụ trách HĐ nhận tự quyết?
3. Cho chạy truy vấn đếm backfill 9→4 trên bản sao prod trước deploy?

### Chưa kiểm
gap-b chỉ đọc mục lục; chưa đo `wc -c`; chưa xem mockup; `CT/app-manifest`, kit `public.ts`, `flags.ts` chưa mở; ≈150 file test bị ảnh hưởng chưa đối chiếu.

## Lần chạy 2 · 2026-11-10 · NOT READY
Sau khi áp mặc định lần 1 + trả lời người dùng (Câu 1, 2 mặc định; Câu 3 bỏ; patch mỗi lát; Q11 đảo). Đóng đúng R#1–7, R#9–23; đóng một phần R#8 (→ #50), R#22 (→ #57). Còn **Chặn 2 · Cao 9 · TB 7 · Thấp 3**:

| # | Mức | Vấn đề | Mặc định đề xuất |
|---|---|---|---|
| 50 | Cao | `OutcomeHandler` (kit `flow-events.ports.ts:58-76`) không có hook huỷ/lỗi ⇒ #7b không có đường gọi; `notLaunched` không có dòng chuyển; withdraw + #7b đụng nhau | Kit thêm `cancelled?/failed?` (CAS, không ném) gọi từ run-control cancel + chỗ đánh lượt lỗi; `notLaunched` ⇒ draft + lý do; handler bỏ qua khi `run_id` ≠ lượt; file engine vào K3 |
| 51 | Chặn | #9b thiếu endpoint + cơ chế việc | `POST /contracts/:id/inbox-decision {decision, evidence}`; việc là một dòng `mywork.repo`; gắn `notLaunched` của `contract.received` |
| 52 | Chặn | Quyền "ghi thực hiện" mâu thuẫn §4 ↔ §5.9 | owner ∪ uỷ quyền ∪ quản trị ∪ người giữ/assignee task mốc đang mở; giao dịch gắn HĐ = quyền giao dịch hiện có + luật §5.9 |
| 53 | Cao | `review_tasks_kind_ck` (MIGH 0019:309-312) không cho `milestone`; `process_notices` thiếu kind | 0131 nới CHECK (`milestone` cần `subject_ref`) + kind notice mới |
| 54 | Cao | Gói contracts đóng `hub.review_tasks` — thiếu DEFINER, khoá ngược | `hub.task_signal(kind, subject_ref, result)` chỉ ghi tín hiệu; engine đóng task tx riêng; int deadlock 2 kết nối |
| 55 | Cao | Dời hạn mốc ⇒ task trùng | Nguồn `milestone.due` bỏ mốc có task mở; postpone đóng task cũ (`cancelled`) |
| 56 | Cao | Kit `public.ts` sửa song song K3/E3 | Khoá K3 → E3 → E6 → E10 |
| 57 | Cao | patch/stash bỏ sót file chưa track | Chép file mới của lát vào `<SCRATCH>/cr127/<lát>/`; ghi giới hạn `apply -R` |
| 58 | Cao | K1 quá lớn, dở dang làm hỏng mọi int | Tách K1a (0091 + cổng + luật, test trước) → K1b (31 file ghi + mgmt-import); W1 chỉ lát không đụng HĐ tới khi K1b xong |
| 59 | Cao | 409 `TASK_CLAIMED` lúc bán hàng chưa có câu/UI | "Mốc đang do {người} xử lý — nhờ họ xác nhận hoặc chọn Không theo hợp đồng"; test X2/X5 |
| 60 | Cao | Owner nhiều/không phòng ⇒ giao ai | Phòng đầu tiên theo thứ tự thành viên; không có ⇒ đích danh owner |
| 61 | TB | Nhắc cứng 3 ngày + quy trình Xác nhận mốc ⇒ báo đôi | X4 kiểm `hasFlowFor('milestone.due')` |
| 62 | TB | `HANDLED_OUTCOMES` ở `PC/fields.ts` ngoài K6 | Thêm vào K6 (khoá K1 → K6) |
| 63 | TB | e2e cần chạy vòng lịch | Route dev/test `POST /__test/schedule-sweep {today}` (chặn prod), E6 |
| 64 | TB | Đăng ký `ScheduledSource` | `flowPortRegistry`, mount ở `HP/flow-events.mount.ts` |
| 65 | TB | Mock thiếu Nhận việc ở mốc + thẻ HĐ nhận 3 nút | Nhãn nguyên văn vào spec §8 |
| 66 | TB | K2a quá cỡ | Tách K2a-1 / K2a-2 |
| 67 | TB | U4 thiếu phụ thuộc | Thêm E10, X5, K8 |
| 68 | Thấp | ≤ 6 vs ≤ 7 câu `recordFulfillment` | ≤ 7 |
| 69 | Thấp | Độ dài | Giữ |
| 70 | Thấp | Câu "đường găng thêm 1 lát" | Sửa thành 14 |

## Lần chạy 3 · 2026-11-10 · NOT READY
Đóng đúng #51, #53, #56–#58, #60–#70; đóng một phần #50, #54, #55. Còn **Chặn 0 · Cao 4 · TB 1 · Thấp 3**:

| # | Mức | Vấn đề | Mặc định đề xuất |
|---|---|---|---|
| 71 | Cao | `partner_inbox.awaiting_decision` không có migration; handler `notLaunched` ngoài file K8 | MIGC 0099 · K8 (`awaiting_decision bool NOT NULL DEFAULT false`); handler ở `HP/adapters/partner-inbox.repo.ts`, đăng ký ở `HP/partner-mailbox.mount.ts` |
| 72 | Cao | Gói contracts không đọc được người giữ task mốc | DEFINER `hub.task_holder(kind, subject_ref) returns (task_id, claimed_by, assignee_ids[])` trong 0131 (E1); X5 gọi qua port `FlowTaskSignal.holder` |
| 73 | Cao | X5 thiếu file đường dời hạn/tách mốc | Thêm `HP/application/exec-request.usecase.ts`, `HP/adapters/milestones.routes.ts` vào X5; khoá X3 → X5 |
| 74 | Cao | Hook huỷ/lỗi lượt chưa có file + hàm | Huỷ: `PR/gates/run-control.service.ts`; lỗi: nơi ghi `runs.status='failed'` (K3 grep, ghi spec §12); khoá `run-control.service.ts` chỉ K3 |
| — | TB | K7 chưa nói file mount `ContractDoneHook` | Ghi file mount vào K7, K7 sau K6 |
| — | Thấp | `deadline.rules.ts` ở cả K1a/K1b; nhãn "K1" còn sót; độ dài | Gán K1a; sửa nhãn; giữ |

## Lần chạy 4 · 2026-11-10 · NOT READY
#71–#73 đóng; #74 đóng cho `stop`/`settle-step`, nhánh `expireBatch` sinh #76. Còn **Chặn 0 · Cao 2**:

| # | Mức | Vấn đề | Mặc định đề xuất |
|---|---|---|---|
| 75 | Cao | Số migration MIGC áp lệch thứ tự đợt (`migrate-guard.ts:96-101` ném / Drizzle bỏ qua) | Đánh số theo thứ tự áp: 0091 K1a · 0092 K3 · 0093 X1 · 0094 P1 · 0095 K8 · 0096 K6 · 0097 K7 · 0098 P2 · 0099 Z1; `when` tăng theo; hub giữ 0131 E1 · 0132 P1 · 0133 Z1 |
| 76 | Cao | Hook `failed?` từng run trong `expireBatch` (tx system nhiều tenant) vi phạm Luật 4c | `OutcomeHandler.failedBatch?(tx, items[])` gọi một lần mỗi lô sau `claimExpired`; gói contracts một UPDATE theo tập (GUC `bulk:<txid>`, CAS `run_id`) + một INSERT `contract_events`; test đếm SQL ≤ 2 câu/lô, `expire.ts` ≤ 3+2 |

## Lần chạy 5 · 2026-11-10 · NOT READY
#75, #76 đóng. Còn **Chặn 0 · Cao 2**:

| # | Mức | Vấn đề | Mặc định đề xuất |
|---|---|---|---|
| 77 | Cao | K8 (W5) tạo 0095 trước P1 (W6) tạo 0094 ⇒ DB test của K8 lệch thứ tự | Đổi: 0094 K8 · 0095 P1 |
| 78 | Cao | UPDATE trong `failedBatch` (tx system nhiều tenant) chưa nói role + khớp tenant | `SET LOCAL ROLE contracts_job` chỉ cho câu này; join `(tenant_id, id) = (item.tenantId, item.ref)`; int K3: item tenant A không đổi HĐ tenant B |

## Lần chạy 6 · 2026-11-10 · NOT READY
#77, #78 đóng. Còn **Cao 1**:

| # | Mức | Vấn đề | Mặc định đề xuất |
|---|---|---|---|
| 79 | Cao | `contracts_job` (MIGC 0003:101, NOBYPASSRLS) không có quyền/policy UPDATE `contracts.contracts` ⇒ UPDATE sửa 0 hàng im lặng; INSERT `contract_events` chưa nói role | MIGC 0092 (K3): GRANT UPDATE (status, version, updated_at) + policy `contracts_job_fail` FOR UPDATE USING (status='processing') WITH CHECK (status='draft'); GRANT INSERT `contract_events` + policy WITH CHECK (type='status_changed'); INSERT trong cùng `SET LOCAL ROLE`; int K3 kiểm đúng N hàng đổi |

## Lần chạy 7 · 2026-11-10 · Cao 1 → áp mặc định, tự duyệt
#79 đóng phần quyền ghi. **#80 (Cao):** `contracts_job` thiếu SELECT cột + policy SELECT cho WHERE/CTE của UPDATE; trigger UPDATE không DEFINER chạy dưới role này. Mặc định: 0092 thêm `GRANT SELECT (id, tenant_id, status, run_id, version)` + policy `FOR SELECT TO contracts_job USING (status='processing')`; K3 grep trigger UPDATE của bảng, trigger ghi bảng khác ⇒ SECURITY DEFINER hoặc chỉ chạy khi đổi cột khác `status`; int K3 chạy thật dưới role `contracts_job`.

**Kết luận điều phối:** sau 7 lượt không còn Chặn; mục Cao cuối (#80) là chi tiết quyền DB có mặc định và được int K3 (chạy dưới role thật) bắt ⇒ áp mặc định, coi là READY theo Luật 1b ("lỗ hổng Cao có mặc định ⇒ áp luôn") + Luật 2b. Gate: `docs/specs/CR-127-gate.md`.
