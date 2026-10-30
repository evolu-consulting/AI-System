---
id: fnr-if
lát: fnr-if
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-registry (R1) cho đợt B
---
## Plan (ngắn)
Hai đợt, cả hai xong. **A (không đụng lõi engine)**: contract `process-if.ts`, luật thuần `domain/if/if.rules.ts`, FE `StageIf` +
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

## Đợt B (xong)
- Contract: `IfExecutorSchema` vào union `executor` (`processes.ts`), `IF_INVALID` (`PROCESS_DEF_RULES`), `if` ở `EXECUTOR_KINDS`/`NODE_FAMILY_OF` (control)/`NODE_PRODUCES` (none), `ifStageIssues` (FE live, parity với domain). `WaitUntilExecutorSchema` tách sang `process-wait.ts` để `processes.ts` ≤ 400 dòng.
- BE: `nodes/if/{node,launch}.ts` đăng ký registry; `defs/if-stage.map.ts` (mapper contract → domain, dùng chung node + parity test); `defs/if-def-parity.test.ts`; `StepRepo.ifFacts` (1 câu: fields output + input run, `adapters/runs/if-facts.repo.ts`); `settleStep` đánh giá node If trong nhánh rẽ nhánh hiện có (luật 1 = Đúng, luật 2 = Sai có else; Sai không else ⇒ bước kế).
- FE: `if` trong FE registry, `StageDraft.ifx`, `stage-convert`/`d2-validate`/`error-keys`, `StageForm` render `StageIfForm`, canvas `IfNode` (loại node `if`) + cạnh `BranchEdge` nhãn Đúng/Sai (handle `yes`/`no`). Không thêm bộ chọn loại node (R3 dựng từ FE registry).
- Test: `tests/acceptance/P-d/d2/if.int.test.ts` (Đúng / Sai+else / Sai không else / nguồn input + or / if lồng); `test:int:par` processes + P-d/d2 xanh (gồm `branch.int.test.ts` = snapshot `after.branch` cũ); seed showcase dry-run hợp lệ.
- Quyết định đợt B: stage If chốt `done` ở `nodes/if/launch.ts` (không output, không KH summary) rồi `settleStepTx`; kick bước đích nhờ `more: true`. Chuỗi If liên tiếp > 3 trong một lần kick cần thêm kick (vòng `kickOnce` giới hạn `PROCESS_STEP_STAGES_MAX + 1`). Hub ép template/mục/answerer của stage If khi lưu (không nới `output.template min(1)` của schema). Input kiểu `text` đọc từ `inputs[].text`, kiểu khác từ `value`.
## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

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