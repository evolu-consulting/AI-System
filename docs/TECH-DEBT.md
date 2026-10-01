# TECH DEBT

Ghi lại thay vì sửa lan ra ngoài phạm vi task (xem `CONVENTIONS.md` §1, §4). Mỗi dòng: vị trí, vấn đề, đề xuất, ai phát hiện.

| # | Ngày | Vị trí | Vấn đề | Đề xuất | Phát hiện bởi |
|---|---|---|---|---|---|
| 1 | 2026-10-01 | `docs/design/**/*.html` | HTML viết tay song song với md, sửa tốn gấp đôi | Script sinh html từ md; wireframe tách file riêng | điều phối |
| 2 | 2026-10-01 | `tools/mocks/src/fixtures.ts` (`DIFY_WORKFLOW_RUN_OK`, `DIFY_CHAT_OK`, `HUB_TEST_RUN_OK`) | Hàm đặt tên SCREAMING_SNAKE như hằng số, lệch CONVENTIONS (hàm camelCase) | Đổi thành `difyWorkflowRunOk(…)`, `difyChatOk(…)`, `hubTestRunOk(…)` khi chạm lại mock (M1); giữ hằng số thuần ở SCREAMING_SNAKE | reviewer M0 vòng 1 #10 |
| 3 | 2026-10-01 | `tools/scripts/src/lib/git.ts` | Chưa có unit test riêng (`toRepoPath`, `notIgnored`, `changedFiles`, `hasRef`); chỉ được phủ gián tiếp qua test check-size/depcruise/trace | Thêm `git.test.ts` dựng repo tạm (`git init` trong `os.tmpdir()`), gồm ca đường dẫn 8.3 Windows và file untracked/ignored | reviewer M0 vòng 1 #12 |
| 4 | 2026-10-01 | `tools/scripts/src/trace.ts` | NFR hiện có ưu tiên "—" nên `trace --check` không chặn NFR thiếu test (review M0, Minor #13) | Gán ưu tiên cho NFR trong spec/BA hoặc cho `--check` coi "—" là MUST | reviewer |
| 5 | 2026-10-01 | `apps/admin-web/rsbuild.config.ts` (rule `@tanstack/react-router`) | Rspack `parser.exportsPresence` đang tắt (`false`) cho `@tanstack/react-router` vì gói đọc `React["use"]` (chỉ có ở React 19) → export vắng/import sai tên trong gói này không bị build báo lỗi | Khi lên React 19 hoặc router bỏ nhánh `React["use"]`: xoá rule, để mặc định `"error"`; tạm thời có thể đặt `"warn"` nếu Rspack cho phép lọc cảnh báo riêng mà không làm bẩn log build | reviewer M0 vòng 1 #5 |
| 6 | 2026-10-01 | `apps/admin-web/scripts/check-bundle.ts:31` | `rel === "stylesheet"` bỏ sót rel nhiều giá trị (vd `"stylesheet preload"`); Rsbuild hiện không sinh | Tách `rel` theo khoảng trắng, kiểm có `stylesheet` | reviewer M0 vòng 2 #2 |
| 7 | 2026-10-01 | `docs/specs/_design/admin-missing-screens.md` §12.5 (Gate M3, FR-55, AC-A07) | `VERSION_CONFLICT` chưa có `updated_by` tới M4 (CR-008) nên modal xung đột không nêu được người sửa | Gate M3 chốt câu thay thế "Bản này vừa được sửa lúc {time} (v{n})" và nút/ConfirmDialog không có `{user}`; từ M4 đổi lại câu có `{user}` | readiness M1 lần 2 #18 |
| 8 | 2026-10-01 | `apps/admin-api` (auth, spec M1 §6) | Refresh token hết hạn chưa được dọn khỏi DB | Job dọn định kỳ (xoá `expires_at` quá hạn) khi có Worker/cron | reviewer M1 vòng 1 #10a |
| 9 | 2026-10-01 | `apps/admin-api` (A4) | M1 chưa ghi audit cho thao tác tenant/user/auth | Sẽ có ở M4 (audit log) | reviewer M1 vòng 1 #10b |
| 10 | 2026-10-01 | `tools/scripts` (`check:size`, `depcruise`) | Khi working tree sạch, hai lệnh không kiểm file nào (chỉ xét file đổi) → nghiệm thu giả xanh | Bước nghiệm thu chạy với `--all` hoặc so với merge-base | reviewer M1 vòng 1 #13 |
| 11 | 2026-10-01 | `apps/admin-api/src/modules/auth` (test khoá tạm #3, `tests/acceptance/M1`) | Phần song song của test khoá tạm #3 không tất định; lỗi thật do test backend dùng hook `beforeVerify` bắt | Khi có seam công khai thì đưa vào acceptance | reviewer M1 vòng 2 m1 |
| 12 | 2026-10-01 | `apps/admin-api` (`AuthCtx`) | Seam test `beforeVerify?` nằm trong type production `AuthCtx` | Tách ra `AuthTestHooks` | reviewer M1 vòng 2 m2 |
| 13 | 2026-10-01 | `packages/db/src/scope.ts` (`withScope`) | Retry 40P01/40001 (tối đa 3 lần) chỉ an toàn khi callback chỉ làm việc DB | Từ M2: nếu callback gửi gì ra ngoài (NOTIFY, mail, gọi HTTP) thì đưa phần đó ra sau commit | reviewer M1 vòng 2 |
