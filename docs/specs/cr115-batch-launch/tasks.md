---
id: cr115-batch-launch
lát: cr115-batch-launch
cr: CR-115
làn: đầy đủ (máy trạng thái run, đồng thời, đường nóng có ngưỡng perf)
migration: chưa (dự kiến hub 0086 nếu cần)
phụ thuộc: hub-ha-sweeps (CR-114)
---
## Plan (ngắn)
Mục tiêu CR-115: PD-P01 bắn 100 hẹn retry p50 ≤ 500 ms (hiện 1.490–1.690 ms trên evotest), exactly-once 2 Hub (PD-P02).

## Trạng thái: CHẶN (hard stop Luật 2 — phạm vi mở khoá không đủ), chưa sửa code

Số đo (chẩn đoán CR-114, `debug` pool Hub, một lượt 100 hẹn, evotest): ~6.000–7.100 câu SQL / ~800–1.000 tx. Thời gian
gom theo câu (lượt 1 / lượt 2, ms):
| Nhóm | Câu chính | ms | Module |
|---|---|---|---|
| Điều khiển tx | `begin` + `set_config` scope + `commit` (×~800–1.000) | 570 / 600 | mọi module |
| Tạo hub run | `messages` insert, `flows` insert, `runs` insert, `conversations` update | ~190 / ~110 | `runs` (`runs.repo.ts` insertRun — đóng băng) |
| Phiên CLI | `delete from hub.cli_sessions` | 116 / 81 | `dify/agent`, `dlc-calls` (đóng băng) |
| Job | `jobs` insert, `run_steps` insert + advisory lock, `pg_notify`, savepoint, provider cooldown | ~170 / ~150 | `launcher-prompt.ts` (processes) + `lib/run-steps.ts`, `studio/models` (đóng băng) |
| Phần processes | khoá run, `stage_runs → running`, đọc đầu run (×2), phiên tươi, recipients | ~150 / ~120 | `processes/runs/*` (mở cho CR-115) |
| Poll cấu hình mỗi kick | `config_meta` admin + hub (×100 mỗi bảng) | 44 / 40 | `processes/runs/launcher.ts` |

Phần nằm trong module được mở (launcher + processes) chỉ ~15–20% thời gian lượt. Thử bắn song song 4 hẹn không nhanh hơn
(nút cổ chai là luồng JS × số câu) ⇒ muốn đạt 500 ms phải giảm SỐ CÂU + SỐ TX mỗi stage ~70%, tức gom theo lô cả
`insertRun` (runs), tạo job + `run_steps` (runner/lib) và dọn `cli_sessions` (dify agent) — ngoài phạm vi mở khoá
"chỉ đường launcher.kick theo lô". Làm riêng phần launcher (một lần poll cấu hình + đọc đầu run theo mảng mỗi lô, bớt
~600 câu) ước còn ~1.300 ms — không đạt mục tiêu.

## Cần người dùng chốt (một câu)
Mở khoá có giới hạn thêm `runs` (insertRun theo mảng), tạo job/`run_steps` của stage agent, và dọn `cli_sessions` cho đường
launch theo lô? Mặc định đề xuất: **có**, chỉ cho đường stage agent khởi chạy từ hẹn `retry` (đường chat/HTTP giữ nguyên), test
so sánh snapshot hàng `flows/runs/messages/jobs/run_steps` đường cũ ↔ đường lô trên cùng fixture + PD-P02 + PD-I24/I39,
lát Opus (≥ 1 ngày). Không ⇒ làm phần launcher (~-15%) và đặt ngưỡng PD-P01 theo số đo thật.

## Làm

## Không làm / Chạm
Notices/unread (lát cr115-unread-counter). Chưa sửa code, chưa ghi `docs/platform/modules.md` (chờ chốt phạm vi).

## Test tối thiểu
(chờ chốt) test trước: so sánh snapshot đường cũ ↔ lô, PD-P02 2 Hub, thứ tự/trạng thái stage.

## Quyết định trong lúc làm
- 2026-11-03: dừng trước khi code — số đo cho thấy mục tiêu không đạt được trong phạm vi mở khoá đã duyệt (Luật 2 hard stop).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát đang chặn, chưa sửa code).

## Việc còn lại
- Chờ người dùng chốt phạm vi mở khoá (mục trên).
