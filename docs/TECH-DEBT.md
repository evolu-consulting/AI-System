# TECH DEBT

Ghi lại thay vì sửa lan ra ngoài phạm vi task (xem `CONVENTIONS.md` §1, §4). Mỗi dòng: vị trí, vấn đề, đề xuất, ai phát hiện.

| # | Ngày | Vị trí | Vấn đề | Đề xuất | Phát hiện bởi |
|---|---|---|---|---|---|
| 1 | 2026-10-01 | `docs/design/**/*.html` | HTML viết tay song song với md, sửa tốn gấp đôi | Script sinh html từ md; wireframe tách file riêng | điều phối |
| 2 | 2026-10-01 | `tools/mocks/src/fixtures.ts` (`DIFY_WORKFLOW_RUN_OK`, `DIFY_CHAT_OK`, `HUB_TEST_RUN_OK`) | Hàm đặt tên SCREAMING_SNAKE như hằng số, lệch CONVENTIONS (hàm camelCase) | Đổi thành `difyWorkflowRunOk(…)`, `difyChatOk(…)`, `hubTestRunOk(…)` khi chạm lại mock (M1); giữ hằng số thuần ở SCREAMING_SNAKE | reviewer M0 vòng 1 #10 |
| 3 | 2026-10-01 | `tools/scripts/src/lib/git.ts` | Chưa có unit test riêng (`toRepoPath`, `notIgnored`, `changedFiles`, `hasRef`); chỉ được phủ gián tiếp qua test check-size/depcruise/trace | Thêm `git.test.ts` dựng repo tạm (`git init` trong `os.tmpdir()`), gồm ca đường dẫn 8.3 Windows và file untracked/ignored | reviewer M0 vòng 1 #12 |
| 4 | 2026-10-01 | `tools/scripts/src/trace.ts` | NFR hiện có ưu tiên "—" nên `trace --check` không chặn NFR thiếu test (review M0, Minor #13) | Gán ưu tiên cho NFR trong spec/BA hoặc cho `--check` coi "—" là MUST | reviewer |
| 5 | 2026-10-01 | `apps/admin-web/rsbuild.config.ts` (rule `@tanstack/react-router`) | Rspack `parser.exportsPresence` đang tắt (`false`) cho `@tanstack/react-router` vì gói đọc `React["use"]` (chỉ có ở React 19) → export vắng/import sai tên trong gói này không bị build báo lỗi | Khi lên React 19 hoặc router bỏ nhánh `React["use"]`: xoá rule, để mặc định `"error"`; tạm thời có thể đặt `"warn"` nếu Rspack cho phép lọc cảnh báo riêng mà không làm bẩn log build | reviewer M0 vòng 1 #5 |
