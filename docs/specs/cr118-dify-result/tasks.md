---
id: cr118-dify-result
lát: cr118-dify-result
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Prod e2e 13 đỏ (UPSTREAM_ERROR): job 269bca80 `succeeded` nhưng `jobs.result.result.text = null`; Hub `JobOutputSchema` (zod strict, `text` optional, không nullable) từ chối ⇒ `invalid result`. Nguyên nhân: agent-runtime `build_output` dùng `model_dump(mode="json")` ⇒ trường tuỳ chọn `text=None` của `AgentResult3` (dlc-dify, e0c91e78) bị ghi `null`.

## Làm
`runtimes/cli/result.py`: `model_dump(..., exclude_none=True)` (2 chỗ). Test `test_result.py` tái hiện đúng hình kết quả prod.

## Không làm / Chạm
Không đổi contract Hub (giữ `text` optional); không đụng Dify/DLC.

## Test tối thiểu
`run-tests.ps1 -Step py -Dirty -Filter src/agent_runtime/runtimes/cli`.

## Quyết định trong lúc làm
Sửa phía runtime (nơi sinh `null`), không nới zod `.nullish()` — contract hẹp hơn là có chủ ý.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: sửa lỗi runtime ghi `text: null` vào kết quả need_input, khớp contract JobOutput hiện có).

## Việc còn lại
Deploy runtime + chạy lại e2e/deployed/13.