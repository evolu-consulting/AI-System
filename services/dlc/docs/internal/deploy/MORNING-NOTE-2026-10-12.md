# Ghi chú sáng 12/10 cho Rowan (INTERNAL - do not ship to customers)

## Tóm tắt

Bộ cài cho khách (Windows Server) đã sẵn sàng và **đã chạy thử nguyên chuỗi trên máy build từ đúng các gói đã
build**: Keycloak (https) → đăng nhập PKCE → Frontend mặc định → DLC engine → KH (chỉ cho agent). Một flow New
System thật (spec web app nhỏ, model thật) chạy **green trong 220 s, tốn $0.70**: Pause/Resume giữa chừng, xem
node/worklog/report, **Start app mở được `http://<IP>:19100/`** và trả đúng trang. 16/16 bước kiểm tra PASS.

Đêm qua tìm và sửa 2 lỗi chặn demo:
1. Kit đóng gói KH bị thiếu thư viện (`torch\utils\data`) nên KH trong kit **không khởi động được**. Đã sửa
   `deploy/build-deploy-kit.ps1` (loại thư mục runtime theo đường dẫn đầy đủ + tự kiểm tra).
2. Engine chấm QAS đỏ 3/3 dù app chạy đúng: bộ chạy test QAS bỏ qua `setUpClass` (test web app khởi động server ở
   đó). Đã sửa `line/ship/qas_runner.py` + test hồi quy. Trước khi sửa: run escalate `QAS_RED`; sau khi sửa: green.

## Thứ tự làm hôm nay (theo `DEPLOY-RUNBOOK.md`)

1. Trên máy build: kit đã có sẵn ở `E:\lw\dlc-kit` (đã build lại từ `main` đêm qua). Nếu muốn build lại: mục 1 của
   runbook (KH `build.ps1`, `build_dlc.ps1`, `packaging_fe\build_fe.ps1`, rồi `build-deploy-kit.ps1`).
2. Copy `E:\lw\dlc-kit` lên VPS thành `C:\DLC-install`.
3. VPS: cài PowerShell 7, Git, Python 3.11/3.12 (All users, có PATH), Claude CLI (mục 2).
4. `install-stack.ps1` (mục 4) → `configure-claude-profile.ps1 -Mode Token` (mục 5) → `seed-stack.ps1` (mục 6,
   tạo user demo với `dlc-user,dlc-admin`) → `verify-stack.ps1` (mục 7, phải "all checks passed").
5. Máy demo: cài `C:\DLC\config\keycloak-tls.cer` vào Trusted Root (hoặc mở `https://<IP>:8443` chấp nhận 1 lần).
6. Demo (mục 8): `http://<IP>:8795` → Sign in → New System → kéo file `.md` → theo dõi → green → Start app.

## Gói (E:\lw\dlc-kit)

| File | Kích thước | sha256 (16 ký tự đầu) |
|---|---|---|
| dlc-0.1.0-win64.zip | 9 686 855 | 370ac9bc51889115 |
| dlc-fe-0.2.0-win64.zip | 8 507 818 | 092f2156ff93fe9a |
| KnowledgeHub-win64.zip | 837 598 898 | 24e9fe842d868749 |
| keycloak-26.0.7.zip | 147 055 278 | 25353b74613bcf72 |
| OpenJDK21U-jdk_x64_windows_hotspot.zip | 205 073 461 | f9d6e191ab098c0d |
| WinSW-x64.exe | 33 123 | e3ce235425032cc3 |
| lessons-customer.json (367 lesson) | 391 099 | 718142384b0b7bc9 |
| kh-signing-key.pem | bí mật | không chia sẻ |

Không có file `.py` của mình trong các zip (dlc chỉ có app mẫu cho `selfcheck`; KH chỉ có thư viện bên thứ ba).

## Đã chạy thử (máy build, cổng riêng, chạy như process vì không có quyền admin)

| Bước | Kết quả |
|---|---|
| Giải nén 5 gói từ kit | PASS |
| Keycloak https + import realm `dlc` | PASS |
| KH exe (agent profile, 127.0.0.1) lên, 14 capability | PASS (sau khi sửa kit) |
| Tạo project, gắn namespace `dlc_line`, client + token | PASS |
| Apply manifest engine (92 types) | PASS |
| Engine (`dlc.exe serve`, auth Keycloak, RAG http, profile agents) | PASS |
| Import 367 lesson | PASS (stored 367, failed 0) |
| FE seed flows + serve | PASS |
| User demo + đăng nhập PKCE (aud `dlc-api`, role `dlc-user`) | PASS |
| Engine 401 không token / 200 có token / `/api/me` | PASS |
| Board engine tải được (trang đăng nhập) | PASS |
| Tạo pack + start run New System (decide) qua proxy FE | PASS |
| Pause rồi Resume khi đang chạy | PASS |
| Run green, 8 node, worklog, 5 report mở được | PASS (run `R20261012-012011-6b1a`, 220 s, $0.70) |
| Start app → `http://192.168.0.188:19100/` trả trang "Hello DLC" + `/api/health` | PASS |
| Stop app | PASS |

Test: engine 687 test OK, 8 skip (gồm 2 test hồi quy QAS mới), app FE cũ 32 OK, KH (principals 52, registry 50, retrieval 56,
events 36, embed remote, customer docs, sync) ALL PASS, FE build + typecheck sạch.

## Rủi ro còn lại và cách xử lý

| Rủi ro | Xử lý |
|---|---|
| Script cài **chưa chạy thật dưới quyền admin / Windows service** (máy build không elevated) | Làm theo runbook từng bước, xem checkpoint sau mỗi mục; `verify-stack.ps1` bắt lỗi sớm |
| Trình duyệt demo chưa tin chứng chỉ tự ký | Cài `keycloak-tls.cer` vào Trusted Root máy demo trước giờ demo |
| Claude CLI dưới service account | Dùng `-Mode Token` (`claude setup-token`); checkpoint phải in `ready` |
| Mất mật khẩu admin Keycloak | Lệnh `kc.bat bootstrap-admin user ...` (runbook mục 10, đã thử) |
| Cổng 9000 bị chiếm trên VPS (Keycloak dùng cho health) | Thêm `http-management-port=9001` vào `keycloak.conf` |
| Run đầu tiên chậm hơn (model thật) | Spec nhỏ: ~4 phút; spec lớn hơn 10-20 phút |
| Python trên VPS không có trên PATH của service | Cài Python "All users" + "Add to PATH"; Start app và QAS cần Python |

Công cụ chạy thử lại: `Slaves/SDLC/deploy/rehearsal/` (`rehearse-local.ps1`, `demo_e2e.py`).
