---
id: tool-depcruise-exit
lát: tool-depcruise-exit
cr:
làn: nhanh
migration: không
phụ thuộc: tool-baseline-merge
---
## Plan (ngắn)
Tái hiện ở checkout chính: `bun run depcruise` thoát 1 vì có 2 vi phạm `no-circular` thật (launcher-batch/launcher, flow-submit/approval, approval-flow/approval-engine.ports), chưa nằm baseline; dòng "stale" chỉ là dòng cuối bị nhầm. Khi chỉ có stale, lát trước đã cho exit 0. Lát này thêm dòng nêu rõ nguyên nhân khi đỏ, và sửa `slice:rm` khi thư mục thừa không còn là worktree.

## Làm
- `slice-rm.rules.ts` (`failNote`, `isNotWorktreeError`), `depcruise.ts` in `failNote`, `slice.ts rm` bỏ qua lỗi "is not a working tree" rồi xoá thư mục.

## Không làm / Chạm
Không sửa/nới baseline cho 3 vòng import thật (cần lát sửa riêng).

## Test tối thiểu
Unit `slice-rm.rules.test.ts`.

## Quyết định trong lúc làm
Nguyên nhân `slice:rm` lỗi: worktree đã gỡ/prune nhưng thư mục thừa còn, `git worktree remove` báo "is not a working tree" và `rm` dừng trước khi xoá thư mục.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/platform/tool-depcruise-exit.md
#### Yêu cầu: slice:rm dọn thư mục thừa
Thư mục lát không còn là worktree thì `slice:rm` vẫn xoá thư mục và nhánh; lỗi khác (có thay đổi chưa commit) vẫn dừng.
- Kịch bản: khi git báo không phải working tree thì tiếp tục xoá [test: tools/scripts/src/slice-rm.rules.test.ts » thư mục không còn là worktree thì bỏ qua lỗi và xoá thư mục]

#### Yêu cầu: depcruise nêu rõ nguyên nhân đỏ
Khi đỏ vì vi phạm thật, dòng cuối nói rõ không phải do cảnh báo stale; chỉ stale thì xanh.
- Kịch bản: khi có vi phạm thật thì nêu số lỗi thật [test: tools/scripts/src/slice-rm.rules.test.ts » vi phạm thật thì nêu rõ nguyên nhân, không phải stale]
- Kịch bản: khi chỉ có stale thì xanh [test: tools/scripts/src/slice-rm.rules.test.ts » chỉ stale thì xanh và không có lời nhắn đỏ]

## Việc còn lại
Ba vòng import `no-circular` ở hub-api (launcher, flow-submit/approval, approval-flow/approval-engine.ports) cần lát sửa hoặc baseline.
