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

## Sửa backend/dev (WRK-FR-28)
- Major 1 — `tools/hub-dev/src/dev.ts` `runtimeEnv`: thêm `RUNTIME_ENV=development`, `RUNTIME_SOURCE_CACHE_DIR` (container `/tmp/hub-dev-srccache`; local `.data/hub-dev-srccache`), `HUB_SOURCE_LOCAL_ROOTS` (container `/work`, ghi đè `HUB_DEV_SOURCE_ROOTS`; local = repo). Guide: `docs/guides/hub-dev.md` mục "Nguồn `repo` trong hub-dev". Cần chạy lại `hub:dev` để Runtime nhận env; nguồn `local_path` trong container khai `/work/...`.
- Major 2 — `providers/fake/provider.py` `_answer`: có `#fake:sections` thì thân = các mục `## …` rồi tóm tắt ws nối sau (vào mục cuối) ⇒ `fixbug-apply` qua checkTemplate. Test: `test_sections.py` (2 ca). Không đụng test khoá; không có tranh chấp.
- Minor 3 — Hub đã trả đúng mã: HTTP 404, `code: SOURCE_NOT_FOUND`, message "Source not found", không có `details` (`defs.service.ts #checkSources`, PB-R06; cố ý không lộ key). FE dịch theo `code`.

## Đã sửa FE (Minor #3, #5-#8)
Xem `plan-frontend.md` FC15. #4 (đếm vòng) là hành vi Hub, chỉ ghi nhận. `mockup/` chưa chụp lại sau sửa.

## Vòng 2 (evolu, 2026-10-14, evidence: `round2/`, script `scripts/r2-*.mjs`)
**Kết luận: Đạt** — 0 lỗi mới; Major 1–2 và Minor 3, 5–8 đã sửa; Minor 4 còn (hành vi Hub). Stack dựng lại bằng `hub:dev` đúng guide (không `runtime.sh`); log Runtime có `resolve.enabled` + `sandbox.ready`; nguồn `local_path` `/work/.data/uat-autofix-repo` kiểm `check` 200 (`files:3`). Chỉ fake-cli.
- Major 1 Đạt: `source.resolve` chạy, run `fixbug-apply` lấy bản sao nguồn. Major 2 Đạt: template giữ `required_sections` mặc định (Thay đổi/Test/Bàn giao, không SQL) ⇒ tới gate ở **Vòng 1** (`06-B-gate-run-page`); Chưa đạt ⇒ Vòng 2 ⇒ Đạt ⇒ xong; admin-web cùng khối (B00–B13, 10/10 PASS).
- #3 Đạt: chép mẫu khi chưa có nguồn `repo` ⇒ toast VI "Quy trình dùng nguồn mã mà tenant này chưa có. Tạo nguồn trước (mục Nguồn), rồi lưu lại." (`02-copy-toast-no-source`).
- #5 Đạt (khớp mockup): chip `+i −d`/"Test đạt", chip "Vòng" ở header, file 2 cột, Huỷ (viền) → Thêm lượt, alert nền hồng, node canvas đủ nhãn (`06`, `07b`, `10d`). #6 Đạt: ô Nguồn lỗi 422 không còn badge "Hợp lệ". #7 Đạt: `check_failed` không có "Xem diff" (`c01`, `c02`). #8 Đạt: chat-web "Kiểm không đạt · Đường dẫn" (`c01`).
- Hồi quy Đạt: kiểm trượt paths/secrets/tests chỉ 2 nút, không lộ bí mật, người duyệt xem diff, quyết `autofix_*` 403, `use_current` 409, nguồn không bị ghi ngược (C00–C30, 12/12).
- Còn lại: Minor 4 — "Vòng k" vẫn đếm lần thử lại do template (script lần đầu: feedback "Chưa đạt" thiếu `#fake:sections` ⇒ 3 lần thử lại ⇒ "Vòng 4"; đã sửa script, ghi nhận là hành vi Hub). `.env.local` cũ thiếu `HUB_PROCESS_ENGINE=on`/CORS 3000 ⇒ truyền qua shell khi chạy `hub:dev` (theo guide K1), không phải lỗi sản phẩm.
- Giới hạn: EN/mobile/dark, Claude thật, tắt Docker thật chưa kiểm. Dọn: run/def bản chép/nguồn/file diff-log/repo thử đã xoá; còn user `uat-outsider` (khoá), job lịch sử. Locale `julian.bui` trả về en. Stack `hub:dev` (admin-api :3001, hub-api :4000, Runtime) còn chạy; rsbuild :3000/:3100 đã dừng.
