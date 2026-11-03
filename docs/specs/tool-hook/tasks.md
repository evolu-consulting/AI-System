---
id: tool-hook
lát: tool-hook
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hook PreToolUse chặn subagent ghi checkout chính ngoài worktree (4 lần agent lỡ ghi `F:\workspace\evolu-platform`).

## Làm
- `tools/scripts/src/guard-worktree.rules.ts` (luật thuần) + `guard-worktree.ts` (CLI stdin→JSON deny) + test; hook trong `.claude/settings.json`; 2 dòng ở `docs/WORKFLOW.md` mục 6.

## Không làm / Chạm
- Không chặn lệnh khác (git, cp, mv, New-Item); không chạm code ứng dụng.

## Test tối thiểu
- `bun test tools/scripts/src/guard-worktree.test.ts` + pipe-test JSON giả (subagent→main chặn, →worktree cho qua, phiên chính cho qua, PS redirect gốc repo chặn).

## Quyết định trong lúc làm
- Nhận diện subagent bằng `agent_id` (docs hooks); `agent_type` không dùng vì có cả khi phiên chạy `--agent`. Không cần marker/env "đợt đang chạy".
- Hook dạng exec (`command: bun` + `args`) để không phụ thuộc Git Bash (máy này không có bash → shell-form chạy PowerShell, `|| true` lỗi).
- Fail-open; đường dẫn tương đối tính theo `cwd` của hook input; biến/glob/`~` không phân giải được thì cho qua.
- Lối thoát: env `EVOLU_GUARD_ALLOW_AGENTS` / `EVOLU_GUARD_OFF=1` / `EVOLU_MAIN_ROOT`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ dev)

## Việc còn lại
- Hiệu lực ở phiên mới sau khi merge; điều phối kiểm thực tế bằng một subagent thử ghi vào checkout chính.
