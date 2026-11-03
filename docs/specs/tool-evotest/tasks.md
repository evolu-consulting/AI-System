---
id: tool-evotest
lát: tool-evotest
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
1. evotest 4 → 8 slot mặc định (`run-tests.ps1 -Slots`, `boot.sh EVO_SLOTS`, `res-check.ts SERVER_SLOTS`); trần RAM mỗi slot hạ 11.5 → 9.25 GB (runner 5g, pg 4g, redis 256m) để 8 slot ≤ ~59% RAM máy chủ.
2. `slice:pool [--size N]` giữ N worktree ấm ở `evolu-wt/_pool/<n>`; `slice:new` lấy một cái rồi bổ sung nền.

## Làm
- `deploy/evotest/*`, `tools/scripts/src/slice.pool{,.rules,.test}.ts`, `slice.ts` (nối pool), `res-check.ts` (số slot + bỏ qua `_pool` khi đếm thư mục mồ côi), `package.json` (`slice:pool`), WORKFLOW.md.

## Không làm / Chạm
- Không đụng prod `sohoptac2`; `slice:rm`/`slice:merge` giữ nguyên.

## Test tối thiểu
- Unit: luật chọn/bổ sung/cổng đĩa của pool, parser 8 slot. Thật: 6 lượt evotest song song; `slice:new` có/không pool.

## Quyết định trong lúc làm
- Pool dùng dấu `<n>.ready` cạnh thư mục (không làm bẩn `git status` của worktree); `--size` được nhớ trong `_pool/size` để lần bổ sung nền sau `slice:new` dùng cùng cỡ.
- Hết pool hoặc `worktree move`/`checkout` lỗi ⇒ rơi về đường dựng cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ dev)

## Việc còn lại
Không.
