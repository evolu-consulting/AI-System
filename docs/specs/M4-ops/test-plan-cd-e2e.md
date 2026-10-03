---
spec: M4-ops
part: phụ lục E2E của test-plan-cd.md (khối C + D)
owner: qc
---

# Test-plan M4 · C + D · E2E

Quy ước/fixture: `test-plan-cd.md` §0. Dữ liệu `baseFile()`: §3.2 C-I01.


### 5.1 `e2e/m4-2fa.spec.ts` (FE6a–c; nhãn: missing-screens §10, plan-frontend §6)

| Mã | Luồng | Kỳ vọng |
|---|---|---|
| E-2FA-01 · M4-AC11 | binh `loginToShell` → menu avatar → `menuitem "Xác thực hai bước"` → `heading "Xác thực hai bước"`, chữ "Chưa bật" → `button "Bật xác thực hai bước"` → `getByLabel("Mật khẩu hiện tại")` = PW → `button "Tiếp tục"` (lấy `secret` từ `waitForResponse(/auth/totp/setup)`) → `img "Mã QR để thêm tài khoản vào ứng dụng xác thực"` → `button "Tiếp tục"` → `textbox "Mã xác thực"` = `codeFor(secret, 0)` | `heading "Lưu mã dự phòng"`; `list "Mã dự phòng"` có 10 `listitem`; `button "Hoàn tất"` khoá tới khi tick `checkbox "Tôi đã lưu mã dự phòng ở nơi an toàn"`; bấm → toast "Đã bật xác thực hai bước"; chữ "Đã bật", "còn 10 mã dự phòng" |
| E-2FA-02 | sai mã ở bước bật: `codeFor(secret, 5)` | chữ "Mã không đúng. Kiểm tra giờ trên điện thoại và thử lại." |
| E-2FA-03 · bước đăng nhập | đăng xuất → `fillLogin(acme, binh, PW)` | `heading "Xác thực hai bước"`, chữ "acme · binh"; `textbox "Mã xác thực"` = `codeFor(secret, 5)` → `alert` "Mã không đúng hoặc đã hết hạn"; `waitNextStep` rồi `codeFor(secret, 1)` → vào shell (mỗi lần đăng nhập thành công về sau trong ca cũng `waitNextStep` + `codeFor(secret, 1)`) |
| E-2FA-04 · mã dự phòng | đăng xuất → login → `button "Dùng mã dự phòng"` → `textbox "Mã dự phòng"` = codes[0] → `button "Xác nhận"`; lặp với codes[0] | lần 1 vào shell; lần 2 `alert` "Mã không đúng hoặc đã hết hạn"; `button "Dùng mã từ ứng dụng"` đổi lại ô `Mã xác thực` |
| E-2FA-05 | ở bước mã → `link "Quay lại đăng nhập"` | form đăng nhập, mã công ty `acme` + tên `binh` còn giữ |
| E-2FA-06 · khoá tạm | 5 lần `codeFor(secret, 5)` (mỗi lần 401 `INVALID_OTP`, thấy `login.totp.wrong`, **chưa** có "Tạm khoá"); lần 6 (mã bất kỳ, 423) | lần 6 mới thấy `alert` khớp `/^Tạm khoá đến \d{2}:\d{2}$/` |
| E-2FA-07 · Q-D1 | trang 2FA → `button "Tạo lại mã dự phòng"` → `alertdialog "Tạo lại mã dự phòng?"` → `Mã xác thực` (`waitNextStep` rồi `codeFor(secret,1)`) → `button "Tạo lại"` | 10 mã mới, khác danh sách cũ; toast "Đã tạo mã dự phòng mới" |
| E-2FA-08 · tự tắt | `button "Tắt xác thực hai bước"` → `alertdialog "Tắt xác thực hai bước?"` → `Mật khẩu hiện tại` + `Mã xác thực` → `getByRole("alertdialog").getByRole("button", {name: "Tắt xác thực hai bước"})` | toast "Đã tắt xác thực hai bước"; chữ "Chưa bật"; login lần sau không có bước mã |
| E-2FA-09 · D11 không lộ | `collectTraffic` suốt E-2FA-01/04 | `leaksOnPage(page, t, [secret, ...codes, totp_token])` = `[]` (URL, storage, cookie đọc được) |
| E-2FA-10 · token hết hạn | `page.route` trả 401 `INVALID_TOTP_TOKEN` cho `/auth/totp/verify` | chữ "Phiên xác thực đã hết hạn. Hãy đăng nhập lại."; về form đăng nhập |
| E-2FA-11 · tắt hộ | chi bật 2FA qua API (`enable2faApi`); binh `/users` → hàng chi → `button "Thao tác khác"` → `menuitem "Tắt 2FA"` → `alertdialog "Tắt 2FA của chi?"` → `button "Tắt 2FA"` | `waitForResponse` 200; toast "Đã tắt 2FA của chi"; hàng binh (chính mình) và hàng `an` (chưa bật) không có `menuitem "Tắt 2FA"` |
| E-2FA-12 · M4-AC12 | `an` (member): menu avatar; `goto /account/2fa` | không có `menuitem "Xác thực hai bước"`; chuyển về `/member` (như E20) |
| E-2FA-13 | dialog tắt (E-2FA-08) với mật khẩu sai; với mã sai; dialog tạo lại mã (E-2FA-07) với mã sai | mỗi ca: `alert` trong dialog có chữ của `twofa.error.wrongCreds` (đọc từ `vi.json`); dialog còn mở, 2FA vẫn bật |

### 5.2 `e2e/m4-transfer.spec.ts` (FE5a–b; nhãn: missing-screens §8)

| Mã | Luồng | Kỳ vọng |
|---|---|---|
| E-TR-01 · M4-AC09 | admin → `link "Import / Export"` → `heading "Import / Export"`, `tab "Export"` | `checkbox` tên bắt đầu `Workflows` … `Grants` có số đếm = `/export/meta`; ghi chú "Secret chỉ xuất tên, không xuất giá trị. Cấu hình agent xuất ở Agent Studio." |
| E-TR-02 | bỏ `checkbox "Chọn tất cả"` | nút tải khoá + chữ "Chọn ít nhất một loại để xuất" |
| E-TR-03 · AC-A06 | chọn tất cả → `button "Tải file config-v{n}.yaml"` (n từ DB) | `download.suggestedFilename() = config-v{n}.yaml`; nội dung có `DIFY_TRANSLATE_KEY`, không có `LEAK_1`; toast "Đã tải config-v{n}.yaml" |
| E-TR-04 · M4-AC09/10 | `tab "Import"` → `getByLabel("Chọn file").setInputFiles({name:"config-v39.yaml", buffer: baseFile()})` | chip `button "Thêm 2"`, `"Sửa 3"`, `"Không đổi k"`; chữ "Import không xoá thực thể không có trong file."; `region "Cần tạo secret"` có `DIFY_REPORT_KEY`; `button "Áp dụng 5 thay đổi"` khoá |
| E-TR-05 | `getByLabel("Giá trị DIFY_REPORT_KEY")` (type password) = LEAK_2 → `button "Áp dụng 5 thay đổi"` → `alertdialog` "Áp dụng 5 thay đổi từ config-v39.yaml?" → `button "Xác nhận"` | `waitForResponse(import?dry_run=0)` 200; toast "Đã import · Thêm 2 · Sửa 3 · v{n+1}"; về bước 1; DB `DIFY_REPORT_KEY` tồn tại; `leaksOnPage([LEAK_2])` = `[]` |
| E-TR-06 | chip `button "Thêm 2"` | `aria-pressed=true`, chỉ còn mục Thêm |
| E-TR-07 | file `REF_NOT_FOUND` | `alert` "File không hợp lệ" + chữ `commands[0].workflow`; không có nút Áp dụng |
| E-TR-08 | `x.json`; file 1 048 577 byte | "Chỉ nhận file .yaml hoặc .yml"; "File lớn hơn 1 MB"; không request `/admin/import` |
| E-TR-09 | import đúng file vừa export | chữ "File không có thay đổi nào so với cấu hình hiện tại."; không nút Áp dụng |
| E-TR-10 · 409 | dry-run xong → `apiAsAdmin` PATCH command → Áp dụng + Xác nhận | chữ "Cấu hình vừa thay đổi. Đã tạo lại bản xem trước."; có request `dry_run=1` mới |
| E-TR-11 | binh (tenant_admin): menu; `goto /transfer` | không `link "Import / Export"`; trạng thái 403 |


## Đỏ đúng lý do (Q2e · chạy trên DB `qcf`, 2026-10-03)

| Nhóm | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|
| `m4-transfer` | E-TR-01…10 | đỏ (10/10) | login admin qua; chờ `link "Import / Export"` — menu/route `/transfer` chưa có |
| `m4-transfer` | E-TR-11 | đỏ | `/transfer` chưa có trang 403 `heading "Bạn không có quyền xem trang này"` |
| `m4-2fa` | E-2FA-01, 02, 09 | đỏ | chờ `menuitem "Xác thực hai bước"` — chưa có mục menu/route `/account/2fa` |
| `m4-2fa` | E-2FA-03…08, 10, 11, 13 | đỏ | `enable2faApi` nhận 404 ở `POST /auth/totp/setup` — route M4 chưa có (đỏ ở dựng dữ liệu do thiếu route/migration M4 — chấp nhận) |
| `m4-2fa` | E-2FA-12 | đỏ | `expect(page).toHaveURL(/\/member$/)`: `/account/2fa` chưa chuyển hướng |

Không ca nào đỏ ở login/`prepare-db`/TypeError. Giả định nhãn cần frontend-lead đối chiếu: (1) ô `Mã xác thực` ở bước bật, đăng nhập và OTP trong dialog là `textbox` duy nhất; bước bật + đăng nhập tự gửi khi đủ 6 số, dialog Tắt/Tạo lại KHÔNG tự gửi (bấm nút); (2) nút trong dialog tạo lại = `Tạo lại`, nút huỷ = `Huỷ`; (3) `alert` trong dialog chứa `twofa.error.wrongCreds`; (4) 403 `/transfer` hiện `heading "Bạn không có quyền xem trang này"`; (5) tên checkbox Export dạng `Workflows (5)`; (6) hàng chip lọc/mục Import hiển thị khoá mục (`report-new`, `translate`, `acme`, `bao-cao`) làm text khớp chính xác; (7) tắt hộ trả 200 từ `POST /admin/users/:id/totp/disable`, tự tắt trả 204 `/auth/totp/disable`.
