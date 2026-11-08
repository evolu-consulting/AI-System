# check error codes

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: check:error-codes chặn mã lỗi hai nguồn (nguồn: cr125-g1-error-codes)
Mỗi mã lỗi khai ở `packages/contracts` có đúng một khoá i18n chuẩn mỗi ngôn ngữ, không có khoá `.err.<MÃ>`/`.apiError.<MÃ>` thứ hai ngoài tiền tố riêng đã khai; hub (ngoài test) không có câu tiếng Việt cạnh mã đó. Chạy trong `bun run check` và cổng sau rebase của `slice:merge`.
- Kịch bản: khi một mã thiếu khoá hoặc có khoá thứ hai thì check đỏ nêu mã và khoá [test: tools/scripts/src/check-error-codes.rules.test.ts » check:error-codes · khoá i18n]
- Kịch bản: khi hub có câu tiếng Việt ngay sau một mã lỗi thì check đỏ nêu file và dòng [test: tools/scripts/src/check-error-codes.rules.test.ts » check:error-codes · hub không chứa câu tiếng Việt]
- Kịch bản: cổng sau rebase chạy check:error-codes [test: tools/scripts/src/slice-rebase.test.ts » cổng sau rebase]

