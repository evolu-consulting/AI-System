# Platform · slice:rm và depcruise

Cập nhật: 2026-11-09 · Gộp từ: tool-depcruise-exit (đợt cr125-wave).

## Yêu cầu: slice:rm dọn thư mục thừa (nguồn: tool-depcruise-exit)
Thư mục lát không còn là worktree thì `slice:rm` vẫn xoá thư mục và nhánh; lỗi khác (có thay đổi chưa commit) vẫn dừng.
- Kịch bản: khi git báo không phải working tree thì tiếp tục xoá [test: tools/scripts/src/slice-rm.rules.test.ts » thư mục không còn là worktree thì bỏ qua lỗi và xoá thư mục]

## Yêu cầu: depcruise nêu rõ nguyên nhân đỏ (nguồn: tool-depcruise-exit)
Khi đỏ vì vi phạm thật, dòng cuối nói rõ không phải do cảnh báo stale; chỉ stale thì xanh.
- Kịch bản: khi có vi phạm thật thì nêu số lỗi thật [test: tools/scripts/src/slice-rm.rules.test.ts » vi phạm thật thì nêu rõ nguyên nhân, không phải stale]
- Kịch bản: khi chỉ có stale thì xanh [test: tools/scripts/src/slice-rm.rules.test.ts » chỉ stale thì xanh và không có lời nhắn đỏ]
