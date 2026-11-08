---
id: res-check
lát: res-check
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Công cụ dev `bun run res:check [--json] [--server] [--strict]`: đo CPU/RAM/đĩa/tiến trình nặng/worktree/làn e2e (local, một lần PowerShell) và máy chủ evotest (một lần ssh, chỉ lệnh đọc), rồi luật thuần cho ra khuyến nghị song song + cảnh báo. Tích hợp vào quy trình để điều phối không làm quá tải máy.

## Làm
- `tools/scripts/src/res-check.ts` (I/O + CLI), `res-check.parse.ts` (bộ phân tích PowerShell/ssh/worktree), `res-check.rules.ts` (luật thuần), `res-check.test.ts`.
- `slice:new` chạy kiểm local, từ chối khi đĩa < 15 GB hoặc RAM < 2 GB (`--force` bỏ qua).
- `deploy/evotest/run-tests.ps1` in tải máy chủ + slot bận, cảnh báo khi mọi slot bận.
- `e2e:lanes` in dòng nhắc `res:check`; docs/WORKFLOW.md mục mới; CLAUDE.md thêm một dòng lệnh + tham chiếu Luật 0c mục 1.

## Không làm / Chạm
Không đổi `e2e/*.spec.ts`, không đổi hành vi sản phẩm. `--strict` thoát 2 khi chạm giới hạn cứng; mặc định thoát 0.

## Test tối thiểu
Unit cho ngưỡng → khuyến nghị/cảnh báo/giới hạn cứng, phân loại tiến trình, bộ phân tích mẫu PowerShell/ssh/`git worktree list`.

## Quyết định trong lúc làm
- Tải CPU Windows = lõi × CPU% (Win32_Processor); nơi khác = loadavg 1 phút.
- "Worktree đã merge" = nhánh đã merge vào platform/gd0 + sạch + có commit riêng (reflog > 1); thư mục lạ trong `evolu-wt`/`.claude/worktrees` = mồ côi.
- Số slot evotest máy chủ = 4 (mặc định của `run-tests.ps1 -Slots`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ dev)

## Việc còn lại
