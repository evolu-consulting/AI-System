---
id: tool-merge-abort
lát: tool-merge-abort
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED docs/current/platform/merge-abort.md
#### Yêu cầu: slice:merge huỷ rebase khi conflict code thật
Khi rebase dừng vì conflict ngoài tests/.lock và baseline, `slice:merge` chạy `git rebase --abort` (worktree về commit cuối của lát), in danh sách file xung đột cùng các commit upstream đã sửa chúng, rồi thoát khác 0 với «xung đột code — gửi lại agent của lát». Trường hợp chỉ conflict baseline vẫn tự giải.
- Kịch bản: khi có conflict code thật thì rebase --abort và báo file cùng commit upstream [test: tools/scripts/src/baseline.rules.test.ts » rebase --abort chạy, báo file và commit upstream]
- Kịch bản: khi chỉ conflict baseline thì tự giải, không abort [test: tools/scripts/src/baseline.rules.test.ts » baseline-only vẫn tự giải, không abort]

## Việc còn lại
Không.
