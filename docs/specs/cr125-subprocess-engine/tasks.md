---
id: cr125-subprocess-engine
lát: cr125-subprocess-engine
cr: CR-125
làn: đầy đủ (máy trạng thái run + migration)
migration: 0129_subprocess_parent
phụ thuộc: cr125-subprocess-ui (editor/canvas, song song)
---
## Plan (ngắn)
Node `core.subprocess` «Quy trình con» (kind base, executor `subprocess`): bước mở MỘT lượt con (quy trình công ty / Thư viện cùng công ty),
chờ (không poll) tới khi lượt con kết thúc, rồi đi theo đầu ra done / rejected / cancelled kèm dữ liệu cuối của lượt con.

## Làm
- Contract: `hub-admin/process-subprocess.ts` (executor `{kind, def_key, input_map?, branches?}`, mã lỗi), union executor, `EXECUTOR_KINDS`,
  `NODE_FAMILY_OF` (control), `NODE_PRODUCES` (declared), `NODE_EXECUTORS`; node `modules/core/subprocess/node.ts` (configPort zod, exits).
- Migration 0129: `process_runs.parent_run_id/parent_stage_run_id/parent_attempt/parent_round` + unique một phần + trigger
  `subprocess_settled` (lượt con kết thúc ⇒ hẹn `wait_until` tới hạn ngay cho stage cha đang chờ).
- Hub: `nodes/subprocess/*` (launch, settle, repo, def), `finishWait` nhánh subprocess, rẽ `branches` theo field `outcome`, huỷ cha ⇒ huỷ con
  (`gates/cancel-children.ts`), `KickResult.kicks` (kick lượt con sau COMMIT), guard lưu def `defs/subprocess-check.ts`.
- i18n `process.admin.apiError.SUBPROCESS_*`, `check:error-codes` thêm bộ `hub-admin-subprocess`. admin-web: mục FE_NODES CHỈ cho typecheck.

## Không làm / Chạm
UI/canvas/e2e (lát cr125-subprocess-ui). Lượt cha hết hạn / lỗi hệ thống không lan sang con (chỉ «Dừng» lan). Guard chạy ở lưu def công ty
(create/update), xuất bản/rollback Thư viện, bản riêng công ty.

## Test tối thiểu
- unit `domain/runs/subprocess.rules.test.ts`; int `nodes/subprocess/subprocess.int.test.ts` (evotest -Dirty).

## Quyết định trong lúc làm
- Chờ = stage `waiting_timer` + MỘT hẹn canh 10 phút (lưới an toàn: con bị xoá ⇒ `cancelled` + `reason: child_missing`; con còn chạy ⇒ hẹn canh kế). Đường nhanh: trigger SECURITY DEFINER kéo hẹn canh về now (UPDATE `SKIP LOCKED`, không khoá hàng cha ⇒ không deadlock với huỷ cha khoá cha → con).
- Guard chung `subprocessCheck`: lưu def công ty, xuất bản / rollback Thư viện, bản riêng công ty.
- Lượt cha hết hạn ⇒ huỷ lượt con (`expire.ts`, cùng `cancelChildren` với «Dừng»).
- Dữ liệu lượt con lộ dưới khoá `sub_<trường>` (không `sub.<trường>`: `FIELD_KEY_RE` không nhận dấu chấm, node Nếu / bước sau phải đọc được).
- `executor.branches[{on: rejected|cancelled, goto_step}]` như `wait_event` (canvas ghi đầu ra có `on`); done = bước kế.
- `input_map` giá trị = id nguồn `autoMapInputs`: `<khoá>` (đầu vào lượt) hoặc `<mã bước>:<trường>`.
- Rejected = lượt con xong ở Kết thúc có outcome chứa reject/declin/refus, hoặc không Kết thúc mà Duyệt cuối = rejected.
- Lượt con lỗi / hết hạn / không mở được / lồng ≥ 3 lúc chạy ⇒ bước cha «Cần xử lý» `tool_failed`; Thử lại = attempt mới ⇒ lượt con mới.
- Lượt con không tính trần lượt/công ty (`packBound`), cùng người bắt đầu với cha.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Node «Quy trình con» chạy một quy trình khác như một bước
Bước `subprocess` mở đúng một lượt con cùng công ty khi tới lượt, chờ lượt con kết thúc rồi đi theo kết quả; output bước có `outcome` và
dữ liệu cuối của lượt con dưới khoá `sub_<trường>`.
- Kịch bản: khi lượt con xong bình thường thì bước cha đi đầu ra `done` với `sub_*`, lượt cha chạy tiếp tới Kết thúc [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » mở MỘT lượt con ⇒ con xong ⇒ cha đi tiếp `done` với dữ liệu `sub_*`, lượt cha xong]
- Kịch bản: khi lượt con kết thúc Từ chối thì bước cha rẽ đầu ra `rejected` [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » con kết thúc Từ chối ⇒ cha rẽ đầu ra `rejected` (bước 2)]
- Kịch bản: khi kick lại hoặc stage về hàng đợi cùng lần chạy thì không mở lượt con thứ hai [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » kick lại / stage về hàng đợi cùng lần chạy ⇒ không mở lượt con thứ hai]
- Kịch bản: khi người dùng dừng lượt cha thì lượt con còn chạy bị huỷ [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » huỷ lượt cha ⇒ lượt con còn chạy bị huỷ, không hẹn mở nào cho cha]
- Kịch bản: khi lượt con lỗi thì bước cha «Cần xử lý» như tool lỗi [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lượt con lỗi ⇒ bước cha «Cần xử lý» (tool_failed)]
- Kịch bản: khi huỷ cha đồng thời lượt con kết thúc thì không lỗi, không chờ khoá, trạng thái nhất quán [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » huỷ cha ĐỒNG THỜI lượt con kết thúc (hai thứ tự khoá) ⇒ không lỗi, không chờ khoá, trạng thái nhất quán]
- Kịch bản: khi lượt cha hết hạn thì lượt con bị huỷ [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lượt cha hết hạn ⇒ lượt con còn chạy bị huỷ]
- Kịch bản: khi lượt con không còn thì cha đi đầu ra cancelled [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lượt con không còn (bị xoá / gỡ liên kết) ⇒ hẹn canh chốt cha đầu ra `cancelled` + reason]
- Kịch bản: khi hẹn canh tới lúc con còn chạy thì chờ tiếp và chỉ chốt một lần [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » hẹn canh tới khi con còn chạy ⇒ ghi hẹn canh kế, con xong ⇒ chốt MỘT lần (hẹn thừa bị bỏ)]
#### Yêu cầu: Lưu quy trình có «Quy trình con» được kiểm
Lưu def có bước `subprocess` trỏ quy trình không có / chưa xuất bản ⇒ 422 `SUBPROCESS_NOT_FOUND`; gọi vòng ⇒ `SUBPROCESS_CYCLE`; lồng quá 3 ⇒
`SUBPROCESS_DEPTH`.
- Kịch bản: khi trỏ quy trình không có thì bị chặn [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » quy trình không có ⇒ SUBPROCESS_NOT_FOUND, có ⇒ ok]
- Kịch bản: khi A gọi B mà B gọi A thì bị chặn [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » gọi vòng A → B → A ⇒ SUBPROCESS_CYCLE (kể cả tự gọi chính mình)]
- Kịch bản: khi lồng quá 3 tầng thì bị chặn [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lồng quá 3 tầng ⇒ SUBPROCESS_DEPTH, đúng 3 ⇒ ok]

## Việc còn lại
- Lượt cha `failed` (lỗi hệ thống) chưa lan sang con.
