---
cr: CR-127
title: Nghiệp vụ hợp đồng theo quy trình — spec kỹ thuật
trang_thai: READY (tự duyệt 2026-11-10 — Luật 1b/2b; đã áp readiness lần 1–7 #1–#80 + trả lời người dùng)
ngay: 2026-11-10
nguon: business.md (ĐÃ CHỐT 2026-11-10 trừ §15 Q mở) · readiness.md (lần 1) · gap-a-contract-state.md · gap-b-flow-engine.md · gap-c-execution.md · gap-d-partner-esign-expiry.md
br_phu: C127-BR-01…79 (gồm 36a, 36b) — trừ §12b BR-80…88 (HOÃN)
mac_dinh_ap: business.md §15 Q2–Q18; readiness lần 1 #1–#49 trừ #20, #21
---

# CR-127 · Spec kỹ thuật

Đọc kèm: `business.md` (nghiệp vụ, mã BR, mock M1…M16 ở §17), 4 file `gap-*.md` (file:dòng của code hiện tại — spec này **không chép lại**, chỉ trỏ `gap-x §y`), `readiness.md` (mã `R#n` = lỗ hổng readiness lần 1 đã áp). Viết tắt đường dẫn như gap: `HP` = `apps/hub-api/src/modules/packs/contracts`, `PR` = `apps/hub-api/src/modules/processes`, `PT` = `apps/hub-api/src/modules/partners`, `PC` = `packages/contracts/src/pack-contracts`, `CT` = `packages/contracts/src`, `WW` = `apps/workspace-web/src/features`, `AW` = `apps/admin-web/src/features/processes`, `MIGC` = `packages/db/migrations-pack-contracts`, `MIGH` = `packages/db/migrations-hub`.

## 0. Nguyên tắc thiết kế (áp mọi lát)
1. **Một cổng đổi trạng thái HĐ** (§3). Không câu SQL nào ngoài cổng ghi `contracts.contracts.status`; DB chặn bằng trigger (§2.1).
2. **Một khái niệm "Bằng chứng"** = bảng `hub.evidence` + component web `EvidenceInput`; mọi nơi chỉ tham chiếu `evidence_id`.
3. **Một khái niệm "Yêu cầu chờ duyệt"** (`contracts.exec_requests`) cho giao dịch chờ duyệt (§12.3) và thay đổi thực hiện (§12.5).
4. **Một nơi ghi "đã giao/đã thu" cho HĐ** = hàng `contracts.obligations` (mốc); làm thiếu ⇒ hàng con `parent_obligation_id`. Không tạo `deal` khi giao dịch thuộc HĐ.
5. **Một hàm quyền làm việc** `canAct` (`PR/domain/tasks/task-access.rules.ts`) tính cả nhận việc + uỷ quyền; mọi nơi (task view, gate, forward, Việc của tôi, Chạy thử) gọi hàm này.
6. **Một engine**: sự kiện app → `hub.flow_events` → dispatcher. Lịch (N ngày) do **một** vòng quét chung ở Hub phát sự kiện idempotent.
7. **Lượt của HĐ** = hàng `contracts.approvals` `mode='engine'` (một hàng mỗi `submit_round`, `engine_run_id`); `contracts.run_id` trỏ hàng đó (R#1). Chỉ gỡ `mode='machine'` (Z1).
8. **Bản đã thay thế** (`superseded_at IS NOT NULL`) bị loại khỏi mọi nguồn: list mặc định, nhắc, vòng lịch, `open-milestones`, đếm; hiện chip "Đã thay thế" (R#11).
9. D6: cùng lát thêm cái mới phải backfill + chuyển mọi chỗ đọc + gỡ cái cũ. Danh sách gỡ §11.

## 1. Phạm vi
**Trong:** business §1–§13, §16, §17 (M1…M16), §15 mặc định Q2–Q18.
**Ngoài:** §12b (BR-80…88) · §14 · DocuSign cho ký cùng lúc (Q9) · hạn theo giờ làm việc · khe `contract.uploaded` cũ: giữ chạy, ẩn menu (Q15) · cờ `FLOW_TRIGGERS` của community (chỉ gỡ nhánh HĐ) · sổ G1 `contracts.transactions*` (chỉ đọc).
**Người dùng chốt 2026-11-10:** (1) 4 mẫu §12 chỉ tự gán cho công ty **mới**; công ty đang có, quản trị nền tảng áp tay (R#20). (2) Bên nhận không có quy trình nhận khớp ⇒ giao việc cho **người phụ trách HĐ nhận** quyết Đồng ý / Trả lại / Từ chối (R#21, §3 #9b). (3) Prod **chưa có người dùng thật** ⇒ không đếm backfill trên bản sao prod; migration backfill giữ cho staging/seed; rủi ro dữ liệu khách hạ xuống "dữ liệu thử". (4) Lưu patch mỗi lát. (5) **Xác nhận mốc là việc giao nhóm** có Nhận việc / Trả về nhóm / uỷ quyền như bước Duyệt (BR-31 đủ, §5.9).

## 2. Mô hình dữ liệu
Số migration: `tasks.md` §2. Bảng mới có `tenant_id` + RLS theo khuôn (`packs.secure_table` cho gói contracts — mẫu `MIGC/0026`, `0056`; hub mẫu `MIGH/0106`). Bảng chỉ thêm: `REVOKE UPDATE, DELETE` (mẫu `MIGC/0056:74`). Bảng hub mới khai thêm ở drizzle `packages/db/src/schema/hub-processes.ts` (task, uỷ quyền, bằng chứng) và `hub-process-library.ts` (`tenantFlowSettings`); gói contracts không có drizzle schema (SQL thuần).

### 2.1 HĐ (lát K1a — migration/cổng/luật; K1b — đổi đường ghi; cột thực hiện ở X1)
| Cột (`contracts.contracts`) | Kiểu | Ghi chú |
|---|---|---|
| `status` | text CHECK `in ('draft','processing','reject','done')` | thay `contracts_status_ck`. Nhãn UI: DRAFT / PROCESSING / REJECT / DONE |
| `extract_state` | text NOT NULL DEFAULT `'ready'` CHECK `in ('reading','failed','ready')` | AI đang đọc / đọc lỗi — không phải trạng thái |
| `effect` | text NULL CHECK `in ('not_started','active','expiring','expired','renewed','terminated')` | dẫn xuất, NULL khi `status<>'done'`; chỉ `contracts.refresh_effect(ids uuid[], today date)` ghi (cổng khi vào done, vòng nhắc hằng ngày, outcome Sắp hết hạn) |
| `effect_outcome` | text NULL CHECK `in ('renewed','terminated')` | nguồn "Đã gia hạn/Đã chấm dứt" (thay `handled`) |
| `effect_outcome_at`, `effect_evidence_id` | timestamptz, uuid | BR-08 |
| `renews_id` | uuid NULL FK `contracts(id)` | HĐ gia hạn → HĐ cũ (khác `supersedes_id`) |
| `submit_round` | int NOT NULL DEFAULT 0 | số lần Xác nhận & lưu / Gửi lại |
| `submitted_by` | uuid NULL | người gửi lần gần nhất |
| `exec_hold_at/by/reason/evidence_id` | NULL khi không khoá | lát X1 (migration 0093) |
| `locked_at/locked_by` | giữ | chỉ ghi "lúc vào DONE lần đầu"; khoá nội dung = `status in ('processing','done')` |

- `effectOf(c, today)` thuần ở `HP/domain/effect.rules.ts` (thay `statusOn`) và SQL `refresh_effect` cho cùng kết quả (test bảng chung). Thứ tự: `superseded_at` ⇒ không tính (chip "Đã thay thế") → `effect_outcome` thắng → `start_date > today` ⇒ `not_started` (thiếu ⇒ coi như đã hiệu lực) → `end_date < today` ⇒ `expired` → `end_date - today ≤ N` (N = `notice_days` của HĐ, mặc định 30) ⇒ `expiring` → `active`. Ngày theo múi giờ công ty.
- **Chặn ghi thẳng `status`** (R#24, R#46): trigger `contracts_status_gate` BEFORE UPDATE OF status: nếu `current_setting('contracts.state_gate', true)` khác `NEW.id::text` ⇒ RAISE `STATUS_GATE_ONLY`. Cổng `set_config('contracts.state_gate', <id>, true)` ngay trước UPDATE từng HĐ (UPDATE theo tập: đặt `'bulk:<txid>'` và trigger chấp nhận khi khớp `'bulk:' || txid_current()`). **Đây là lưới chống sót lập trình, không phải ranh giới bảo mật** (role gói vẫn đặt được GUC); bảo mật vẫn là RLS + quyền route.
- Trigger `contracts_k1_lock` (0048) và `contracts_k2_supersede` (0082) viết lại theo `status='done'`. Chỉ mục `(tenant_id, status)` → `(tenant_id, status, effect) WHERE superseded_at IS NULL`.
- **Quyền cho `failedBatch`** (MIGC 0092, K3 — #79; `contracts_job` là NOBYPASSRLS, MIGC 0003:101): `GRANT UPDATE (status, version, updated_at) ON contracts.contracts TO contracts_job` + policy `contracts_job_fail` FOR UPDATE TO contracts_job USING (`status='processing'`) WITH CHECK (`status='draft'`); `GRANT INSERT ON contracts.contract_events TO contracts_job` + policy FOR INSERT TO contracts_job WITH CHECK (`type='status_changed'`); **`GRANT SELECT (id, tenant_id, status, run_id, version) ON contracts.contracts TO contracts_job` + policy `contracts_job_fail_read` FOR SELECT TO contracts_job USING (`status='processing'`)** để UPDATE … FROM/RETURNING thấy hàng (#80). Trigger UPDATE trên `contracts.contracts` (K3 grep một lần): trigger chỉ đọc/ghi chính hàng ⇒ giữ; trigger ghi bảng khác ⇒ đổi thành SECURITY DEFINER hoặc thêm `WHEN` để chỉ chạy khi đổi cột khác `status`. Không cấp gì thêm.
- Bảng `contracts.contract_submissions` (lát K3): `id, tenant_id, contract_id, round, submitted_by, submitted_at, fields jsonb, text_sha256, source_text NULL (chỉ khi khác lần trước), return_note NULL, unchanged_reason NULL`. Chỉ thêm; unique `(contract_id, round)`.
- `handled` / `action_deadline` (MIGC 0001/0003/0007 — R#10): K1a backfill `effect_outcome` từ `handled.outcome` (`renewed`→`renewed`, `replaced`→`terminated`; `not_renewed`/`negotiating` ⇒ NULL, hiệu lực theo ngày); K6 gỡ cột, trigger `remind_at=-infinity` theo `handled`, route, zod.

**Backfill (một UPDATE theo tập, một tx; trước đó đếm và in số hàng mỗi dòng bảng):**
| Cũ `status` | Điều kiện | Mới | `extract_state` | `effect_outcome` |
|---|---|---|---|---|
| `extracting` | — | draft | reading | — |
| `extract_failed` | — | draft | failed | — |
| `needs_review` | có `approvals a` đang mở (`a.status in ('extracting','level1','level2')`) **và** `c.run_id = a.id` (R#9) | processing | ready | — |
| `needs_review` | còn lại | draft | ready | — |
| `active`,`expiring`,`expired` | — | done | ready | từ `handled` (trên) |
| `renewed` | — | done | ready | renewed |
| `terminated` | — | done | ready | terminated |
| `rejected` | — | reject | ready | — |
`submit_round` = số hàng `approvals` của HĐ; `submitted_by` = người tạo hàng `approvals` mới nhất. Sau UPDATE gọi `refresh_effect`. Kiểm trong migration (RAISE nếu sai): không còn giá trị cũ; số `done` = tổng 5 trạng thái cũ. Không đụng `approvals`. `contract_events.type='reopened'` giữ đọc được.

### 2.2 Mốc / thực hiện (lát X1, K7)
| Thay đổi | Ghi chú |
|---|---|
| `obligations.parent_obligation_id uuid NULL` FK | hàng con = phần còn lại khi làm thiếu. Mốc gốc đóng `done` với số thật; con `open` với số còn lại, hạn = cũ (`keep`) hoặc mới (`split`); mốc giao: con chép `milestone_items` còn lại (qty kế hoạch − đã giao) trong cùng CTE (R#19). Công nợ = Σ hàng `open` (không đếm đôi). Nếu gap-c §3.2 mô tả khác ("keep" giữ mốc mở), **spec thắng** (R#49) |
| `obligations.done_by` | có sẵn (`MIGC/0008:30`) — đưa ra contract |
| `obligations.evidence_id uuid NULL` | |
| `obligations.clause_ref text NULL`, `page int NULL` | K7 (0097) |
| `obligations_kind_ck` + `'penalty'`; `source` + `'fulfill'` | mẫu `MIGC/0022:76-78` |
| `obligations.penalty_decision text NULL CHECK in ('booked','waived')`, `penalty_obligation_id uuid NULL` | chặn quyết hai lần |
| `contracts.penalty_terms` (`id, tenant_id, contract_id, party ours\|partner, trigger late_delivery\|late_payment\|other, rate_pct, basis per_day_of_value\|per_day_of_milestone\|fixed, cap_pct, cap_amount, clause_ref, page, quote, source ai\|manual`) | K7 |
| `contracts.exec_requests` (`id, tenant_id, contract_id, obligation_id NULL, kind transaction\|postpone\|split\|waive_penalty\|hold\|release, payload jsonb, evidence_id, status pending\|approved\|rejected\|applied, decided_note, requested_by, requested_at, flow_event_id`) | partial unique `(obligation_id) WHERE status='pending' AND obligation_id IS NOT NULL`; `(contract_id) WHERE status='pending' AND kind in ('hold','release')` |
| `contract_events.data` lệnh mốc: `{before, after, evidence_id}` | BR-54 |

### 2.3 Hub: bằng chứng, nhận việc, uỷ quyền, cài đặt (lát E1)
| Thay đổi | Ghi chú |
|---|---|
| `hub.evidence(id, tenant_id, subject_kind, subject_id, note NOT NULL, signature_attachment_id NULL, attachment_ids uuid[] DEFAULT '{}', by_user, on_behalf_of NULL, at)` | chỉ thêm; CHECK note 1..4000, ≤ 5 tệp. `subject_kind` ∈ `task_decision, milestone, hold, penalty, exec_request, effect_outcome, sign_cancel, unchanged_resubmit` |
| `hub.record_evidence(subject_kind, subject_id, note, signature_attachment_id, attachment_ids, on_behalf_of) returns uuid` · `hub.evidence_get(ids uuid[]) returns setof` (R#16) | SECURITY DEFINER (khuôn `hub.emit_flow_event`), lấy tenant từ `app.tenant_id`, kiểm tệp + hàng thuộc tenant đó; lọc người được xem (BR-26) làm ở app |
| Tệp/chữ ký | đường tải có sẵn của module `attachments` (FileBox); chữ ký PNG ≤ 200 KB; tệp ≤ 10 MB. Tệp quyết định trong lượt: `linkRunFiles` |
| `hub.review_tasks`: `need text NOT NULL DEFAULT 'one' CHECK in ('one','head','all')`, `claimed_by`, `claimed_at`, `claim_deadline_at`, `subject_ref text NULL` (vd id mốc cho task `kind='milestone'`, §5.9; chỉ mục `(tenant_id, subject_ref) WHERE status='open'`); 0131 nới `review_tasks_kind_ck` (MIGH 0019:309-312) thêm `'milestone'` + CHECK `kind<>'milestone' OR subject_ref IS NOT NULL` (#53) |
| `process_notices` kind mới | `task_released`, `milestone_task` — nới CHECK kind trong 0131 (#53) |
| `hub.task_signals(id, tenant_id, kind, subject_ref, result, created_at, processed_at NULL)` + DEFINER `hub.task_signal(kind, subject_ref, result)` (#54) | gói chỉ **ghi tín hiệu** (INSERT, không đụng `review_tasks`); engine đóng task ở tx riêng (§5.9) |
| DEFINER `hub.task_holder(kind text, subject_ref text) returns table(task_id uuid, claimed_by uuid, assignee_ids uuid[])` (#72) | đọc (không khoá) task **mở** theo `subject_ref` của tenant hiện tại; gói contracts gọi qua port kit `FlowTaskSignal.holder` để kiểm quyền/khoá đang xử lý (§5.9). Trong 0131 (E1) | flow cũ vắng `need` ⇒ suy từ `head_only` |
| `hub.review_task_votes(task_id, tenant_id, user_id, on_behalf_of NULL, result, evidence_id, at)` PK `(task_id,user_id)` | "Cần: tất cả" |
| `hub.task_assignees.via` + `'delegated'`; `on_behalf_of uuid NULL` | |
| `hub.delegations(id, tenant_id, from_user_id, to_user_id, from_at, to_at, kinds text[], created_by, revoked_at)` | CHECK `from<>to`, `to_at>from_at`, `kinds <@ '{approve,form,milestone,esign}'`; chỉ mục `(tenant_id, from_user_id, from_at, to_at) WHERE revoked_at IS NULL`. **Ai xem** (R#43): bản thân (from/to) ∪ quản trị công ty ∪ trưởng phòng của `from_user` |
| `hub.tenant_flow_settings.claim_release_h int NOT NULL DEFAULT 24 CHECK 1..168` | Q2 |

### 2.4 Liên công ty / ký cùng lúc (lát P1, P2, K8) — R#4, R#17, R#31
- **Bảng phiên riêng** `hub.partner_sign_sessions` (FK `mailbox_id` → `hub.partner_mailbox`; **không** đổi `partner_mailbox_outcome_ck`, không thêm outcome): `id, mailbox_id, from_tenant, to_tenant, status (proposed, accepted, signing, done, cancelled, expired, fallback), reason, accept_deadline_at, sign_deadline_at, pdf_sha256, from_signed_at, from_signer_name, to_signed_at, to_signer_name, cancel_side, cancel_reason, emitted_from bool, emitted_to bool`. RLS chỉ `system`; truy cập qua hàm DEFINER (khuôn `MIGH/0117`).
- Hàm (side **suy từ `app.tenant_id`**, RAISE `SESSION_FORBIDDEN` nếu tenant không thuộc phiên):
  - `hub.sign_session_propose(mailbox_id uuid, reason text, accept_h int, sign_h int, pdf_sha256 text) returns uuid` — chỉ `from_tenant`, cùng tx `partner_send`.
  - `hub.sign_session_accept(session_id uuid, signer_name text)` — chỉ `to_tenant`, `status='proposed'` và chưa quá `accept_deadline_at`.
  - `hub.sign_session_mark_signed(session_id uuid, signer_name text, pdf_sha256 text)` — RAISE `SESSION_HASH_MISMATCH` nếu sha khác; cả hai đã ký ⇒ `done` (một câu `FOR UPDATE`, idempotent).
  - `hub.sign_session_cancel(session_id uuid, reason text)` — ghi `cancel_side`.
  - `hub.sign_session_mine(session_id uuid)` — chỉ trạng thái, hạn, tên công ty + tên người ký hai bên (không id).
- Sự kiện (khai ở E1, module contracts): `sign.session.accepted | declined | signed | done | cancelled | expired`.
- `contracts.sign_session_refs(tenant_id, contract_id, session_id, side 'from'|'to')`.
- Nhóm "Người ký HĐ": `contracts.partner_settings.signer_group_id uuid NULL` (MIGC 0098 — R#31).
- Bản sửa của đối tác vào **cùng** HĐ nhận (Q10).
- `contracts.partner_inbox.awaiting_decision bool NOT NULL DEFAULT false` (MIGC 0094, K8 — #71): bên nhận không có quy trình nhận, chờ người phụ trách quyết (§3 #9b).

### 2.5 FlowDef (không migration)
Thêm vào zod: `after.review.need`, `after.review.evidence` (`'opinion'|'opinion_plus'`; vắng ⇒ `opinion`; UI mới mặc định `opinion_plus`), `StageEscalate.user_id`, `FlowTrigger.params?: {days?: number}`, `AppEventDecl.schedule?`. Node mới (R#39): `core.notify` config `{channel: 'bell'|'email'|'both', to: RecipientRef[], text}` (ánh xạ: `core.bell` ⇒ channel bell, `core.email` ⇒ email); `core.wait` config `{until_date?: FactRef|date} | {duration_h: number}` (ánh xạ `core.wait-until` ⇒ until_date, `core.wait-for` ⇒ duration_h). Executor giữ `notify`/`wait_until`/`wait_for`.

## 3. Cổng đổi trạng thái HĐ (lát K1a: luật + adapter + trigger; K1b: chuyển 31 file ghi + mgmt-import sang cổng) — thay 11 chỗ ghi thẳng (gap-a §2.2) + các INSERT (tasks §3)
- **Luật thuần** `HP/domain/contract-state.rules.ts`: `transition(from, ev, ctx) ⇒ {to, cols, sideEffects[]} | {error}`. **Adapter** `HP/adapters/contract-state.repo.ts`: `applyTransition(tx, {contractId, ev, actorId, reason?, evidenceId?})` = MỘT câu CTE (`UPDATE … WHERE id=$id AND status = any($from) RETURNING` + `INSERT contract_events(type='status_changed', data{from,to,ev,reason,evidence_id})`); 0 hàng ⇒ 409 `STATE_CONFLICT`. Khi `to='done'`: `refresh_effect` + gọi port `ContractDoneHook.onDone(tx, contractId)` (K1a khai port với cài đặt rỗng; K7 cài adapter lập mốc AI — R#23). Phát sự kiện flow cùng tx qua `emitContract`.
- **INSERT** dùng `initialState(kind)` cùng file luật (R#2): HĐ thường/framework ⇒ `draft`; deal, promote (`promote-contract.usecase.ts:130`), create-manual, mgmt-import, cks ⇒ `done` (`created_done`) + `refresh_effect`.

| # | Từ | Sự kiện | Sang | Cột phụ (R#25) | Ai/đâu gọi | Phát ra |
|---|---|---|---|---|---|---|
| 1 | — | `created` | draft | `extract_state` reading/ready | upload, create-from-step, recreate, renewal outcome | — |
| 1b | — | `created_done` | done | `locked_at`, `effect` | deal, promote, create-manual, mgmt-import, cks | — |
| 2 | draft | `extracted` / `extract_failed` | draft | `extract_state` | extraction.repo | — |
| 3 | draft | `submit`, có quy trình khớp | processing | `submit_round+1`, `submitted_by`, `run_id` = hàng `approvals` mới (mode engine) | `submit.usecase` | `contract.submitted`; `contract_submissions` |
| 4 | draft | `submit`, không quy trình | **draft (chặn, NF1)** | không ghi gì; lỗi `NO_APPROVAL_FLOW` 409; chi tiết HĐ báo trước `submit_block = 'no_flow'` + `can.submit = false` | `submit.usecase` | — |
| 5 | processing | `flow_approved` | done | `locked_at`, `effect` | outcome `contract-flow.repo` / máy cũ | — |
| 6 | processing | `flow_rejected` | reject | — | như trên | — |
| 7 | processing | `flow_returned` (ý kiến bắt buộc) | draft | — | như trên | — |
| 7b | processing | `flow_cancelled` / `flow_failed` / `flow_not_launched` (R#8, #50) | draft | — | kit `OutcomeHandler` thêm hook tuỳ chọn `cancelled?(tx, ref, reason)` / `failed?(tx, ref, reason)` (`packs/kit/application/flow-events.ports.ts:58-76`), gọi từ: **huỷ** `PR/gates/run-control.service.ts#RunControlService.stop` (sau `cancelEnd`, cùng tx); **lỗi** `PR/application/runs/settle-step.usecase.ts` (nhánh `r.steps.setStatus(runId, status)` khi `status==='failed'`, ghi qua `PR/adapters/runs/step.repo.ts#setStatus`); **hết hạn** `PR/runs/expire.ts#expireBatch`: **không** gọi hook từng lượt (tx system nhiều tenant, Luật 4c) — kit thêm `OutcomeHandler.failedBatch?(tx, items: {tenantId, ref, runId, reason:'expired'}[])`, gọi **một lần mỗi lô** sau `claimExpired`; gói contracts cài bằng một `UPDATE … FROM jsonb_to_recordset` theo tập, chạy dưới `SET LOCAL ROLE contracts_job` (đủ SELECT/UPDATE/INSERT theo §2.1, #80) cho câu UPDATE **và** câu INSERT `contract_events` (reset role ngay sau hai câu; quyền cấp ở MIGC 0092 — §2.1, #79), join `(c.tenant_id, c.id) = (item.tenantId, item.ref)` (#78) (GUC `contracts.state_gate = 'bulk:' || txid_current()`, CAS `status='processing' AND run_id = item.runId`) + một `INSERT contract_events` theo tập; test đếm SQL: handler ≤ 2 câu/lô, `expireBatch` ≤ 3 + 2 câu/lô (#76) — §12, #74; hook là CAS (`applyTransition` với `from=['processing']` **và** `run_id` = lượt đó), 0 hàng ⇒ bỏ qua, **không ném**. `notLaunched` của `contract.submitted` (`PR/triggers/not-launched.ts`) ⇒ cùng chuyển, lý do "Không mở được quy trình: …". Withdraw đã đổi `run_id`/trạng thái trước ⇒ hook của lượt bị rút tự bỏ qua. File engine thuộc K3 | `contract_events` có lý do ("Quy trình bị huỷ/lỗi — kiểm rồi Gửi lại") |
| 8 | processing | `withdraw` (chỉ `submitted_by`; bước hiện tại chưa có **quyết định/phiếu**; nhận việc **không** chặn — người đã nhận được báo, R#26) | draft | — | `withdraw.usecase` → `FlowRunControl.cancel(runId,'withdrawn')` (lệnh huỷ lượt có sẵn, `docs/current/hub/dieu-khien-luot-chay.md`) | thông báo người đã nhận |
| 9 | — | `partner_received` | processing | `source='partner_inbox'` | `partner-inbox.repo` | `contract.received` |
| 9b | processing (nhận, **không** có quy trình nhận khớp — R#21) | quyết của người phụ trách HĐ nhận: `inbox_accept` / `inbox_return` / `inbox_reject` | done / draft ("Chờ đối tác gửi bản sửa") / reject | — | Khi `contract.received` rơi vào `notLaunched` (không flow khớp) ⇒ HĐ giữ processing, đánh dấu `partner_inbox.awaiting_decision=true` (cột mới MIGC 0094 `awaiting_decision bool NOT NULL DEFAULT false`, #71); handler `notLaunched` ở `HP/adapters/partner-inbox.repo.ts`, đăng ký ở `HP/partner-mailbox.mount.ts`. **Việc** = một dòng do `HP/adapters/mywork.repo.ts` sinh từ điều kiện đó cho người phụ trách HĐ nhận (`partner_settings`; chưa đặt ⇒ quản trị công ty) — không phải task engine. **Endpoint** `POST /contracts/:id/inbox-decision {decision: accept\|return\|reject, evidence}` (#51); ý kiến bắt buộc khi Trả lại/Từ chối; trả lời đối tác qua `applyReceivedOutcome` | — |
| 10 | processing (nhận) | `partner_returned` | draft (nhãn "Chờ đối tác gửi bản sửa") | — | `applyReceivedOutcome` | — |
| 11 | draft (nhận) | `partner_revised` | processing | `submit_round+1` | `receiveInbox` vòng mới | `contract.received` round+1 |
| 12 | processing | `sign_session_done` | done | `locked_at` | sign-session handler (cả hai bên) | — |
| 13 | processing | `sign_session_declined` | reject | — | cả hai bên | — |
| 14a | processing | `sign_session_cancelled` ("Huỷ phiên ký" — R#5) | bên gửi: draft · bên nhận: draft "Chờ đối tác gửi bản sửa" | — | bên huỷ + mover báo bên kia | — |
| 14b | processing | `sign_session_expired` + bên gửi chọn **Gửi lại** | như 14a | — | việc của người phụ trách bên gửi | — |
| 14c | processing | `sign_session_expired` + bên gửi chọn **Dừng** | reject (cả hai bên) | — | như trên | — |
| 15 | done | không có (sửa ⇒ phiên bản mới) | — | — | — | — |
| 16 | reject | kết thúc (chỉ `recreate` ⇒ HĐ mới #1) | — | — | — | — |

- "Có quy trình khớp" = cổng kit `FlowAvailability.hasFlowFor(tx, tenant, event, facts)` dùng **cùng** `PR/triggers/match.rules.ts` + `company_flows` đang bật. Nhánh HĐ không còn đọc `FLOW_TRIGGERS`/`approval_on()`: `PR/triggers/flags.ts` coi app `contracts` luôn bật.
- Gửi lại = `submit` khi `submit_round > 0`: lượt mới từ bước đầu; hồ sơ đọc mọi hàng `approvals` của HĐ. Không đổi trường + `text_sha256` ⇒ 422 `UNCHANGED_REASON_REQUIRED` + bằng chứng `unchanged_resubmit`. HĐ gia hạn chưa có tệp ⇒ 422 `FILE_REQUIRED` (R#40).
- `reminders.repo.ts:125` thôi ghi status, chuyển `refresh_effect`.

## 4. Contract API (zod `packages/contracts`, strict)
- **HTTP** (R#28): 409 = sai trạng thái/đua (`*_CONFLICT`, `*_NOT_*`, `*_EXISTS`, `*_CLAIMED`, `*_DECIDED`, `*_PENDING*`); 422 = thiếu/sai dữ liệu (`*_REQUIRED`, `OVER_PLAN`, `LINK_MIXED`, `*_RANGE`, `*_MISMATCH`); 403 = quyền (`*_FORBIDDEN`, `NOT_*` về vai); sai tenant/không thấy ⇒ 404. Câu VI mỗi mã: `tasks.md` §9.
- **`EvidenceInputSchema`** (R#29, `CT/chat/evidence.ts` dùng chung): `{note: string 1..4000, signature_attachment_id?: uuid, attachment_ids?: uuid[] ≤ 5}`.
- **Vai** (R#18, #52): *ghi thực hiện* (fulfill, change-requests, remind-partner) = người phụ trách HĐ (`owner_user_id`) ∪ người được uỷ quyền `milestone` của owner ∪ quản trị công ty ∪ **người giữ / assignee của task Xác nhận mốc đang mở** của mốc đó (§5.9; khi task đã có người nhận chỉ người nhận + owner + quản trị); *giao dịch gắn HĐ* (`POST /contracts/deals` có `link.obligation_id`) = quyền tạo giao dịch hiện có + luật khoá đang xử lý §5.9; *hold/release/penalty* = owner ∪ trưởng phòng của owner ∪ quản trị công ty; *submit/withdraw/recreate* = người tạo HĐ ∪ owner (withdraw chỉ `submitted_by`); *xem* = quyền xem HĐ hiện có.

### 4.1 Gói contracts (`PC/*`, `/pack/contracts`)
| Endpoint | Request | Response | Lỗi | Lát |
|---|---|---|---|---|
| `POST /contracts/:id/submit` | `{unchanged_reason?, evidence?: EvidenceInput}` | `{status, no_flow, round}` | `CONTRACT_NOT_DRAFT`, `EXTRACT_NOT_READY`, `UNCHANGED_REASON_REQUIRED`, `FILE_REQUIRED`, `NO_APPROVAL_FLOW` (409, NF1) | K3 |
| `POST /contracts/:id/inbox-decision` (#51) | `{decision: 'accept'\|'return'\|'reject', evidence?: EvidenceInput}` (evidence.note bắt buộc khi return/reject) | `{status}` | `INBOX_NOT_AWAITING`, `FEEDBACK_REQUIRED`, `INBOX_DECISION_FORBIDDEN` | K8 |
| `POST /contracts/:id/withdraw` | `{reason}` | `{status:'draft'}` | `WITHDRAW_NOT_ALLOWED{why: not_submitter\|step_decided\|not_processing}` | K3 |
| `POST /contracts/:id/recreate` | `{}` | `{id}` — HĐ mới draft, chép tệp + `source_text` + trường, `extract_state='ready'` (R#41) | `CONTRACT_NOT_REJECTED` | K3 |
| `GET /contracts/:id/changes-since-last` | — | `{round, previous_round, fields[{key,before,after}], clauses[{ref,changed,before?,after?,requested}], return_note}` | — | K5 |
| `GET /contracts/:id/versions/diff` (có) | thêm `text` | thêm `clauses[]` | — | K5 |
| `GET /contracts` | `status[]`, `effect[]`, `source: upload\|partner`, `include_superseded?` | row + `extract_state, effect, superseded, hold{by,reason}\|null, waiting{step,who,due_at}\|null, source` | — | K2a-1, K8 |
| `GET /contracts/:id` | — | + `effect, effect_outcome, superseded, hold, submit_round, can{submit,withdraw,recreate,new_version,hold,release}` | — | K2a-1 |
| `POST /contracts/:id/hold` · `/release` | `{reason?, evidence}` | `{state:'applied'\|'pending', request_id?}` | `HOLD_EXISTS`, `NOT_HELD`, `EVIDENCE_REQUIRED`, `HOLD_FORBIDDEN` | X3 |
| `POST /obligations/:id/fulfill` | `{at, amount?, qty_items?[{contract_item_id, qty}], fault?, remainder?: 'keep'\|{split:{due_date,title?}}, evidence}` | `{obligation, child?}` | `CONTRACT_ON_HOLD{by,reason}`, `OVER_PLAN`, `OBLIGATION_CLOSED`, `CHANGE_PENDING`, `TASK_CLAIMED{by}`, `TASK_NOT_CLAIMED` (§5.9, thêm ở X5) | X1, X5 |
| `POST /obligations/:id/settle` (có) | giữ | = fulfill toàn phần còn lại | như trên | X1 |
| `GET /open-milestones` | `party_key, product_id?, direction` | `[{contract_id, contract_name, obligation_id, title, due_date, remaining}]` (done, effect active/expiring, không hold, không superseded) | — | X2 |
| `POST /contracts/deals` (có) | + `link: {obligation_id} \| {none:{reason}}` (bắt buộc khi đối tác có HĐ DONE chứa SP) | `{state:'posted'\|'pending', obligation_id?, deal_id?, request_id?}` — UI nhận `pending` thì hiện "Đang kiểm duyệt…", làm mới khi có thông báo (chuông) hoặc mở lại trang; không poll (R#30) | `LINK_REQUIRED`, `LINK_REASON_REQUIRED`, `LINK_MIXED` (một giao dịch = một mốc; có dòng SP ngoài HĐ — R#19), `OVER_PLAN`, `CONTRACT_ON_HOLD` | X2 |
| `POST /obligations/:id/change-requests` | `{kind: postpone\|split\|waive_penalty, payload, evidence}` | `{state, request_id}` | `CHANGE_PENDING_EXISTS` | X3 |
| `GET /contracts/:id/penalties` | — | `{terms[], estimates[{obligation_id, days_late, amount, capped}]}` | — | X4 |
| `POST /obligations/:id/penalty` | `{decision:'book'\|'waive', amount, evidence}` | `{state}` | `PENALTY_DECIDED` | X4 |
| `POST /obligations/:id/remind-partner` | `{}` | `{sent_at}` | `PARTNER_EMAIL_MISSING` | X4 |
| `GET /contracts/:id/approval-record` | — | mọi lượt, quyết định, bằng chứng (đã lọc BR-26) | — | E4 |
| `GET /contracts/:id/sign-session` · `POST …/sign-session/cancel` | `{reason}` | `{status, sides[{company, signer_name, signed_at}]}` | `SESSION_NOT_ACTIVE` | P1 |
| **Gỡ:** `POST /contracts/:id/reopen`, `/handled`, route máy duyệt cũ, `GET /partner/inbox` (giữ `/partner/invites/*`), `POST /process-defs/:id/preview` | | | | K4, K6, Z1, K8, E7 |

Facts (khai E1 trong `CT/app-manifest/contracts.manifest.ts`): `contract.submitted` + `deal, total_value, importance, submitter_group_ids, partner_new, partner_score, product_ids`; `contract.received` + `sign_together`. Sự kiện mới: `contract.expiring` (schedule, facts `days`, outcomes `renew|terminate|let_expire`), `milestone.overdue` (schedule; facts `days, owner, kind, days_late`), `milestone.due` (schedule, N ngày trước hạn, mặc định 3; facts `days, owner, kind, contract_owner_group_id`; §5.9), `transaction.saved` (decides; `approved|rejected`; facts `total_value, linked`), `fulfilment.change_requested` (decides; facts `kind, postpone_days, waive_amount`), `sign.session.*` (§2.4).

### 4.2 Hub
| Endpoint / kiểu | Thay đổi | Lỗi | Lát |
|---|---|---|---|
| `POST /review-tasks/:id/claim` | → `{claim}` | `TASK_CLAIMED{by}`, `TASK_NOT_CLAIMABLE`, `TASK_CLOSED` | E2 |
| `POST /review-tasks/:id/release` | người đang giữ | `NOT_CLAIMER` | E2 |
| `POST /review-tasks/:id/reassign` | `{to_user_id, note}` — trưởng phòng / quản trị công ty | `NOT_GROUP_HEAD`, `TARGET_NOT_IN_GROUP` | E2 |
| `POST /review-tasks/:id/forward` (có) | `note` bắt buộc | `FORWARD_REASON_REQUIRED` | E3 |
| `ReviewDecisionRequest` | + `evidence?: EvidenceInput` | `EVIDENCE_REQUIRED`, `FEEDBACK_REQUIRED` | E4 |
| `TaskDetail`/`OpenTask`/`FlowTask` | + `claim{state:'unclaimed'\|'mine'\|'other', by?, at?}`, `need`, `votes{done,total}?`, `delegated_from?`, `evidence_mode` | — | E2–E5 |
| `FlowActionInput.kind` | + `'evidence'` | — | E4 |
| `GET/POST/DELETE /me/delegations`; `GET/POST/DELETE /tenants/:tid/delegations` | `{to_user_id, from_at, to_at, kinds[], for_user_id?}` | `DELEGATE_SELF`, `DELEGATE_CHAIN`, `DELEGATE_NOT_SIGNER`, `DELEGATE_NO_ACCESS`, `DELEGATE_FORBIDDEN` | E3 |
| `POST /tenants/:tid/flow-preview` (platform_admin) | `{flow_id \| draft_def, facts, viewer_user_id?, starter_user_id?}` → `{path[{step, kind, status, reason, who[{user, via}], can_act?, block_reason?}], warnings[]}` | — | E7 |
| `POST /tenants/:tid/company-flows` (platform_admin, M1) | `{name, app, from: {template_id}\|'blank'}` | `FORBIDDEN_TENANT_ADMIN_WRITE` (quản trị công ty, mọi route ghi) | E8 |
| `PUT /tenants/:tid/flow-settings` | `{claim_release_h}` | `CLAIM_HOURS_RANGE` | E2 |
| `AppEventDecl.schedule`, `FlowTrigger.params` | `{param:{key:'days', min:1, max:365, default}}` | `TRIGGER_PARAM_RANGE` | E1/E6 |
| `after.review.need/evidence`, `StageEscalate.user_id` | §2.5 | `ESCALATE_TARGET_REQUIRED` | E1 |

## 5. Engine
### 5.1 Nhận việc (E2 — Opus medium) — gap-b §4.A
- Chỉ task `need='one'` giao phòng/nhóm. Claim = MỘT `UPDATE … WHERE id=$t AND status='open' AND claimed_by IS NULL RETURNING`, giữ thứ tự khoá run → task của `gates.service` (test `PR/adapters/notify/review-tasks.lock-order.int.test.ts` — R#48). 0 hàng ⇒ 409 `TASK_CLAIMED` kèm tên.
- `canAct`: `need='one'` + `claimed_by` khác người xem ⇒ `block_reason='claimed_by_other'`. Không động `remind_at/created_at`.
- **"Không thao tác"** (R#27): claim chỉ kết thúc khi quyết định, Trả về nhóm, hoặc Chuyển cho; xem/mở thẻ không gia hạn. Vòng nền `PR/application/notify/claim-release.usecase.ts` (khuôn `claimDueReminders`, lô 100, `SKIP LOCKED`): quá `claim_deadline_at` ⇒ trả về nhóm + báo trưởng phòng của nhóm; nhóm không có trưởng phòng ⇒ báo quản trị công ty (`NOTICE_KINDS` + `task_released`). Đăng ký vòng ở `PR/processes.mount.ts`.

### 5.2 Uỷ quyền (E3 — Opus medium) — gap-b §4.B
- **Phạm vi áp** (R#13): việc giao **đích danh** (`approver_user_id`, assignee cá nhân), `need='head'` (A là trưởng phòng), phiếu `need='all'` (phiếu ghi `user_id=A`, `on_behalf_of` = B…; B bỏ phiếu thay A). Việc nhóm `need='one'` **không** áp (người khác trong nhóm nhận).
- Luật thuần `PR/domain/tasks/delegation.rules.ts#resolveDelegate(assignee, kind, at, delegations, {starterId, signerGroupMembers})`: B ≠ người gửi; không chuỗi; `esign` chỉ khi B thuộc nhóm Người ký HĐ; ngoài khoảng ⇒ null. Dùng ở: tạo task (`PR/core/core.repo.ts:115`) ⇒ assignee `via='delegated', on_behalf_of=A`; Chạy thử; lúc lưu uỷ quyền (việc A đang giữ ⇒ hỏi A / tự chuyển nếu quản trị đặt).
- "Chuyển cho" = `forward` + `note` bắt buộc. Uỷ quyền "Xác nhận mốc": áp như mọi việc engine (việc xác nhận mốc là task — §5.9); đường xác nhận trực tiếp trên HĐ (công ty chưa áp quy trình Xác nhận mốc) đọc `hub.delegations` qua port kit `DelegationReader`.
- **"B có quyền xem HĐ"** (R#33): port kit mới `ContractAccess.canView(tx, tenant, userId, contractId)` do gói contracts cài (dùng luật xem hiện có); `DELEGATE_NO_ACCESS` khi B không xem được (kiểm theo HĐ lúc giao việc; không xem được ⇒ việc ở lại A + báo).
- **Người duyệt duy nhất là người gửi** (R#15, BR-21): giao "Quá hạn chuyển cho" của bước; không có ⇒ quản trị công ty; Chạy thử + thẻ bước báo cảnh báo.
- Quá hạn chuyển tới người (Q18): `StageEscalate.user_id` ⇒ assignee `via='escalated'`.

### 5.3 Bằng chứng (E4 — Sonnet high + Opus low soát)
- `reviewDecisionCheck`: `opinion_plus` + Duyệt ⇒ `note` + (chữ ký hoặc ≥1 tệp); Trả lại/Từ chối ⇒ `note`. `record_evidence(subject_kind='task_decision')` cùng tx `closeTask`; `HistoryItem` + `evidence_id`, `on_behalf_of`.
- Xem (BR-26, Q14): `run-redact.rules.ts` ẩn nội dung bằng chứng với người chỉ xem; hiện với người trong quy trình ∪ người gửi ∪ người phụ trách HĐ ∪ quản trị công ty ∪ trưởng phòng duyệt.
- Hồ sơ duyệt M6: `GET /contracts/:id/approval-record` + trang in (CSS in; "Tải PDF" = in ra PDF của trình duyệt).

### 5.4 "Cần: tất cả" (E5 — Opus medium) — R#14
- n = thành viên phòng (trừ người gửi, trừ người bị vô hiệu) lúc tạo task. Đủ n/n Duyệt ⇒ approved; một Từ chối/Trả lại ⇒ đóng ngay. Người bị vô hiệu sau đó ⇒ loại khỏi n (tính lại khi có phiếu kế tiếp hoặc vòng quá hạn).
- n = 0 ⇒ giao "Quá hạn chuyển cho" (không có ⇒ quản trị công ty) như việc một người + cảnh báo trên lượt/Chạy thử.
- Quá hạn khi đã có phiếu ⇒ đóng task theo đường quá hạn (chuyển cấp như bước thường), giữ phiếu đã có trong hồ sơ.

### 5.5 Trigger theo lịch (E6 — Opus medium)
- Port kit `ScheduledSource.dueRecords({tenantId, event, params, today, limit}) ⇒ [{ref, facts, dueKey}]` — một SQL theo tập, loại bản đã thay thế.
- Vòng `PR/triggers/schedule-sweep.ts` (`startLoop` 10 phút, chỉ worker, đăng ký ở `PR/processes.mount.ts`): flow đang bật có trigger schedule ⇒ gọi nguồn ⇒ `emit_flow_event` theo lô, `eventId = <event>:<ref>:<dueKey>:<N>`; **facts có `days = N`** và `match.rules` chỉ khớp flow có `trigger.params.days === facts.days` (R#12) ⇒ hai flow khác N không chạy chéo.
- Nguồn contracts: `contract.expiring` (K6), `milestone.overdue` (X4), `milestone.due` (X5). Đăng ký nguồn qua `flowPortRegistry` (kit), mount ở `HP/flow-events.mount.ts` (#64).
- e2e chạy vòng lịch qua route **chỉ dev/test** `POST /__test/schedule-sweep {today}` (E6; không mount khi `NODE_ENV=production`, int kiểm 404 ở prod) (#63).
- Dispatcher chọn bản xuất bản lúc mở lượt (trễ vài giây) — chấp nhận.

### 5.6 Chạy thử (E7 — Sonnet high)
Thuần, không ghi DB/thông báo/tool. Dùng chung `if.rules`, `match.rules`, `headGate`, `delegation.rules`, `canAct`. 4 nút thử nhanh = facts mẫu từ ngưỡng If. Cảnh báo: người duyệt duy nhất là người gửi, n=0, phòng chưa có trưởng. Thay `preview.routes.ts` + `PreviewDialog.tsx`.

### 5.7 Áp dụng · Quyền soạn · Mẫu
- Nút **Áp dụng** = xuất bản + bật, một thao tác; dòng "HĐ đang chạy giữ bản cũ…".
- Ghi bản công ty chỉ platform_admin (`company-flows.routes.ts`, `library-company.service.ts`, `library.routes.ts`); quản trị công ty 403 + chỉ xem (Q6).
- **Khớp phòng khi tạo từ mẫu** (R#37): mã phòng trong mẫu → phòng của công ty theo mã, rồi theo tên không phân biệt hoa thường; không khớp ⇒ lỗi trên thẻ bước "Chưa chọn phòng cho bước này".

### 5.8 Gỡ đường duyệt cũ (Z1) — BR-78, Q16
Gỡ `mode='machine'` (`approval-machine.rules.ts`, `approval-def.rules.ts`, `approval.usecase.ts` phần máy, `approval.repo.ts`, route/mount), `contracts.approval_on()`, nhánh contracts của cờ. Migration 0099 chốt chặn: còn `approvals mode='machine' AND status in ('extracting','level1','level2')` ⇒ RAISE. Prod chưa có người dùng (người dùng 2026-11-10) ⇒ dự kiến không còn lượt máy cũ, **deploy một đợt**; chốt chặn giữ làm lưới (nếu RAISE thì mới tách hai đợt).

### 5.9 Xác nhận mốc là việc nhóm (E10 — Opus medium; X5 — Sonnet high + Opus low) — người dùng chốt 2026-11-10, BR-31
- Kiểu bắt đầu mới `milestone.due` (lịch, N ngày trước hạn, mặc định 3 — thay "nhắc trước 3 ngày" cứng của BR-47 khi công ty có quy trình này); nguồn `ScheduledSource` của contracts (mốc `open`, bản chưa thay thế, **bỏ mốc đã có task Xác nhận mốc đang mở** (#55), `dueKey = due_date`).
- **Dời hạn mốc** (postpone/split, X3) ⇒ đóng task cũ của mốc với kết quả `cancelled` (qua `hub.task_signal`) để mốc nhận task mới theo hạn mới — không có hai task cho một mốc (#55).
- Node mới `contracts.milestone-confirm` ("Xác nhận mốc", nhóm Người làm): cấu hình như khối Duyệt — Ai làm (phòng/người; mặc định **phòng của người phụ trách HĐ**, fact `contract_owner_group_id`; owner thuộc nhiều phòng ⇒ phòng đầu tiên theo thứ tự thành viên (`group_members` sắp theo ngày vào, rồi id); owner không thuộc phòng nào ⇒ giao **đích danh owner** (#60)), Cần (một người nhận việc / trưởng phòng), Hạn (mặc định tới hạn mốc), Quá hạn chuyển cho, Nhắc. Tạo `review_tasks` (`kind='milestone'`, `subject_ref = obligation_id`) ⇒ **dùng nguyên** nhận việc / trả về / giao lại / tự trả (E2), uỷ quyền loại `milestone` (E3), quá hạn chuyển cấp.
- Nút của task: "Xác nhận" mở form M11 (`POST /obligations/:id/fulfill`). Task **đóng khi mốc xong** bằng bất kỳ đường nào (form M11, giao dịch gắn HĐ từ Sản phẩm & Giá, settle): `recordFulfillment` gọi port kit `FlowTaskSignal.complete(tx, {kind:'milestone', subjectRef}, 'done')` = `hub.task_signal(...)` trong cùng tx — **chỉ ghi tín hiệu**, không khoá `review_tasks` (tránh khoá ngược HĐ→mốc→task vs run→task, #54). Engine xử lý tín hiệu ở tx riêng (vòng `task-signal` theo lô `SKIP LOCKED`, đăng ký `PR/processes.mount.ts`, test gọi `*Once`): khoá run → task, `closeTask`, đánh `processed_at`; idempotent. Int deadlock hai kết nối (fulfill ∥ claim) bắt buộc ở E10. Mốc làm thiếu ⇒ task gốc đóng; mốc con mới sẽ có task mới khi tới N ngày.
- **Khoá đang xử lý** (BR-40): đọc người giữ bằng `FlowTaskSignal.holder` (= `hub.task_holder`, #72). Mốc có task đã nhận ⇒ `recordFulfillment` từ người khác (không phải người nhận, owner, quản trị công ty) ⇒ 409 `TASK_CLAIMED{by}` (câu: "Mốc đang do {người} xử lý — nhờ họ xác nhận hoặc chọn Không theo hợp đồng" khi đi từ giao dịch; UI M12 hiện câu này + nút chọn "Không theo hợp đồng" — #59); chưa ai nhận ⇒ thành viên nhóm phải bấm Nhận việc trước (409 `TASK_NOT_CLAIMED` "Bấm Nhận việc trước khi xác nhận"), trừ owner/quản trị công ty. Giao dịch từ Sản phẩm & Giá gắn mốc đang có người nhận ⇒ cùng luật.
- Công ty chưa áp quy trình Xác nhận mốc ⇒ đường cũ: owner + người được uỷ quyền xác nhận trực tiếp, nhắc trước 3 ngày như BR-47.
- Mẫu Thư viện mới "Xác nhận mốc" (Z0): Bắt đầu khi Mốc sắp tới hạn (N=3) → Xác nhận mốc (phòng người phụ trách, một người nhận việc, quá hạn chuyển trưởng phòng) → Hoàn tất.

## 6. Thực hiện HĐ
- **`recordFulfillment`** (X1 — Opus medium): mở rộng `settleOne` (`HP/application/ledger.usecase.ts:73`), khoá HĐ → mốc. Trong tx: `exec_hold_at IS NULL` (trừ `payment+receive`); không có `exec_requests` pending trên mốc; vượt phần còn lại ⇒ 422 `OVER_PLAN`; giao ⇒ `confirmDelivery`; thiếu ⇒ hàng con (§2.2) cùng CTE; `evidence_id`, `done_by`, `contract_events{before,after,evidence_id}`. `settle` = fulfill toàn phần.
- **Giao dịch gắn HĐ** (X2): một giao dịch = một mốc; `link.obligation_id` ⇒ `recordFulfillment`; `link.none` ⇒ `deal` (`created_done`) + lý do. Có quy trình `transaction.saved` khớp ⇒ `exec_requests(kind='transaction', pending)`; outcome áp đúng đường trên / từ chối. Không có ⇒ áp ngay.
- **Tạm khoá / thay đổi** (X3): hold/release/postpone/split/waive qua `exec_requests` + cùng use case; bọc `PATCH /milestones/:id` + `postpone` (bằng chứng); đổi giá trị/đơn giá/bên/điều khoản ⇒ 409 `USE_NEW_VERSION`.
- **Phạt** (X4): `penaltyEstimate` thuần (`HP/domain/penalty.rules.ts`, đồng nguyên, làm tròn xuống, trần); book ⇒ `obligations kind='penalty'` chiều theo `owner` mốc; waive ⇒ `penalty_decision='waived'` + bằng chứng.
- **Nhắc** (X4): trước hạn 3 ngày **chỉ khi** công ty không có quy trình `milestone.due` khớp (`hasFlowFor('milestone.due')`, #61) — tránh báo đôi; email nhắc đối tác dùng thư CR-126.
- **Lập mốc khi DONE** (K7): adapter của port `ContractDoneHook` (K1a), đăng ký ở `HP/extraction.mount.ts` (nơi mount luồng trích AI) — K7 chạy sau K6.
- **Phiên bản** (K5): v(n+1) done ⇒ mốc `open` của v(n) chuyển `contract_id` sang v(n+1) (giữ id), mốc đã làm ở lại v(n); bỏ cutover `replaced`. Mốc AI trùng `kind, seq` không tạo thêm.
- **AI "Điều cần lưu ý"** (K7): `AiSummarySchema` + `notes[{group: penalty|payment|delivery|warranty|renewal|dispute, text, clause_ref, page, party?}]`, `risks[{kind, text, clause_ref?}]`, `penalty_terms[]` — tuỳ chọn. **"Cần chú ý"** (R#47) liệt kê cố định `risks.kind` ∈ `auto_renew` (tự gia hạn), `no_suspension_clause` (thiếu điều khoản tạm ngừng), `one_sided_penalty` (phạt một chiều), `unlimited_liability` (trách nhiệm không giới hạn), `short_notice` (báo trước quá ngắn), `missing_acceptance` (thiếu nghiệm thu), `other`.

## 7. Liên công ty và ký cùng lúc
- **Bên nhận** (K8 — Opus medium): `INBOX_CONTRACT_STATUS` + `applyReceivedOutcome` + `receiveInbox` qua cổng (§3 #9–11); bản sửa vào cùng HĐ.
- **Gộp danh sách** (K8 BE + U6): list `source`; băng lời mời lên đầu; gỡ menu `contracts.partner` + `PartnerInboxPage` (giữ API lời mời); `partnerCountPort` ⇒ số HĐ nhận processing chưa ai nhận việc.
- **Phiên ký chung** (P1 — Opus medium): §2.4 + chuyển §3 #12–14c. Hai phong bì selfsign cùng `pdf_sha256`; `mark_signed` từ `esign.completed` bên mình; một bên từ chối ⇒ huỷ phong bì hai bên (`esign-void.ts`); quá `sign_deadline_at` ⇒ `expired` ⇒ bên gửi có việc "Gửi lại / Dừng"; quá `accept_deadline_at` ⇒ `fallback`. Mover thêm pha `sessions` (lô, không ngủ chờ).
- **Node** (P2): `partner-send.sign_together{reason, accept_h=2, sign_h=4, signer_user_ids}`; node `contracts.sign-together-accept` (Đồng ý — chọn người ký trong nhóm Người ký HĐ / Xử lý bình thường / Từ chối HĐ; việc ghim, chuông + email); `EsignNodeConfig.due_hours`. Chưa có nhóm ⇒ tự "Xử lý bình thường" + lý do. Đối tác ngoài Evolu: giữ ký qua link.
- **Sắp hết hạn** (K6): outcome `renew` ⇒ HĐ gia hạn draft (`renews_id`, `extract_state='ready'`, chưa có tệp ⇒ submit đòi `FILE_REQUIRED`); HĐ mới done ⇒ cũ `effect_outcome='renewed'`; `terminate` ⇒ `terminated`; `let_expire` ⇒ không đặt. Gỡ chuông cứng, `DeadlinePanel`, `/handled`, cột `handled`/`action_deadline`.

## 8. UI (một đợt — Luật 0d.4) — nội dung màn theo business §17 + mock; spec chỉ ghi phần kỹ thuật (R#45)
**Mock:** `docs/specs/CR-127/mock/*.dc.html`, bảng M→file ở `mock/README.md`: M1 `Main` · M2 `Editor` · M2b `Components` · M2c `PartnerInbox` · M2d `CoSign` · M3 `TestRun` · M4 `Upload` · M5 `Approve` · M6 `Done` · M7 `List` · M8 `Remove` · M9 `Detail` · M10 `DetailStates` · M11 `Milestone` · M12 `Trade` · M13 `Roles` · M14 `Delegate` · M15 `Compare` · M16 `Flows5` (`Library` = §12b HOÃN, không làm). **Luật: business.md/spec.md thắng mock khi lệch** (vd M12: gắn HĐ ghi thẳng vào mốc theo §10.2 đã sửa); agent UI ghi chỗ lệch vào "Quyết định trong lúc làm".
- **admin-web:** M1 (chọn công ty trước), M2 (danh sách dọc qua lớp `AW/lib/outline.ts`: `stagesToOutline ⇒ Outline | Unsupported{reason}`, `outlineToStages`; tự sinh node Kết thúc + đích Từ chối/Trả lại; flow không biểu diễn được ⇒ chỉ xem + "Sao chép để soạn lại"), M2b (menu nhóm nghiệp vụ, ẩn Quy trình con/Công cụ/Kết thúc, `core.notify`/`core.wait`), khối Duyệt (Ai duyệt · Cần · Hạn · Quá hạn chuyển cho · Bằng chứng · Nhắc; người gửi luôn bị loại), M16 (ô N), M3 Chạy thử, nút Áp dụng (tắt khi còn lỗi thẻ), M8 gỡ.
- **workspace-web:** M4, M7 (lọc 4 trạng thái/Hiệu lực/Nguồn, Đang chờ, chip, băng M2c), M10 (nút theo trạng thái + lý do khi không được), M9 (4 ô số, mốc, Điều cần lưu ý, Cần chú ý), M11, M12, M5 (Nhận việc/Trả về/Giao/Chuyển, "X đang xử lý", "Thay A", `EvidenceInput`, tab M15), M6, M13, M14 (Cài đặt > Uỷ quyền), M15, M2d (ghi "chưa có giá trị pháp lý"), Cài đặt công ty (nhóm Người ký HĐ, giờ tự trả việc, ngưỡng mức quan trọng).
- **Nhãn nguyên văn chưa có trong mock** (#65): mốc trong M9/M11 — "Chưa ai nhận" · nút "Nhận việc" · "{người} đang xử lý" · nút "Trả về nhóm" · "Thay {người}"; thẻ HĐ nhận không có quy trình (Việc của tôi + đầu trang HĐ) — tiêu đề "Đối tác {công ty} gửi hợp đồng — bạn quyết định", nút "Đồng ý" · "Trả lại để sửa" · "Từ chối", ghi chú "Công ty chưa có quy trình nhận hợp đồng".
- Component dùng chung: `EvidenceInput`, `SignaturePad` (canvas tự viết, không thư viện), `StatusChip`, `EffectChip`, `ContractLockChip` (`WW/contract-shared/`; `EvidenceInput`/`SignaturePad` ở `apps/workspace-web/src/platform/flow/ui/`). Câu lỗi lấy từ bảng `tasks.md` §9.

## 9. Hiệu năng (Luật 4c) — **đo trước khi sửa** (R#34): K2a-1, X1, X2 chạy perf có sẵn trên code chưa sửa, ghi số vào báo cáo lát, rồi đo lại sau.
| Đường nóng | Lát | Ngưỡng | Test |
|---|---|---|---|
| `GET /contracts` + nav | K2a-1, K8 | giữ `nav.mount.perf.int.test.ts`, `cr116-list*.bench`; Đang chờ = một câu join theo trang | có sẵn |
| `recordFulfillment` | X1, X5 | ≤ 7 câu SQL/lệnh (gồm 1 tín hiệu task), p95 giữ | int đếm câu |
| `GET /payments` | X1, X2 | giữ `obligations_open_idx`, không JOIN mới | có sẵn |
| dispatcher | E6, K3 | giữ `dispatcher.perf.int.test.ts` | có sẵn |
| `schedule-sweep` | E6 | lô 100 p95 ≤ 50 ms, ≤ 4 câu/lô, 10.000 HĐ | `schedule-sweep.perf.int.test.ts` |
| `claim-release` | E2 | lô 100 p95 ≤ 50 ms, ≤ 3 câu/lô | `claim-release.perf.int.test.ts` |
| claim | E2 | ≤ 3 câu | int đếm câu |
| `refresh_effect` | K1a, K6 | lô 500 một UPDATE; 10.000 HĐ ≤ 2 s | `refresh-effect.perf.int.test.ts` |
| mover phiên ký | P1 | ≤ 2 câu/lô | int |

## 10. Kiểm thử
- **Test trước code** (R#35): K1a, X1, E1, E2, E3, E10, P1 viết int của phần rủi ro trước rồi mới code.
- **Unit:** `contract-state.rules` (mọi dòng §3 + chuyển cấm + `initialState`), `effect.rules`, `delegation.rules`, `canAct`, `reviewDecisionCheck`, `penalty.rules`, `outline.ts` round-trip, `flow-preview`, facts mẫu, diff điều khoản.
- **Int:** mỗi endpoint mới một đường chính + mỗi bảng mới một test chặn đọc chéo tenant; danh sách theo lát ở `tasks.md` §5. Int kiểm thứ người dùng thấy (thẻ, list row), không chỉ dòng DB.
- **e2e hành trình thật** (D5; viết trong lát, chạy MỘT lần cuối; file `e2e/cr127/jNN-*.spec.ts` — R#36): `j01-soan-ap-dung-duyet.spec.ts`, `j02-tra-lai-gui-lai-rut-ve.spec.ts`, `j03-uy-quyen.spec.ts`, `j04-thuc-hien-giao-thieu-phat.spec.ts`, `j05-tam-khoa.spec.ts`, `j06-giao-dich-cho-duyet.spec.ts`, `j07-hai-cong-ty-gui-nhan.spec.ts`, `j08-ky-cung-luc.spec.ts`, `j09-sap-het-han-gia-han.spec.ts`, `j10-phien-ban-chuyen-moc.spec.ts`, `j11-nhan-viec-tat-ca.spec.ts` (Nhận việc đua + "Cần: tất cả"), `j12-xac-nhan-moc-nhan-viec.spec.ts` (mốc sắp tới hạn ⇒ việc nhóm ⇒ Nhận việc ⇒ người khác bị chặn ⇒ xác nhận ⇒ task đóng), `j13-nhan-khong-quy-trinh.spec.ts` (HĐ nhận không có quy trình ⇒ người phụ trách quyết). Không bật sẵn gì trong seed.
- BR → test: bảng phủ ở `tasks.md` §7 (Delta) + cột "Test" §5.

## 11. Gỡ cái cũ (D6)
| Cái cũ | Chỗ | Lát |
|---|---|---|
| 9 trạng thái (literal) | `tasks.md` §3a (danh sách grep đủ, mỗi file một lát) | K1a, K1b, K2a-1, K2a-2, K2b, K4, K8, Z1, U4–U6 |
| "Gửi duyệt" riêng, `holdForFlow` qua `level1` | gap-a BR-02 | K3 |
| `approval_on()`, cờ nhánh HĐ, máy duyệt cũ, shadow-emit HĐ | gap-a BR-78 | K3 (bỏ đọc), Z1 (gỡ) |
| "Mở lại" (route, usecase, repo, zod, i18n) | gap-a BR-38 | K4, U5 |
| "Sửa khi duyệt" (`approval-edit.rules.ts`, `patchGuard`) | gap-a BR-39 | K4 |
| `handled` / `action_deadline` / `DeadlinePanel` / chuông "Hạn chót hành động" (cột + trigger + route + zod + đọc ở mywork/todo/cks-write) | gap-d BR-69; R#10 | K1a (backfill), K6 (gỡ), U5 |
| Cutover mốc `replaced` | gap-a BR-36b | K5 |
| Menu + trang "Hợp đồng đối tác gửi" | gap-d BR-59 | K8, U6 |
| `previewRoutes` + `PreviewDialog` | gap-b BR-17 | E7, U3 |
| ViewModeToggle, LayoutDirControl, kéo thả, mục menu cũ | gap-b §3 | U2 |
| Quyền ghi bản công ty của quản trị công ty | gap-b BR-10/11 | E8, U2 |
| "Tóm tắt hợp đồng" | gap-a BR-55 | U5 |
| `PATCH /milestones/:id` / `postpone` áp ngay | gap-c BR-52/75 | X3 |
| **ai-admin — dọn theo M8 (`mock/Remove.dc.html`), người dùng 2026-11-10 "dọn luôn":** hộp "Bắt đầu khi" + điều kiện giả "< -1" · khối "Các trường" (Thêm/Xoá trường `contract_id`) · ẩn "Nguồn của quy trình / Giới hạn chi phí AI / Mã nội bộ" khi không có bước AI · gộp "Thời hạn lượt chạy / Không hết hạn / Giới hạn của một lượt chạy" vào hạn từng bước Duyệt · gộp "Xem trước bằng HĐ mẫu" vào Chạy thử · gỡ toggle Sơ đồ/Danh sách + Ngang/Dọc · gộp 3 bước Kết thúc · gỡ tab "Mẫu có sẵn" (AI-SDLC) · gỡ dòng "luồng duyệt do hub chạy… Xem Workflow Dify →" · gỡ nhãn "Mẫu cũ – không sao chép được" (dọn mẫu cũ khỏi Thư viện) · ẩn quy trình DLC khỏi danh sách theo công ty | M8 | U2 (+ E7 xem trước, E8 quyền) |
| **Sổ Hợp Tác — dọn theo M8 + M10:** chip "Đã khoá" + "Chưa có văn bản" + băng "Đã xác nhận – đã khoá" ⇒ một chip trạng thái + chip hiệu lực + một băng lý do khi cần · thẻ "Ký số · Chưa cấu hình ký số" trên chi tiết ⇒ một dòng trong Hồ sơ duyệt · "Ghi nhận xử lý / Hạn chót hành động" ⇒ thẻ Hiệu lực · cột "Bước" ở danh sách ⇒ Trạng thái + Đang chờ · "Mở lại để sửa lỗi trích xuất" ⇒ sửa ở DRAFT · "Tóm tắt hợp đồng" ⇒ "Điều cần lưu ý" · 3 thẻ to Mua/Bán/Giới thiệu trên HĐ đã lưu ⇒ một giá trị · ô nhập khi đã khoá ⇒ chữ đọc · chữ phụ "Số cũ có ký tự đặc biệt… Dùng", "Mới · chưa đủ việc để tính điểm khách hàng" (chuyển sang trang Đối tác) · "Quản lý hợp đồng · Giao cho" ⇒ "Phụ trách ▾" · "Tải bản cập nhật" ⇒ "Tải phiên bản mới" · menu + trang "Hợp đồng đối tác gửi" ⇒ bộ lọc Nguồn | M8, M10 | U4 (danh sách), U5 (chi tiết), U6 (nav/Nguồn) |
| Menu "Yêu cầu" riêng | M8 "Xem lại" | **giữ** (còn phiếu đề nghị mua hàng CR-126); HĐ đi thẳng từ Tải lên |

ops-watch (Z1, BR-79): check `contract_state_drift` — processing không có lượt mở > 10 phút; done/reject có lượt mở; `effect` ≠ tính lại; mốc con vượt kế hoạch; `exec_requests` pending không có sự kiện. Khuôn `apps/hub-api/src/modules/ops/adapters/checks/*.check.ts`.

D7 (Z0): seed/onboard công ty mới có app Hợp đồng ⇒ gán mẫu Duyệt HĐ mua/bán, Nhận HĐ thường/quan trọng, 4 mẫu §12; chọn nhóm Người ký HĐ (seed demo). Kèm mẫu "Xác nhận mốc" (§5.9). **Công ty đang có: không tự gán** (người dùng chốt R#20) — quản trị nền tảng áp tay qua M1/Áp dụng; không viết script gán hàng loạt.

## 12. Quyết định trong lúc làm
- 2026-11-10 · readiness · Áp mặc định readiness lần 1 (#1–#49 trừ #20, #21). #20, #21: chờ người dùng (§1, §3 #9, §11 D7).
- 2026-11-10 · readiness · Áp mặc định readiness lần 2 (#50–#70); tách K1→K1a/K1b, K2a→K2a-1/K2a-2.
- 2026-11-10 · readiness · Áp mặc định readiness lần 3 (#71–#74 + TB/Thấp): MIGC 0094 `awaiting_decision` (K8); `hub.task_holder` (E1) + `FlowTaskSignal.holder` (X5); X5 thêm `exec-request.usecase.ts`, `milestones.routes.ts` (khoá X3 → X5); K7 mount ở `HP/extraction.mount.ts`, sau K6; `deadline.rules.ts` chỉ K1a.
- 2026-11-10 · readiness · Áp mặc định readiness lần 7 (#80: 0092 GRANT SELECT cột + policy SELECT cho `contracts_job`; K3 grep trigger UPDATE — ghi bảng khác ⇒ DEFINER hoặc `WHEN` cột khác status; int K3 dưới role thật); tự duyệt Gate (Luật 1b/2b) — spec READY.
- 2026-11-10 · readiness · Áp mặc định readiness lần 6 (#79: MIGC 0092 cấp UPDATE cột + policy `contracts_job_fail`, INSERT `contract_events` + policy cho `contracts_job`; INSERT trong cùng `SET LOCAL ROLE`; int K3 kiểm đúng N hàng đổi).
- 2026-11-10 · readiness · Áp mặc định readiness lần 5 (#77: đổi số 0094 K8 · 0095 P1 ở mọi chỗ; #78: `failedBatch` dùng `SET LOCAL ROLE contracts_job` chỉ cho UPDATE, join theo `(tenant_id, id)`, int K3 chặn chéo tenant).
- 2026-11-10 · readiness · Áp mặc định readiness lần 4 (#75: đánh lại số MIGC theo thứ tự áp — 0091 K1a · 0092 K3 · 0093 X1 · 0095 P1 · 0094 K8 · 0096 K6 · 0097 K7 · 0098 P2 · 0099 Z1, hub giữ 0131/0132/0133; #76: `failedBatch` cho `expireBatch`). Các dòng cũ trong mục này đã đổi số theo bảng mới.
- 2026-11-10 · K3 · #74 grep nơi lượt chạy quy trình (`hub.process_runs`) kết thúc không thành công: **huỷ** `apps/hub-api/src/modules/processes/gates/run-control.service.ts` `RunControlService.stop` (→ `gates.effects.ts#cancelEnd`); **lỗi** không có literal `status='failed'` cho `process_runs` — trạng thái tổng hợp ghi ở `application/runs/settle-step.usecase.ts` (`r.steps.setStatus(runId, status, first)`, dòng ~210) → `adapters/runs/step.repo.ts#setStatus` (dòng ~155) và `gates/gates.repo.ts` (dòng ~155, `status = ${status}`); **hết hạn** `runs/expire.ts#expireBatch`/`claimExpired` (dòng ~44–87). (Literal `'failed'` ở `runs/team-member.ts`, `adapters/runs/team-run.repo.ts`, `runs/apply-driver.ts` là `hub.runs` của agent — không liên quan.) Hook gọi ở 3 chỗ trên; `run-control.service.ts` chỉ K3 sửa.
- 2026-11-10 · người dùng · #20: mẫu §12 chỉ tự gán công ty mới; #21: không quy trình nhận ⇒ người phụ trách HĐ nhận quyết (§3 #9b); prod chưa có người dùng ⇒ bỏ đếm trên bản sao prod, rủi ro dữ liệu khách hạ; Q11 đảo: xác nhận mốc là việc nhóm (§5.9, lát E10 + X5); mock trong `mock/`, business/spec thắng mock.
- 2026-11-10 · K8 · Lệch/quyết trong lát: (a) lượt nhận **huỷ/lỗi/hết hạn/không mở được** ⇒ HĐ nhận GIỮ processing + `awaiting_decision` (người phụ trách quyết) thay vì về draft như #7b — về draft sẽ treo đối tác không có câu trả lời; (b) người phụ trách HĐ nhận ghi vào `owner_user_id` lúc nhận = người phụ trách đã đặt còn hiệu lực, không thì quản trị công ty sớm nhất (cùng luật `flowReceiveState.actor`) — "Việc của tôi" + quyền quyết đọc một cột, quản trị công ty (`admin` của gói) luôn quyết được; (c) MIGC 0094 thêm: bỏ unique `partner_inbox(tenant, contract)` ⇒ unique một dòng `pending`/HĐ (nhiều vòng/HĐ — Q10), `hub.partner_inbox_take` trả thêm `prev_id` (DROP+CREATE), nới `hub.evidence_subject_kind_ck` += `inbox_decision` (`record_evidence('task_decision')` đòi id việc engine); (d) `failedBatch` cho `contract.received` một câu mỗi mục (hiếm; lệch Luật 4c); (e) mã thêm `INBOX_REPLY_CLOSED` 409 (lần gửi đối tác đã hết hạn/đã trả lời — rollback cả cổng); (f) **chưa gỡ** cap nav `contracts.partner` phía server: gỡ cùng U6 (chip Nguồn + băng lời mời) để không mất lối vào lời mời nối trước khi có chỗ thay (D6 một thay đổi).
- 2026-11-10 · E8 · `PUT /tenants/:tid/flow-settings` (`flow_triggers`, `claim_release_h`) **vẫn cho quản trị công ty ghi** — ngoại lệ có chủ ý của BR-11 (cài đặt vận hành, không phải nội dung/áp dụng quy trình). `/process-defs` ghi (tạo/sửa/xoá/sao chép) và luật định tuyến: chỉ platform_admin (soát Opus E8). `POST /process-defs/:id/run` là chạy thật một lượt ⇒ giữ quyền cũ (không phải soạn/áp dụng).
- 2026-11-10 · X5 · §5.9 làm rõ: **tách mốc KHÔNG đóng việc của mốc gốc** (mốc gốc vẫn mở, giữ hạn; mốc con có hạn riêng tự có việc mới); chỉ **dời hạn** gửi tín hiệu `cancelled`. `claimGuard` đọc người giữ việc không khoá (chấp nhận theo #72 — tránh khoá ngược; đua hiếm: ghi của người cũ có thể lọt và đóng việc người mới nhận). Tín hiệu `done` ghi cả khi công ty không có quy trình (unique chống trùng; vòng `task-signal` đánh dấu đã xử lý — cần int ở E10).
- 2026-11-10 · FIX-Q1c · giao dịch (`doc_type='deal'`) KHÔNG thuộc khoá K4 (chứng từ nội bộ, done ngay khi tạo, BA CR-097 cho sửa mô tả trực tiếp + thêm đợt giao): loại khỏi `isContentLocked`/`lockVerdict` (patch-fields, hoa hồng), milestones `lockContract/lockContractOf`, appendix, review `attachProduct`, product-links; HĐ giữ khoá. Gắn SP khi `extract_state='reading'` ⇒ `ITEM_LOCKED`; dấu vân tay sourcing thêm `effect`.
- 2026-11-10 · NF1 (người dùng chốt) · công ty chưa có quy trình duyệt khớp ⇒ **chặn Gửi** `NO_APPROVAL_FLOW` (409; HĐ giữ DRAFT, không lượt/hồ sơ/sự kiện; "Xác nhận & lưu" cũng chặn, rollback cả lần lưu) thay cho đi thẳng DONE (§3 #4); chi tiết HĐ có `submit_block: 'no_flow' | null` + `can.submit = false`, tính bằng `submitFlowOpen` = cùng `flowOf` của lệnh Gửi. HĐ nhận từ đối tác giữ nguyên (không quy trình ⇒ người phụ trách quyết, j13).
- 2026-11-11 · R1 · perf DOC-model list-frame p95 51–100 ms (ngưỡng 50 ms, máy yên `-Exclusive`; SQL vẫn 2 câu) — CHƯA ĐẠT; nghi cột list mới CR-127 (`effect`, state, hold). Hoãn theo người dùng (làm hết tính năng trước, đo sau); `/payments` p95 158 ms, E6 sweep 60–76 ms cũng chưa đạt.
- 2026-11-11 · Q11 (người dùng chốt) · HĐ thường **không còn nút «+ Thêm mốc»** (kể cả loại «Giao theo %»): mốc lấy từ trích xuất / sửa ở DRAFT; «+ Thêm mốc» chỉ còn ở HĐ nguyên tắc (Nhắc gia hạn, Khác). Ca e2e cũ `delivery-opts` «+ Thêm mốc · Giao theo %» xoá. Xác nhận mốc giao vượt tồn: `FulfillDialog` hiện câu máy chủ `STOCK_INSUFFICIENT` + gợi ý (dùng chung `saveErrorText`).
- 2026-11-11 · FIX-OV (mặc định điều phối, ghép CR-113 × «Nhận việc trước Duyệt») · người **Toàn quyền** (Group «cũng quyết» `after.also_group_ids` của bước duyệt) **Nhận việc được** như người của bước (`claimTask`/`claimMiss` thêm điều kiện con trong CÙNG câu); Duyệt sau đó vẫn ghi «duyệt thay» (`overrideOnly`, huy hiệu `approval-owner-override`). Không miễn Nhận việc; ngoài nhóm không Toàn quyền vẫn 404. `stepsView` `can_act` CỐ Ý không tính `claimBlocks` (thẻ cần `can_act=true` + `claim.state='other'` để hiện «X đang xử lý» và khoá nút; false ẩn cả khung — hồi quy j11); quyết thử vẫn 409 `TASK_CLAIMED`.
- 2026-11-11 · Z7 (người dùng chốt, Intake Nhanh) · **Xoá quy trình nháp:** admin nền tảng xoá được quy trình của công ty khi còn NHÁP (chưa xuất bản/chưa áp dụng, không có lượt chạy) — nút «Xoá» ở trang Quy trình theo công ty + màn soạn, hộp xác nhận; quy trình đã áp dụng/đang chạy thì không xoá (Tắt thay). Dùng `DELETE /process-defs/:id` sẵn có (chỉ platform_admin).
- 2026-11-11 · Z8 (người dùng chốt, Intake Nhanh) · **Xoá hợp đồng nháp:** HĐ trạng thái `draft` xoá được bởi người tạo / người phụ trách / quản trị gói, đặt trong menu **«Thao tác»** của chi tiết HĐ, hộp xác nhận (dùng lại xem trước tác động của «Xoá hợp đồng» V2-M). HĐ ngoài draft giữ luật cũ (chỉ quản trị gói). Mặc định điều phối: draft đã từng gửi duyệt (có lượt/hồ sơ duyệt) vẫn xoá được nhưng hộp xác nhận nêu rõ.
- 2026-11-11 · Z6 (người dùng chốt «xoá mẫu cũ») · hub **0138** `cr127_remove_shared_company_flows`: xoá `company_flows` trỏ def dùng chung (`tenant_id IS NULL`, `app IN ('contracts','community')`); lưu trữ (`deleted_at`, `enabled=false`) def **không phải mặc định khe** (`slot IS NULL`, không có `process_slots`/`process_tenant_defs`/luật định tuyến) và **không còn lượt mở** — def còn lượt mở chỉ gỡ gán (lượt chạy tiếp theo ảnh chụp; chạy lại migration sau khi lượt xong thì lưu trữ nốt); không đụng `process_runs`; bump `hub_config_version`. Dev: gỡ 4 dòng `company_flows` (demo + evolu × «Quy trình mua hàng», «Quản trị duyệt bài»), lưu trữ 5 def (cha + 3 phần mua hàng, duyệt bài); 3 def khe community giữ. admin-web: `ProcessEditorPage` không còn nhánh `kind≠company ⇒ LibraryReadOnlyView` (mọi quy trình mở từ công ty là của chính công ty); gỡ chữ «Mẫu dùng chung nằm ở tab Thư viện» (`process.admin.byCompany.subtitle` vi/en). Int `packages/db/src/hub-cr127-z6.int.test.ts`.
- 2026-11-11 · Z6 · **CÒN LẠI (chưa làm, ngoài giờ lát)**: (1) `POST /tenants/:tid/company-flows {flow_id}` (`company-flows.service.ts` `assign` + `company-flows.repo.ts` `assignableDef`) + UI `AssignFlow`/`AssignFlowDialog` vẫn cho gán def dùng chung `tenant_id NULL` ⇒ vẫn tạo được `kind:"assigned"`; gỡ cần viết lại ~8 file int dùng `{flow_id: lib}` làm fixture (company-flows, -active, -apply, -create, -readiness, library-flow-publish, partner-confirm, seed.cr127-config) + `COMPANY_FLOW_KINDS` trong contracts. (2) seed fixture (`seed.cr125-config.ts` `writeLibrary` + `assignDefaultFlows`) vẫn ghi lại 4 mẫu + gán cho công ty trên DB MỚI/reset (DB đã chạy 0138: def lưu trữ nên seed không gán lại); cần bỏ cùng e2e `journey-approval/cr125-purchase-full.spec.ts` + `tools/scripts/src/seed-cr125-config.int.test.ts` (khoá — Tranh chấp test nếu đổi).
- 2026-11-11 · Z7 · **Gỡ đường gán mẫu:** `POST /tenants/:tid/company-flows` chỉ còn dạng tạo `{name, app, from:"blank"}` (dạng `{flow_id}` ⇒ 400); xoá `CompanyFlowsService.assign`; `assignableDef` (dùng cho `apply`) chỉ nhận def CỦA CHÍNH công ty; `listCompanyFlows` chỉ join def cùng công ty (không bao giờ trả `kind:"assigned"`; `COMPANY_FLOW_KINDS = ["company"]`). Gỡ luôn máy «thay bản gốc / quay về bản gốc» (không còn bản gốc): route `POST …/:id/revert`, `originalRowOf`/`copyRowOf`, `FLOW_PAIR_ACTIVE`; `apply`/publish chỉ bật dòng của quy trình, audit bỏ `replaced_flow_id`. admin-web: xoá `AssignFlow`, `AssignFlowDialog`, `ReadinessPanel`, `readiness-api`, `AssignErrorNote`, `assign-error`, `readiness-view`, op `assign`/`revert`, mục «Mẫu thư viện», chữ i18n liên quan; nút «Gán» của wizard đi tới tab Quy trình. Điều kiện «Đối tác xác nhận»: fix `assign-receive-flow` bỏ ⇒ `receive_flow` dùng `open-flows` (contracts `partner-confirm.ts`). Int viết lại sang quy trình công ty dựng bằng `processes/testing/company-flow-seed.ts` (`seedCompanyFlow`; nháp/đã áp dụng); `library-flow-publish` + `partner-confirm`: dòng `company_flows` của def Thư viện cũ dựng bằng SQL (engine còn đọc được dữ liệu cũ).
- 2026-11-11 · Z7 · **Xoá quy trình nháp:** `DELETE /process-defs/:id?tenant_id&version` (chỉ platform_admin, route sẵn có): def CÔNG TY chỉ xoá khi `published_version IS NULL` và KHÔNG có `process_runs` nào ⇒ nếu không ⇒ 409 `PROCESS_NOT_DELETABLE` (`details.reason` = `applied` | `has_runs`; thêm vào `HUB_ADMIN_PROCESS_ERRORS`); xoá cùng tx với dòng `company_flows` (`softDeleteDef` + `deleteCompanyFlowRows`). `CompanyFlowRow` thêm `def_version` + `deletable` (Hub tính trong danh sách — một nguồn; UI chỉ hiện «Xoá» khi `deletable`, đã áp dụng/có lượt chạy ⇒ không hiện, dùng Tắt). UI: `DeleteDraftFlow` (nút + `ConfirmDialog`) ở `CompanyFlowsOverview` + `CompanyEditorBar` (xoá xong về `/processes`). i18n `process.admin.byCompany.delete*` + `apiError.PROCESS_NOT_DELETABLE` vi/en. Int `processes/defs/defs-delete-draft.int.test.ts` (nháp xoá 204 + quản trị công ty 403; đã áp dụng 409; nháp có lượt 409). Cần restart hub-api.
- 2026-11-11 · Z7 · **Tranh chấp test (e2e khoá, không sửa):** `e2e/_kit/api.ts` `assignCompanyFlow` (POST `{flow_id}` ⇒ nay 400) và `e2e/_kit/ui.ts` `assignFlowUi` (ô «Quy trình trong Thư viện» + nút «Gán» đã gỡ) — dùng bởi `e2e/community-web/flows.cs.ts`, `flows.queue.cs.ts`, `journey-approval/cr123-u6-run-card.spec.ts`, `cr125-form-step-card.spec.ts`, `cr125-s2-settings-flow.spec.ts`; qc đổi sang `createBlankFlow`-kiểu (POST `{name,app,from:"blank"}` → PUT def → `…/apply`) như `e2e/cr127/_cr127-stack.ts`. Còn lại: seed fixture `seed.cr125-config.ts` (`writeLibrary`/`assignDefaultFlows`) + `hub.company_flows.replaced_by`/`library_newer`/`source` trong contract (dữ liệu cũ) — dọn ở lát sau.
- 2026-11-11 · Z9 · **(1) Một nguồn «quy trình đang bật»:** `eventFlowOf` (Cài đặt Sổ Hợp Tác `readCurrentFlow`, `submit_block` dùng `flowOf` ⇒ `candidatesOf`) lệch nhau: `EVENT_FLOW_SQL` đòi `published_version` + `process_def_releases`, nhưng «Lưu và áp dụng» của quy trình CÔNG TY không xuất bản ⇒ Cài đặt báo «chưa có quy trình» trong khi Gửi duyệt (dispatcher, không đòi xuất bản) vẫn chạy. Sửa `processes/library/event-flow.repo.ts`: def công ty lấy `d.stages` hiện hành (`rel_version = coalesce(published_version, version)`); def Thư viện (dữ liệu cũ) giữ bản xuất bản. Gửi duyệt/`submit_block`/Xem trước đã dùng `candidatesOf` — không đổi. Int `approval-flow-current.int.test.ts` ca «Z9». **(2) Seed:** `seed.cr125-config.ts` gỡ `assignDefaultFlows/EventFlows/ManualFlows` + `DEFAULT_FLOWS` + trường `companyFlows`; `ensureCommunityDefaultFlow` chỉ ghi mẫu, không gán; int seed (`seed-cr125-config`, `seed.cr126`, `seed.cr127`) đổi sang «không gán flow nào». **(3) `no_group`** (`company-flows.repo.ts`): cùng luật `reviewHasGroup` — «cùng duyệt» đủ nhóm (`parallel.groups` mỗi nhóm có id/mã) ⇒ không cảnh báo; thiếu ⇒ cảnh báo; bước chỉ có `approver_user_id` ⇒ không cảnh báo; luật soạn admin-web (`parallel-form.ts`) đã khớp. Cần restart hub-api.
- 2026-11-12 · CR-128 (người dùng chốt, Intake) · làm trong CR-127 trước commit: (a) dàn lại header + card chi tiết HĐ, nút thao tác một hàng; (b) cột «Số HĐ» sau «Tên» (tìm theo số đã có qua `search_key`); (c) xoá HĐ nháp (chưa gửi ai) bởi người tạo, kể cả ở danh sách (thùng rác theo `can.delete` từng dòng); (d) demo dựng «Duyệt HĐ» (`contract.submitted`, 2 bước + Nếu > 500 triệu) và «Đề nghị mua hàng» (bắt đầu bằng phiếu) qua đường admin nền tảng, KHÔNG mở «Khi tải HĐ lên» (Q15), viết lại UAT. «Người phụ trách không sửa được»: BỎ QUA.
