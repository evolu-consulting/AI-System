# UAT P-c1 Tự-sửa mã (diff-only) — tenant evolu — 2026-10-14

**Kết luận: Đạt có điều kiện** — 0 Blocker, 2 Major, 6 Minor; 49/49 bước script PASS. Trình duyệt thật (VI, 1280×800) + Hub thật + Runtime thật, sandbox Docker Desktop (`ai-autofix-sandbox:0.1.0`, `--network none`). Provider chỉ `fake-cli`.
Tài khoản: `admin` (platform), `julian.bui` (tenant_admin), `thomas.tran` (người chạy), `vio.ngo` (nhóm duyệt), `rowan.nguyen` (member trong phòng), `uat-outsider` (member ngoài phòng, tạo cho UAT). Nguồn `repo` = `local_path` repo nhỏ (bug `add` trả `a - b`, 1 test). Sửa dữ liệu seed hỏng: `UPDATE … sources` đổi 0 hàng.

## Kịch bản
| # | Nội dung | Kết quả | Ảnh |
|---|---|---|---|
| 1 | Editor stage tự-sửa: bật/tắt, nguồn/test/install/allowlist lưu + tải lại; 3 luật `AUTOFIX_*` chặn ở client và 422 ở server; 400 trường lạ / > 20 mẫu | Đạt | 01–10d |
| 2 | Run sandbox thật: diff, "Test đạt", nhánh `ai/<run>/fix`, log, tải diff/log; Chưa đạt → vòng 2 cộng dồn; `no_changes`; git_remote hiện SHA ghim; admin-web cùng khối | Đạt | 03–06, 10b–13, d01, f01 |
| 3 | Kiểm trượt paths / secrets / tests / install → `autofix_check_failed`, chỉ "Thêm 1 lần làm lại" / "Huỷ" ở cả hai app; bí mật không lộ ở UI/API/DB | Đạt | c01–c20, d10 |
| 4 | `RUNTIME_SANDBOX=off` và ảnh không có → `sandbox_unavailable` | Đạt (giả lập cấu hình) | e01–e03 |
| 5 | Quyền: người duyệt xem/tải 200; ngoài phòng 404; không token 401; người duyệt quyết `autofix_*` 403; `use_current` 409; admin cần `?tenant_id` | Đạt | 09, c04 |
| 6 | Gate Đạt / Chưa đạt sau autofix | Đạt | 06, 10, 11 |

## Lỗi
**Major**
1. `hub:dev` dựng Runtime thiếu `RUNTIME_SOURCE_CACHE_DIR` + `HUB_SOURCE_LOCAL_ROOTS` (`tools/hub-dev/src/dev.ts`) ⇒ `source.resolve` kẹt `queued`, mọi quy trình có nguồn không chạy trên stack dev. UAT dựng lại Runtime bằng `scripts/runtime.sh`.
2. `fake-cli` với chỉ thị `#fake:ws_*` thay cả thân trả lời bằng tóm tắt ⇒ thiếu mục `## …` ⇒ `fixbug-apply` luôn `template_invalid` (4 lần chạy sandbox) rồi `needs_decision`. UAT đặt `required_sections='[]'` bằng SQL. Claude thật: chưa kiểm (`g01`).

**Minor**
3. Chép mẫu khi tenant chưa có nguồn `repo`: toast thô "Không lưu được: Source not found".
4. "Vòng k" đếm cả lần thử lại do template (gate đầu tiên đã là "Vòng 4").
5. Lệch mockup: `+i −d`/"Test đạt" chữ trơn (mockup chip); danh sách file một cột (mockup 2); chip "Vòng" ngoài header; thứ tự/màu nút; alert editor nền trắng; nhãn "Có lỗi" bị cắt trên node canvas (`07b`, `10c`).
6. Badge "Hợp lệ" vẫn hiện khi ô Nguồn lỗi 422 (`10d`).
7. "Xem diff" vẫn hiện khi `check_failed` không có diff (`c02`, `c11`).
8. Đầu trang run chat-web "Kiểm không đạt" thiếu "· <nhóm>" (admin-web có) (`c01`).

## Giới hạn
Chưa kiểm: EN/mobile/dark; diff > 2.000 dòng, trần kích thước/số file, file cấm cứng; install có phụ thuộc thật; `apply_patch`, KnowledgeHub; Claude/subscription (cần dịch vụ trả tiền); tắt Docker Desktop thật. Dùng API/SQL dựng điều kiện: cấu hình def, `required_sections=[]`, nguồn library `uat-lib`, user `uat-outsider`, locale `julian.bui` (đã trả lại).

## Dọn dữ liệu
Đã xoá: run `fixbug-apply`, `autofix_results`, file diff/log, tin thread của run, def bản chép (soft-delete), nguồn `repo`/`uat-calc`/`uat-lib`/`uat-gh`, repo thử (`scripts/cleanup.mjs`). Còn: user `uat-outsider` (đã khoá), `hub.jobs` lịch sử, cache nguồn Runtime. Tiến trình còn chạy: admin-api `:3001`, hub-api `:4000`, container `ai-hub-dev-runtime`.
