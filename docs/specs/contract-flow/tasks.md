# contract-flow · Duyệt hợp đồng nhiều phòng ban trên engine quy trình

Người dùng chốt 2026-10-23: "làm đầy đủ" — duyệt HĐ chạy trên engine quy trình (bỏ M3-decouple cho phần duyệt), quản trị công ty tự thiết kế luồng.
Mặc định đã áp (không hỏi lại): (1) bật bằng `CONTRACTS_APPROVAL_ENGINE=on` (+ `HUB_PROCESS_ENGINE`), tắt ⇒ máy 2 bước cũ; (2) bước Dify chỉ chọn trong catalog đã có; (3) bước giao cả nhóm phòng ban, `head_only` tuỳ chọn (phòng không có trưởng ⇒ cả nhóm).
Bản mẫu: thiết kế cũ HD3 trên engine — `git show 7754adec^:apps/hub-api/src/modules/packs/contracts/{domain/approval-def.rules.ts,adapters/contracts.tools.ts,application/approval.usecase.ts}`.

## Thiết kế
- **Mẫu luồng / tenant** — bảng `contracts.approval_flows(tenant_id, version, steps jsonb, updated_by/at)` (`packs.secure_table`). Bước:
  - review `{key, name, department_group_id, head_only, due_h, remind_every_h, escalate_group_id|null, exclude_starter, when}`; `when` = AND/OR trên `deal ∈ {buy,sell,referral}` và `total_value` so ngưỡng (trống ⇒ cần bước, như `needsLevel2`).
  - dify `{workflow_key, after}`. Bước 0 không điều kiện (bước soạn); sau bước dify là bước không điều kiện. Tối đa 8 bước người dùng thấy (engine ≤ 10 stage).
- **compileDef(template, groupIds)** (domain gói, thuần) ⇒ def engine `contracts-approval`: `s0` (tool `contracts-route` + review bước 0) → `route` (tool tự chạy, branch `next eq j → goto j`) → `s1..sn` (tool + review + branch) → `finalize` (tool `contracts-finalize`, `real_action`). `ttl_days: null`. `next` tính ở gói bằng `nextApplicable(steps, facts)` ⇒ điều kiện AND/OR tuỳ ý, engine chỉ rẽ. Def đẩy bằng `port.ensureDef` khi version đổi; run chụp def ⇒ sửa luồng không ảnh hưởng run đang chạy.
- `due_h` ⇒ escalation `after_h` của engine (UI hiện hạn = created_at + due_h); nhắc lặp `remind_every_h`; nhóm chuyển cấp ≠ nhóm duyệt.
- **Mẫu mặc định** dựng từ `approval_settings` hiện có: bước 1 nhóm cấp 1 (người gửi được), bước 2 nhóm cấp 2 `exclude_starter`, chỉ khi giá trị ≥ ngưỡng hoặc trống ⇒ tenant không sửa luồng giữ đúng hành vi 2 bước.
- **Chạy:** `contracts.approvals` thêm `mode ('machine'|'engine')`, `engine_run_id`, `flow_version`, `pending_links jsonb`. Hàng cũ `machine` chạy nốt máy cũ (giữ nguyên `approval-machine.rules.ts`). AI đọc vẫn ở gói; chỗ hôm nay mở cấp 1 ⇒ start run engine (`start-pack-run.usecase.ts`, ref `{pack:'contracts', record_id}`). Ai được quyết = `canAct` của engine (nhóm, head_only, nhóm chuyển cấp, luật người gửi). Đạt = `port.act` pass; Trả lại = fail + `back_to_steps [0]`; Từ chối = reject ⇒ gói đánh dấu HĐ từ chối; Đọc lại = `port.cancelSys` ⇒ extracting ⇒ run mới.
- **Bước cuối:** request duyệt cuối lưu `pending_links` (gắn SP) trong tx gói rồi `act`; `contracts-finalize` chạy trong tx gói, chỉ đụng HĐ có `engine_run_id = ctx.processRunId`, kiểm lại `passedStages` phủ đủ bước bắt buộc theo giá trị HIỆN TẠI + flow_version, áp gắn SP, `confirmed_by = lastApprover`. `finalizes_on_approve` = bước mở là bước review áp dụng cuối.
- **Thẻ duyệt:** `GET /contracts/:id/approval` thêm `mode`, `steps[]` (tên, phòng, người nhận, trạng thái pending/open/passed/skipped/returned, due_at, escalated, decided_by/at, feedback) + `task_id`, `can_act`; giữ tương thích hình dạng cũ.
- **Việc của tôi:** `port.openTasksOf(u,'contracts')` — một câu SQL.
- **Thông báo:** run có `pack_ref` ⇒ notifier engine gọi thêm `notify.enqueue` (chuông contracts-web, link HĐ) cùng tx, một lần mỗi lô.
- **RLS:** gói luôn đọc `engine_run_id` từ hàng của mình dưới RLS trước khi gọi engine; port chạy scope user; lời gọi hệ thống lọc `tenant_id = any`/`id = any`; `pack_ref` chỉ `port.start` ghi.
- **Hiệu năng:** timer/nhắc của engine đã SKIP LOCKED; reconcile gói trong `approval-sweep.ts` mỗi lô 100: 1 select + 1 `outcomesOf` + 1 UPDATE theo tập. GET approval giữ p95 ≤ 30 ms (engine ≤ 2 câu SQL).
- **UI quản trị:** tab "Quy trình duyệt" trong Cài đặt contracts-web (`SettingsDialog.tsx`): danh sách bước, chọn phòng, "chỉ trưởng phòng", hạn/nhắc giờ, nhóm chuyển cấp, điều kiện loại + giá trị, thêm bước Dify (catalog có sẵn), xem trước đường đi. `PUT /approval-flow` kiểm, tăng version, đồng bộ def. Không dùng editor Processes của admin-web (đóng băng).

## Lát (Luật 0b)
| Lát | Làn | Phụ thuộc | Migration | Ghi chú |
|---|---|---|---|---|
| S1a Engine bridge v2 (`pack-runs.ts`, `pack-runs-view.ts`, `pack-runs.ports.ts`, `start.service.ts` ref) | đầy đủ / Opus | – | hub 0058 (`when` 1796700000000): `process_runs.pack_ref` + index | ensureDef, steps view, act, cancelSys, outcomesOf (set), passedStages, lastApprover, groupIdsOf |
| S1b head_only + chuông + openTasksOf | đầy đủ / Opus | S1a | hub 0059 (`when` 1796800000000): grant `notify.enqueue` cho `hub_rw` | |
| S2 Mẫu luồng + API | đầy đủ / Opus | – | pack 0047 (`when` 1797600000000): `approval_flows` + cột mới `approvals` | rules thuần + GET/PUT `/approval-flow` |
| S3a Start engine + tools | đầy đủ / Opus | S1a, S2 | – | `contracts-route`, `contracts-finalize`, wire `packRuns`, nới depcruise (chỉ cho kit ports) |
| S3b Thẻ API, act, reconcile, Việc của tôi | đầy đủ / Sonnet | S3a, S1b | – | |
| S4 UI thẻ duyệt | nhanh / Sonnet | S3b | – | dòng thời gian, hạn, chuyển cấp, Trả lại |
| S5 UI thiết kế luồng | nhanh / Sonnet | S2 (DTO) | – | |

Thứ tự: S1a ‖ S2 ‖ S5 → S1b ‖ S3a → S3b → S4. Cuối đợt: e2e đầy đủ + `test:all` + `test:frozen`, ADR ngắn đảo M3-decouple cho phần duyệt, CR, STATE.

## e2e cuối đợt
1. Mẫu mặc định = hành vi 2 bước (dưới ngưỡng bỏ cấp 2; người gửi bị chặn cấp 2). 2. Luồng 4 phòng (Kinh doanh → Pháp chế → Kế toán → Giám đốc). 3. Giới thiệu bỏ Kế toán; ≥ ngưỡng thêm Giám đốc. 4. head_only: thành viên không có nút, trưởng phòng có. 5. Quá hạn (đồng hồ giả): nhắc vào chuông, chuyển cấp thêm nhóm. 6. Trả lại bước soạn, sửa, đạt lại. 7. Từ chối cần lý do. 8. Duyệt cuối + gắn SP. 9. Duyệt đang chạy trên máy cũ chạy nốt kiểu cũ. 10. Sửa luồng giữa chừng, run cũ giữ đường cũ. 11. Bước Dify (workflow giả). 12. Chéo tenant 404.

## Quyết định trong lúc làm
- S2 · `finalize` biên dịch `real_action: false` (như bản mẫu HD3): engine chặn đích `real_action` khi stage rẽ là `auto` (`route` → `finalize` khi không còn bước áp dụng) và lúc chạy đòi bước liền trước là review Đạt ⇒ `real_action: true` làm hỏng đường "chỉ bước 0". An toàn nằm ở `contracts-finalize` (kiểm lại `passedStages` theo giá trị hiện tại). S3a đăng ký tool `contracts-finalize`/`contracts-route` với `side_effect: false`.
- S2 · Đánh số bước engine: bước người dùng 0 ⇒ step 0, `route` ⇒ step 1, bước i ≥ 1 ⇒ step i+1, `finalize` ⇒ step n+1 (`engineStepOf`). Tool `contracts-route` trả `next` = step engine (`routeNext(steps, facts, from)`); stage `s0` cũng chạy `contracts-route` (không rẽ); `s1..sn` review có `back_to_steps: [0]` (Trả lại).
- S2 · `head_only` lưu ở mẫu nhưng CHƯA đưa vào def (schema stage engine là strict, chưa có trường) — S1b thêm trường engine, S3a thêm vào `compileDef`.
- S2 · Bước Dify = `{kind:'dify', key, name, workflow_key, after:'auto'}` (`after` chỉ có `auto` ở v1); biên dịch thành stage tool `args: {}` (tham số workflow do S3a/ensureDef kiểm với catalog); luôn áp dụng (không `when`).
- S2 · `when` = `{op:'and'|'or', conds:[{field:'deal', in:[…]} | {field:'total_value', op:'ge'|'gt'|'le'|'lt', value}]}` (≤ 6 vế); loại HĐ trống hoặc giá trị trống/âm/không số ⇒ vế ĐÚNG (cần bước).
- S2 · Version: mẫu mặc định = 1 (chưa lưu, `is_default`); PUT gửi `version` đang thấy (khoá lạc quan, lệch ⇒ 409 `VERSION_CONFLICT` `details.current`); lưu đầu ⇒ 2. Hạn mặc định mẫu từ cài đặt = 72 h; Group thiếu ⇒ `department_group_id: null` (PUT ⇒ 422 `GROUP_REQUIRED`).
- S2 · `compileDef(flow, groupIds: Set)`: `groupIds` = id Group còn ở tenant; mẫu trỏ Group đã xoá ⇒ ném `approval-flow-group-missing`. `run_group_ids: []` (gói tự quyết ai bắt đầu run; Group chỉ ở review/chuyển cấp).
- S2 · Kiểm Group tồn tại khi PUT qua `packGroups.existingIds` (kit, scope system lọc `tenant_id`); `FlowDefSync` (S3a) gọi SAU commit, vắng ⇒ bỏ qua. Domain giữ bản sao DTO ở `approval-flow.types.ts` (ADR-0023, depcruise cấm domain/application import `@ai/contracts`), khớp hai chiều kiểm trong `approval-flow.rules.test.ts`.
- S2 · Bỏ qua lỗi có sẵn trên nhánh gốc (không do S2): `rls-packs.int.test.ts` ca "không có bảng quên khai" đỏ vì 8 bảng cũ chưa khai (import_rows, partner_contacts, price_scout_*, product_sources); `check:pack-sql` (0039), `check:fn` (file khác), depcruise (file khác).
