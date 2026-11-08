---
id: cr125-parallel-approval-engine
lát: cr125-parallel-approval-engine
cr: CR-125
làn: đầy đủ (máy trạng thái run / đồng thời)
migration: có — 0128_review_tasks_parallel_open (chỉ đổi index, không đụng dữ liệu)
phụ thuộc:
---
## Plan (ngắn)
«A + B cùng duyệt» cho quy trình mua hàng (`docs/specs/CR-125/purchase-flow-trial.md` G3; hàng 3, 6, 10): mở rộng node Duyệt có sẵn
(không thêm đường engine song song). `after.parallel` trên stage `approve` ⇒ mở một thẻ duyệt mỗi nhóm cùng lúc; quyết theo luật.

## Làm
- [x] Contract `packages/contracts/src/hub-admin/process-approve.ts`: `ApproveParallelSchema`, `parallelNeed`, `parallelStageIssues`, `PARALLEL_CODES`/`PARALLEL_KEY`; `after.parallel` trong `ProcessStageDefSchema`; `PROCESS_DEF_RULES += PARALLEL_GROUPS_MIN2, PARALLEL_RULE_INVALID`.
- [x] Sổ module: `core.approve` có `configPort` = `APPROVE_CONFIG_PORT` (`modules/core/index.ts`); `templateNeeds` đếm nhóm của `parallel`.
- [x] i18n `process.admin.parallel.err.<MÃ>` (vi/en) + bộ mã `parallel-approval` trong `check:error-codes`.
- [x] Hub: gắn mã nhóm ⇒ id (`triggers/group-keys.rules.ts` — mở lượt + sao chép công ty), luật lưu def (`nodes/approve/node.ts`).
- [x] Engine mở thẻ: `gates/parallel-open.ts` (gọi từ `runs/team-runner.ts` openReview và `gates/gates.effects.ts` openReview `use_current`).
- [x] Engine quyết: `gates/parallel-approve.ts` (`parallelStep` / `partialOut`) gọi trong `GateService.#review` sau khi khoá run.
- [x] Thẻ người xem: `runs/pack-runs-view.ts` `rowsSql` ưu tiên thẻ MỞ của nhóm người xem (getApproval / thẻ HĐ).
- [x] Migration 0128: `review_tasks_open_uq` = (stage_run_id, kind, nhóm assignee) where open.

## Không làm / Chạm
- Không UI (lát Sonnet làm panel sau). Không chạm launch/settle của engine (lát cr125-subprocess-engine) ngoài 3 dòng gọi `openParallel` trong `team-runner.openReview`.

## Test tối thiểu
- Unit `apps/hub-api/src/modules/processes/gates/parallel-approve.test.ts`.
- Int `apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts` (evotest -Dirty) + bộ int duyệt có sẵn.

## Quyết định trong lúc làm
- Lá phiếu = thẻ `hub.review_tasks` của từng nhóm (result, decided_by, decided_at, feedback) — sổ "ai quyết gì"; field `decided_by` của bước = người chốt.
- Đếm phiếu Đạt theo cùng `output_id` (cùng vòng duyệt) ⇒ vòng trước (sau Trả lại làm lại) không tính.
- Đồng thời: khoá `process_runs FOR UPDATE` (đường cổng kiểm sẵn có) TRƯỚC khi đếm ⇒ người sau thấy phiếu đã COMMIT; đóng thẻ compare-and-set ⇒ thẻ đã đóng ⇒ 409 `REVIEW_TASK_CLOSED` (gửi lại an toàn).
- Thẻ nhóm khác đóng `superseded` + lý do «Đã có người từ chối/trả lại» (Từ chối/Trả lại) hoặc «Đã đủ người duyệt» (đủ luật).
- Nhắc / chuyển cấp: mỗi thẻ chép cấu hình `after.remind_every_h`/`escalate` từ snapshot ⇒ áp riêng từng nhóm.
- Trùng nhóm / `min` > số nhóm / `parallel` ở bước không phải Duyệt ⇒ `PARALLEL_RULE_INVALID`; < 2 nhóm ⇒ `PARALLEL_GROUPS_MIN2`.
- Cần đổi index `review_tasks_open_uq` (một thẻ mở mỗi stage) ⇒ migration 0128 (brief ghi không migration; không có cách khác).

## Cấu hình cho lát UI (hình dạng chốt)
Stage Duyệt (`executor.kind = "approve"`), trong `after` (kind `review`):
```json
"parallel": {
  "groups": [
    { "group_key": "truong-bo-phan", "label": "Trưởng bộ phận" },
    { "group_key": "tai-chinh", "label": "Tài chính" }
  ],
  "rule": "all"
}
```
- `groups`: 2–5 phần tử; mẫu Thư viện dùng `group_key`, bản công ty dùng `group_id` (uuid; `null` = mã chưa khớp nhóm, admin chọn lại). `label` 1–80 ký tự (nhãn nghiệp vụ hiện trên thẻ).
- `rule`: `"all"` (mọi nhóm) · `"any"` (một nhóm) · `{ "min": n }` (n nhóm, 1 ≤ n ≤ số nhóm).
- Vắng `parallel` = bước Duyệt một nhóm như cũ (`group_id`/`group_key`). Lỗi lưu: `PARALLEL_GROUPS_MIN2` (path `stages.<i>.after.parallel.groups`), `PARALLEL_RULE_INVALID` (path `….parallel.rule` hoặc `….parallel`); câu ở `process.admin.parallel.err.<MÃ>`.
- Cổng sổ module: `APPROVE_CONFIG_PORT` (`@ai/contracts/modules`) = `{ parallel?: ApproveParallel }`, widget `parallel: "department"`.
- Thẻ người xem (`stepsView`): bước hiện thẻ MỞ của nhóm người xem; người đã Đạt thấy bước còn mở, `can_act: false` (chờ nhóm khác).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/duyet-cung-luc.md
#### Yêu cầu: Duyệt cùng lúc nhiều nhóm («A + B cùng duyệt»)
Bước Duyệt có `after.parallel` mở thẻ duyệt cho mọi nhóm cùng lúc; bước Đạt khi đủ luật (`all` / `any` / `{min:n}`); Từ chối hoặc Trả lại của bất kỳ nhóm nào thắng ngay và đóng thẻ còn lại kèm lý do; hai người quyết cùng lúc chỉ chuyển bước một lần.
- Kịch bản: khi lượt tới bước cùng duyệt thì mỗi nhóm thấy đúng thẻ của mình ở thẻ HĐ và «Chờ tôi duyệt» [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » mở thẻ cho mọi nhóm cùng lúc — mỗi nhóm thấy và quyết được thẻ CỦA MÌNH (thẻ HĐ + Chờ tôi duyệt)]
- Kịch bản: khi luật `all` và A Đạt thì bước còn chờ B; B Đạt thì bước Đạt [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » all: A Đạt ⇒ bước còn chờ B (A không còn quyết) — B Đạt ⇒ bước Đạt, lượt xong]
- Kịch bản: khi A Đạt rồi B Từ chối thì bước Từ chối [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » all: A Đạt, B Từ chối ⇒ bước Từ chối (lượt huỷ), không chạy Kết thúc · Đã duyệt]
- Kịch bản: khi luật `any` và một nhóm Đạt thì bước Đạt, thẻ nhóm kia đóng [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » any: một nhóm Đạt ⇒ bước Đạt ngay — thẻ nhóm kia đóng với lý do]
- Kịch bản: khi luật `{min:2}` của 3 nhóm thì cần 2 phiếu Đạt [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » min 2/3: A Đạt ⇒ chờ — B Đạt ⇒ Đạt — thẻ C đóng]
- Kịch bản: khi một nhóm Từ chối thì thẻ còn mở đóng «Đã có người từ chối/trả lại» [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » min 2/3: A Đạt, B Từ chối ⇒ Từ chối ngay — thẻ C đóng «Đã có người từ chối/trả lại»]
- Kịch bản: khi một nhóm Trả lại thì lượt tới bước Trả lại [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » Trả lại (một nhóm) ⇒ tới bước Trả lại — thẻ nhóm kia đóng với lý do]
- Kịch bản: khi hai người quyết cùng lúc thì bước chuyển một lần [test: apps/hub-api/src/modules/processes/gates/parallel-approve.int.test.ts » hai người quyết CÙNG LÚC (any) ⇒ một người thắng, bước chuyển MỘT lần]
- Kịch bản: khi lưu quy trình có cùng duyệt sai (< 2 nhóm, `min` vượt số nhóm, trùng nhóm) thì báo mã lỗi có đường dẫn [test: apps/hub-api/src/modules/processes/gates/parallel-approve.test.ts » parallelStageIssues: < 2 nhóm ⇒ MIN2 — min > số nhóm / trùng nhóm / không phải Duyệt ⇒ RULE_INVALID]
- Kịch bản: khi mẫu Thư viện có cùng duyệt thì mỗi mã nhóm là nhóm cần có và được gắn id khi gán/sao chép [test: apps/hub-api/src/modules/processes/gates/parallel-approve.test.ts » mã nhóm của `parallel`: cần có (mẫu) và gắn id khi mở lượt / sao chép]

## Việc còn lại
- Lát UI (Sonnet): panel chọn nhóm + luật trên bước Duyệt; thẻ hiện "đang chờ nhóm khác" / ai đã duyệt.
- e2e hành trình (journey-approval) cho mua hàng hàng 3/6/10 — chạy một lần cuối đợt.
- Số migration 0128 chưa được giao trước: kiểm trùng với lát song song khi gộp.
