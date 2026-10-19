# Readiness · N2-engine-ext

## Vòng 1 (2026-10-19) — NOT READY → áp mặc định (Luật 1b: Cao có mặc định ⇒ áp luôn, không vòng 2)
Không lỗ hổng Chặn. Kiểm: spec/plan/tasks, intake câu 4/5/8, ket-luan P-d2/N1, code gates/tool-stage/start/mcp.

| # | Mức | Vấn đề | Đã áp |
|---|---|---|---|
| 1 | Cao | Từ chối ⇒ run `cancelled`, gói không biết kết quả | N2-D08: `PackRuns.outcomes(u, runIds)` — 1 câu `= any($ids)` trả `{run_id, status, rejected, feedback}`; AC trong `pack-run.int` |
| 2 | Cao | `PROCESS_ENGINE_OFF` chưa có trong contract | thêm `PROCESS_ENGINE_OFF: 503` vào `chat/processes-errors.ts` |
| 3 | Cao | Seam `runsPerTenant` luôn có giá trị ⇒ trần tenant vô hiệu | mount: `runsPerTenant: m.processRunsPerTenant` (kiểu `number \| undefined`); trần = `seam ?? cột ?? 5` |
| 4 | Cao | UI đổi mà thiếu e2e (Luật 4b) | T8 thêm e2e admin-web (sửa trần, checkbox `exclude_starter`) |
| 5 | Trung | Body route pkdemo `/run` | `{process_key, input, inputs?}` (= `CreateProcessRunRequest` bỏ `origin`), sai ⇒ 400 |
| 6 | Trung | Item đã có run vẫn mở run | kiểm `run_id is null` trong tx gói TRƯỚC start ⇒ 409 `CONFLICT`; run chưa kick (crash) do vòng `sweepOnce`/`requeueOrphans` P-d nhặt |
| 7 | Trung | Nguồn cache "gói bật" | dùng `packAccessInput` (ConfigCache N1, làm mới qua NOTIFY `config_changed`) |
| 8 | Trung | Group duyệt chỉ có người bắt đầu ⇒ kẹt | N2-D09: không chặn lúc lưu; dựa vào chuyển cấp/nhắc hiện có |
| 9 | Thấp | AC09 thiếu điều kiện quyền `read` gói | thêm vào AC09 |
| 10 | Thấp | perf riêng | chấp nhận (0 câu thêm); `capOf` = 1 câu |

Kết quả sau áp: READY (tự duyệt theo Luật 2b — không câu hỏi mới, không ADR thư viện).
