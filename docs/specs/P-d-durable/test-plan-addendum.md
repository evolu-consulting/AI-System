# Test plan · P-d · phụ lục bổ sung (readiness lần 2 · qc) — của [test-plan.md](test-plan.md) §6

`test-plan.md` sát trần 30 720 B nên phần thêm nằm ở đây.

## 1. Test khoá phải SỬA — K30
| # | File:dòng | Lý do | Sửa thành | Khi |
|---|---|---|---|---|
| K30 | `P-a/step0/rules/run-access.test.ts` | T8s dời `core/run-access.rules.ts` ⇒ `domain/runs/run-access.rules.ts` (plan-domain §7); file mới import contract ⇒ khai lại hằng trong domain (ADR-0023, CA-R03) | nạp bằng `loadDomain("runs/run-access.rules.ts")` (hoặc `loadAnyOf` nếu T8s/T8q lệch pha); ca cũ giữ nguyên ý định và dữ liệu; hằng khai lại được đối chiếu hằng contract ở `rules/domain-contract.test.ts` (PD-C10) | T8q (cùng task dời, relock) |
Kiểm ở bước 8 của test-plan §8: `bun test tests/acceptance/P-a/step0/rules/run-access.test.ts` xanh trước và sau T8s; `bun run test:lock:verify` sau relock. spec-ac §2 trỏ test-plan §6 (K01–K30).

K30 khớp T8s: docs-architect chốt `run-access.rules.ts` dời **toàn file** ở T8s (plan-addendum A6, 67 dòng) ⇒ K30 sửa ở T8q cùng task dời (không phải T9q).

## 1b. Rà A6 — đường dẫn test khoá (kết quả grep `tests/acceptance`, 2026-10-17)
Không thêm K31: mọi test khoá bị A6 chạm đã có K19–K26, K30. Đối chiếu:
| Test khoá | Nạp hiện tại | Sau A6 | Số K |
|---|---|---|---|
| `P-c/rules/autofix-rules.test.ts:21` (dùng ở `:109`, `decisionOptionsFor`) | `loadProcRules("core/task.rules.ts")` | `domain/tasks/decision.rules.ts` (T8s) | K21 (giữ) |
| `P-c2/rules/_rules2.ts:25` (`loadCoreTask`, chỉ dùng ở `apply-rules.test.ts:259` `decisionOptionsFor`) | ″ | ″ | K22 (giữ) |
| `P-a/step0/rules/task.test.ts:43` (`loadCoreRules("task")`, một hàm nạp cho cả file) | `core/task.rules.ts` | tách 3 nơi: `canAct` ⇒ `domain/tasks/task-access.rules.ts`, `decisionAssignees` ⇒ `domain/tasks/decision.rules.ts`, `askExcerpt` ⇒ `core/task.rules.ts` (giữ, Luật 4) | K20 (giữ) |
| `P-a/step0/rules/run-access.test.ts:21` | `loadCoreRules("run-access")` | `domain/runs/run-access.rules.ts` | K30 |
| autofix `runs/autofix.rules.ts` (PC-R10, PD-U92, `loadAutofix`) | không dời, không sửa (A6) | **không đổi** | — |
Ghi chú: `_rules2.ts:25` chỉ đổi đích loader; `loadAutofix` ở dòng 23 không đổi. Parity `isAutofixReason` (domain ↔ `runs/autofix.rules`) do backend-lead (mapper test A6), qc chỉ rà tồn tại ở PD-C12.

## 2. Ca thêm ở phụ lục khác
- PD-C13 (mới, contract/mapper, lớp 3): `P/adapters/defs/def-rules-parity.test.ts` — backend-lead viết cạnh code (plan-addendum A2), qc **rà** như PD-C12: bộ def mẫu ≥ 1 ca mỗi hàng bảng path A2 (`WAIT_INVALID` ×4 path, `TOOL_INVALID` ×2 path, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID` ×5 path) chạy qua hàm contract (snake_case) và hàm domain (sau mapper): hàng `TOOL`/`BRANCH` qua `toolStageIssues`/`branchStageIssues`; hàng `WAIT` (×4 path) qua `processDefStageIssues(stages,{inputs})` so với domain `waitStageIssues` (không qua tool/branch) ⇒ `toEqual` (path + rule, thứ tự `i` tăng). Kiểm tồn tại + xanh ở VERIFY; không thuộc lock qc.
- qc không viết trùng parity ở `tests/acceptance`; hai nơi được test độc lập: contract hàm FE ở PD-C14 (`rules/contracts-pd1`: gọi `toolStageIssues`/`branchStageIssues` với 1 ca hợp lệ ⇒ `[]` và 1 ca/hàng path A2 ⇒ path đúng) và PD-C15 (`rules/contracts-pd1`, hàng WAIT: `processDefStageIssues(stages,{inputs})` 1 ca/path: `stages.<i>.after` ⇒ `WAIT_INVALID`; `stages.<i>.executor.from`; `stages.<i>.executor.offset_days`; `stages.<i>.executor.time`, mỗi ca đúng path + rule; 1 ca hợp lệ ⇒ `[]`); domain ở PD-U59…U61b, PD2-U01…U03, PD2-U10/U11.
- Q4/Q6/Q9/Q10/Q-D2-1/Q-D2-2 đã trả lời (plan-addendum A7): PD-I75…I77 (`publish` giả), PD-U04b, PD-I01/I02/I60, PD2-U09, PD2-I06/I06b.
- `teamResumePlan`: PD-U93…U98 trong [test-plan-rules](test-plan-rules.md) (đầu vào có `cursor`; theo A5; đã đếm vào test-plan §9).
- PD-I47 (`ESCALATE_INVALID` 422 chỉ khi trùng Group duyệt; `escalate` ở stage `auto` và `after_h` sai qua API ⇒ 400 `VALIDATION_ERROR`): [test-plan-int](test-plan-int.md).
- e2e: [test-plan-e2e](test-plan-e2e.md) viết lại theo `plan-frontend.md` §7, `plan-frontend-d2.md` §13, `plan-frontend-i18n.md`.

## 2. Hiệu năng vòng nền + nhắc nhiều Hub (CR-093, A9, A10, #190)
| # | Test | Loại | Đạt khi |
|---|---|---|---|
| PD-P10 | nhắc 2 Hub song song, 250 task tới hạn | int | đúng 250 lượt nhắc, notice = 250 × người nhận (không trùng — #190) |
| PD-P11 | một lượt vòng nhắc với 250 task tới hạn | int | một lượt nhắc đủ 250 (xả nhiều lô — A9) |
| PD-P12 | hết hạn 250 run (đồng hồ giả +ttl) | int | 250 `expired`, task `closed/expired`, mỗi run đúng một sự kiện `run_end`; không gọi `postThread` trong vòng (đếm qua stub) |
| PD-P13 | lô nhắc 100 | perf (`test:perf`) | p95 ≤ 50 ms qua 20 lô; 10.000 task ≤ 6 s |
| PD-P14 | lô hết hạn 100 | perf | p95 ≤ 50 ms qua 20 lô; 20.000 run ≤ 12 s |
| PD-P15 | đếm truy vấn mỗi lô | int | nhắc ≤ 6 câu SQL/lô, hết hạn ≤ 6 câu/lô, không phụ thuộc số hàng (bọc `tx.execute` đếm) |
Đồng hồ giả (`d.now`), không chờ thời gian thật. Bài 10.000 chỉ trong `test:perf`, không trong `test:int`.