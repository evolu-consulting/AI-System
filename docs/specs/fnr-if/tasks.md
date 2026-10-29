---
id: fnr-if
lát: fnr-if
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-registry (R1) cho đợt B
---
## Plan (ngắn)
Hai đợt. **A (xong, không đụng lõi engine)**: contract `process-if.ts`, luật thuần `domain/if/if.rules.ts`, FE `StageIf` +
`IfNode` + helper `lib/if-form.ts` + i18n. **B (sau khi R1 gộp)**: nối vào union `executor`, `nodes/if`, def validate, StageForm,
canvas, 1 int. Spec: `docs/specs/flow-node-registry/design.md` §3.

## Làm
Đợt A:
- `packages/contracts/src/hub-admin/process-if.ts` (+ export ở `hub-admin/index.ts`): `CondSchema`, `WhenSchema`, `IfExecutorSchema`, hằng giới hạn.
- `apps/hub-api/src/modules/processes/domain/if/if.rules.ts`: `evaluateWhen`, `ifTarget`, `ifDefIssues` (rule `IF_INVALID`); export `compare` ở `branch.rules.ts` để dùng chung ngữ nghĩa so sánh.
- FE: `components/editor/StageIf.tsx`, `components/canvas/IfNode.tsx`, `lib/if-form.ts`; i18n `process.admin.editor.stage.if.*`, `process.admin.canvas.if.*` (vi/en).

## Không làm / Chạm
Không chạm `runs/`, `defs/def.rules.ts`, `defs/defs.service.ts`, `nodes/`, `application/ports.ts`, `modules/kh/`, `stage-convert.ts`;
chưa thêm `if` vào union executor (R1 đang refactor). StageForm/ProcessCanvas chưa nối.

## Test tối thiểu
Đợt A: `domain/if/if.rules.test.ts` (22 ca), `lib/if-form.test.ts` (5 ca), tsc 3 gói, biome. Đợt B: 1 int (Đúng / Sai / bỏ qua bước / if lồng).

## Quyết định trong lúc làm
- Domain tự khai kiểu (`IfExec`, camelCase `thenStep`/`elseStep`), không import contract (ADR-0023); mapper contract → domain ở đợt B.
- `compare` của rẽ nhánh được export và dùng lại (không copy) ⇒ ngữ nghĩa so sánh y hệt `after.branch`.
- Đích có `real_action` (PD2-R12): vì If là `auto` nên bước NGAY TRƯỚC đích phải toàn gate `review` (và không phải If); nhảy thẳng tới bước kế liền sau If mà bước đó `real_action` ⇒ `IF_INVALID`. Áp cho cả `else_step = null` (đích ngầm = bước kế).
- Nguồn `field` phải là stage ở bước nhỏ hơn (không bắt buộc đúng bước liền trước) với field khai báo; nguồn `input` phải khai báo trong def, kiểu `select`/khác ⇒ so như chuỗi.
- `ifTarget` kẹp đích vào `stepCount` (≥ ⇒ run xong) và đích không hợp lệ rơi về bước kế; engine vẫn dựa `ifDefIssues` lúc lưu.
- Path lỗi: `stages.i.executor` (đứng một mình / auto / real_action), `.when.conds`, `.when.conds.j.{from,op,value}`, `.then_step`, `.else_step`.
- FE nháp dùng `yes`/`no` (không dùng `then`/`else` vì biome `noThenProperty`); bước đếm từ 1 như `BranchDraft`; nguồn mã hoá `field|<stage>|<field>` / `input|<key>`.

## Việc đợt B (sau R1)
1. `packages/contracts/src/hub-admin/processes.ts`: thêm `IfExecutorSchema` vào union `executor`; cho phép `output.template/fields` rỗng khi `kind = if`; thêm `IF_INVALID` vào mã lỗi def; mở rộng `process-steps`/path nếu cần.
2. `apps/hub-api/.../processes/nodes/if/` (module node đăng ký `registry.ts`): `launch` (đọc fields stage nguồn + input run trong tx, `evaluateWhen`, chốt stage `done` + lý do, nhảy bằng `skippedStages`/`effectivePrevStep`/`ifTarget`) + `validate` gọi `ifDefIssues`.
3. `defs/def.rules.ts` + `defs/defs.service.ts`: map stage If → `IfStageShape`, gọi `ifDefIssues(stages, inputs)`; mapper contract (snake_case) → domain; thêm `if-def-parity.test.ts` (contract schema ≡ domain).
4. `runs/` (launcher): nhánh stage `executor.kind = "if"` qua registry; run theo snapshot cũ `after.branch` giữ nguyên.
5. `apps/admin-web/.../lib/stage-convert.ts` (draft ⇄ contract, `ifToDraft`/`draftToIf`), `lib/draft-types.ts` (StageDraft có `if`), `lib/error-keys`/`domain/error-keys.ts` (map `IF_INVALID` → `process.admin.editor.stage.if.err.IF_INVALID`), `StageForm.tsx` (render `StageIf` khi kind = if, nguồn từ `condSources`, bước từ `gotoSteps`), `ProcessCanvas.tsx`/`canvas-layout.ts`/`canvas-edges.ts` (đăng ký `IfNode`, cạnh `BranchEdge` từ handle `yes`/`no`), chọn loại node "Nếu" trong editor.
6. 1 int (Đúng / Sai có else / Sai không else / if lồng / snapshot cũ `after.branch`) + test registry "kind ↔ registry".

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Node If
Node `if` (họ control) đứng riêng một bước, chạy tức thì, xét AND/OR trên field output của stage bước trước và input của run.
- Kịch bản: khi điều kiện `and` đều đúng thì run nhảy tới `then_step`, các bước giữa bị bỏ qua
- Kịch bản: khi điều kiện sai và có `else_step` thì run nhảy tới bước else
- Kịch bản: khi điều kiện sai và không có `else_step` thì run sang bước kế
- Kịch bản: khi hai node If nối tiếp thì run đi đúng nhánh của cả hai (if lồng)
- Kịch bản: khi run chạy theo snapshot cũ có `after.branch` thì kết quả rẽ nhánh như trước

## Việc còn lại
Đợt B (xem trên) sau khi `fnr-registry` gộp.