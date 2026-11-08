# Platform · slice:merge huỷ rebase khi conflict code

Cập nhật: 2026-11-09 · Gộp từ: tool-merge-abort (đợt cr125-wave).

## Yêu cầu: slice:merge huỷ rebase khi conflict code thật (nguồn: tool-merge-abort)
Khi rebase dừng vì conflict ngoài tests/.lock và baseline, `slice:merge` chạy `git rebase --abort` (worktree về commit cuối của lát), in danh sách file xung đột cùng các commit upstream đã sửa chúng, rồi thoát khác 0 với «xung đột code — gửi lại agent của lát». Trường hợp chỉ conflict baseline vẫn tự giải.
- Kịch bản: khi có conflict code thật thì rebase --abort và báo file cùng commit upstream [test: tools/scripts/src/baseline.rules.test.ts » rebase --abort chạy, báo file và commit upstream]
- Kịch bản: khi chỉ conflict baseline thì tự giải, không abort [test: tools/scripts/src/baseline.rules.test.ts » baseline-only vẫn tự giải, không abort]
