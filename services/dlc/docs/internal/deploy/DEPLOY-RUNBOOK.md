# DEPLOY RUNBOOK — KH + Keycloak + DLC engine + FE mặc định trên Windows Server (INTERNAL - do not ship to customers)

Mục tiêu ngày deploy: dựng mới toàn bộ stack trên VPS Windows Server của khách, seed dữ liệu, kiểm tra, rồi demo
1 flow: upload `.md` -> xem tiến độ -> completed -> bấm **Start app** mở `http://<IP>:<port>`.

Thời gian ước tính: 60-90 phút (chưa tính lần chạy demo thật, khoảng 10-20 phút với spec nhỏ).

---

## 0. Bài học đã đo trước (đọc trước khi bắt đầu)

1. **Keycloak bắt buộc HTTPS.** Keycloak 26 đặt cookie đăng nhập `Secure` kể cả khi chạy http, nên trình duyệt
   vào `http://<IP>:8080` sẽ báo *"Cookie not found"* và không đăng nhập được (đã tái hiện 12/10). Kit dùng
   HTTPS cổng **8443** với chứng chỉ tự ký cho IP của VPS. File `fe.config.example.json` trong gói FE đã ghi đúng
   `https://<server-ip>:8443/realms/dlc`; installer đặt giá trị thật qua biến môi trường.
2. Chứng chỉ tự ký: installer import vào `LocalMachine\Root` của VPS và đặt `SSL_CERT_FILE` cho engine + FE, nên
   2 service tự xác thực được JWKS. **Trình duyệt của người demo** vẫn cảnh báo lần đầu: mở
   `https://<IP>:8443` và chấp nhận 1 lần, hoặc cài `C:\DLC\config\keycloak-tls.cer` vào Trusted Root của máy
   demo (khuyến nghị, tránh lỗi fetch token ngầm).
3. User Keycloak phải có firstName/lastName/email, nếu không Keycloak chèn bước "verify profile". `new-user.ps1`
   đã điền sẵn.
4. KH chạy chế độ mở trên `127.0.0.1` (không có login), chỉ engine cùng máy gọi. Bản sửa ngày 12/10: namespace
   của engine giờ có quyền trên project của nó ở chế độ mở (trước đó trả 403 "no grant on project").
5. KH exe trước 12/10 thiếu 5 capability (records, packs, vault, outbox, lifecycle). Dùng bản build từ `main`
   sau commit `79b0650` trở đi (verify-stack kiểm tra đủ).
6. Engine cần `claude` CLI chạy được **không tương tác** dưới service. Dùng `claude setup-token` (khuyến nghị)
   hoặc login vào profile riêng `C:\DLC\claude-profile`.
7. Engine ở chế độ `LINE_HUMAN_MODE=decide`: không ai trả lời câu hỏi, model tự quyết và ghi log.

## 1. Chuẩn bị trên máy build (trước khi đi)

Máy build cần: Python 3.12 + PyInstaller, `Slaves\KnowledgeHub\.venv` đã cài đủ thư viện, node + pnpm, Git for
Windows (openssl để tạo key). Một lệnh build cả 3 gói từ source rồi gom thành kit (khoảng 15 phút, KH lâu nhất):

```powershell
# trong repo, main mới nhất, từ Slaves\SDLC
pwsh -File .\deploy\build-deploy-kit.ps1 -Out C:\lw\windows -Build `
     -LessonsFile .\docs\internal\deploy\seed\lessons-customer.json
```

`-Build` chạy lần lượt `..\KnowledgeHub\build.ps1`, `packaging\build_dlc.ps1`, `packaging_fe\build_fe.ps1`. Bỏ
`-Build` thì dùng zip mới nhất đang có trong `dist\`. JDK, Keycloak, WinSW chỉ tải lần đầu.

Kết quả `C:\lw\windows\`: JDK 21 zip, Keycloak 26.0.7 zip, `WinSW-x64.exe`, `KnowledgeHub-win64.zip`,
`dlc-<ver>-win64.zip`, `dlc-fe-<ver>-win64.zip`, `lessons-customer.json`, `kh-signing-key.pem` (bí mật, xem
mục 13), `SHA256SUMS`, thư mục `kit\` (scripts). Tên 2 zip DLC in ở cuối lệnh; `DlcZip` / `FeZip` trong
`stack.config.psd1` phải khớp. Kiểm tra nhanh: `python docs\internal\deploy\seed\check_lessons.py
lessons-customer.json` phải CLEAN.

Kit là bản build: **không commit vào git**. Git chỉ giữ script tạo kit và script cài.

Mang theo: thông tin đăng nhập RDP VPS, IP public, quyết định cổng, user demo + mật khẩu, tài khoản Claude
dùng cho engine (để chạy `claude setup-token`).

## 2. Trên VPS — yêu cầu hệ thống

| Thành phần | Bản | Ghi chú |
|---|---|---|
| Windows Server | 2019/2022 | user Administrator |
| PowerShell 7 | 7.4+ | `winget install Microsoft.PowerShell` (scripts cần `-SkipCertificateCheck`) |
| Git | 2.x | engine dùng git cho repo target |
| Python | 3.11/3.12 trên PATH (All users) | engine chạy test của target Python + `dlc selfcheck` |
| Node.js | 22 LTS (tuỳ chọn) | chỉ khi target là CAP/UI5/React |
| Claude Code CLI | mới nhất | `irm https://claude.ai/install.ps1 \| iex` |
| RAM / CPU / Disk | 8 GB / 4 vCPU / 40 GB | KH ~1-1.5 GB, Keycloak ~0.7 GB, engine + agent tối đa 10 song song |

Copy `C:\lw\windows` lên VPS thành `C:\DLC-install`.

## 3. Cổng

| Cổng | Dịch vụ | Mở firewall |
|---|---|---|
| 8443 | Keycloak (https) | có (trình duyệt + backend FE của khách) |
| 8795 | FE mặc định | có |
| 8796 | DLC engine API + board | có (giới hạn IP backend FE của khách qua `EngineAllowedRemote` nếu biết) |
| 9100-9199 | app được deploy ("Start app") | có |
| 9300 | KH | **không** (bind 127.0.0.1) |

Nếu VPS có firewall của nhà cung cấp (security group), mở thêm đúng các cổng trên ở đó.

## 4. Cài đặt (PowerShell 7, Run as Administrator)

```powershell
cd C:\DLC-install\kit\windows
copy stack.config.example.psd1 stack.config.psd1
notepad stack.config.psd1     # VpsIp = IP public; CustomerFeOrigin/Redirect nếu đã biết; giữ các cổng mặc định
pwsh -File .\install-stack.ps1 -Config .\stack.config.psd1
```

Cách nhanh, thay cho mục 4 đến 7: `run-install.ps1` chạy install-stack, configure-claude-profile, seed-stack,
verify-stack liền một mạch, ghi log vào `install-log.txt` (không ghi mật khẩu, token). Lỗi giữa chừng thì sửa
rồi chạy tiếp từ bước đó bằng `-From 3` (hoặc 4, 5).

```powershell
pwsh -File .\run-install.ps1 -LessonsFile C:\DLC-install\lessons-customer.json -UserName demo
```

Checkpoint sau bước này:
- `Get-Service dlc-*` -> `dlc-keycloak`, `dlc-kh` Running; `dlc-engine`, `dlc-fe` đã cài (chưa start).
- `https://<IP>:8443/admin` mở được; mật khẩu admin ở `C:\DLC\secrets\keycloak-admin.txt`.
- `Invoke-RestMethod http://127.0.0.1:9300/health` -> `status ok`.

## 5. Claude cho engine

```powershell
# Cách 1 (khuyến nghị): token dài hạn
#   ở một terminal khác: claude setup-token  -> đăng nhập trình duyệt -> copy token
pwsh -File .\configure-claude-profile.ps1 -Config .\stack.config.psd1 -Mode Token
# Cách 2: login vào profile riêng
pwsh -File .\configure-claude-profile.ps1 -Config .\stack.config.psd1 -Mode Login
```

Checkpoint: script in `claude -p answers: ready`.

Đổi token sau này: xem mục 13.

## 6. Seed

```powershell
pwsh -File .\seed-stack.ps1 -Config .\stack.config.psd1 `
     -LessonsFile C:\DLC-install\lessons-customer.json -UserName demo -UserRoles dlc-user,dlc-admin
```

Làm: tạo project `dlc` + `lesson-learned` trong KH, gắn namespace `dlc_line` cho engine + cấp client (secret chỉ
nằm trong service definition), apply manifest của engine, import 367 lesson (chạy lại an toàn), seed các flow
mặc định của FE (New System, Enhancement, Bug Fix; Feature Migration ẩn trừ khi bật), start engine + FE, tạo
user demo.

Checkpoint: `lessons: stored 367 ... failed 0`, `engine up`, `frontend up`.

## 7. Kiểm tra

```powershell
pwsh -File .\verify-stack.ps1 -Config .\stack.config.psd1 -UserName demo
```

Phải `all checks passed`: 4 service Running, realm + JWKS, host tin chứng chỉ, đăng nhập PKCE ra token có
`aud dlc-api` + `role dlc-user`, KH đủ capability + namespace active + chỉ bind 127.0.0.1, engine health +
401 khi không token + OpenAPI, `dlc selfcheck` (dry, không tốn tiền), trang FE 200, Claude đã cấu hình.

## 8. Demo (khách xem)

1. Máy demo: cài `keycloak-tls.cer` vào Trusted Root (hoặc mở `https://<IP>:8443` chấp nhận cảnh báo).
2. Mở `http://<IP>:8795` -> **Sign in** -> trang Keycloak -> `demo` / mật khẩu.
3. Home -> **New System** -> kéo thả file `.md` (spec nhỏ, ví dụ todo web app có trang + API) -> Start.
4. Theo dõi: các node understand -> tests -> plan -> build -> review -> merge -> qas -> result chạy dần; click
   một node để xem worklog của agent và các report (implement, test, decisions, findings).
5. Thử **Pause** rồi **Resume** trên Home (run giữ nguyên trạng thái).
6. Khi `green` (completed): bấm **Start app** -> app chạy trên cổng trong dải 9100-9199 -> tự mở tab mới
   `http://<IP>:<port>`. Nếu app đã chạy, bấm sẽ mở luôn tab.
7. Cho khách xem board engine `http://<IP>:8796/` (đăng nhập cùng tài khoản) nếu muốn.

Lưu ý spec demo: target mặc định là web app chạy được bằng một lệnh (Python hoặc Node) và lắng nghe cổng do
engine cấp; spec nên ghi rõ "web app có trang chủ và API" để nút Start có URL mở được.

## 9. Bàn giao cho khách

- `docs/dlc/CUSTOMER-HANDOVER.md` điền IP/cổng/user -> gửi khách (kèm `keycloak-tls.cer`).
- `docs/dlc/FRONTEND-INTEGRATION.md` cho Claude của khách nối FE riêng (client `customer-fe`).
- Cập nhật redirect URI / web origin của client `customer-fe` trong Keycloak admin khi khách có URL FE thật.

## 10. Sự cố thường gặp

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| Trang Keycloak "Cookie not found" | vào bằng http | dùng `https://<IP>:8443` |
| FE đăng nhập xong lỗi gọi token | trình duyệt chưa tin chứng chỉ | cài `keycloak-tls.cer` vào máy demo |
| engine trả 401 mọi lệnh dù đã đăng nhập | issuer lệch (http vs https, IP khác) | `LINE_AUTH_ISSUER` và `SDLC_AUTH_ISSUER` phải đúng `https://<IP>:8443/realms/dlc` |
| engine log "certificate verify failed" | chưa tin chứng chỉ Keycloak | kiểm tra `SSL_CERT_FILE` trong `C:\DLC\services\dlc-engine.xml`; chạy lại install-stack |
| run escalate `LLM_ERROR` ngay | Claude CLI không chạy dưới service, hoặc token hết hạn | đặt token mới (mục 13); xem `C:\DLC\logs\dlc-engine.*.log` |
| KH 403 "no grant on project" | KH exe bản cũ | cài KH build từ main >= `79b0650` |
| Start app `failed` | app sinh ra không chạy được | xem `log_tail` trên FE; kiểm tra Python/Node trên PATH của máy |
| FE không lên | engine chưa chạy (FE phụ thuộc engine) | `Start-Service dlc-engine`, rồi `dlc-fe` |
| Mất / sai mật khẩu admin Keycloak | file `C:\DLC\secrets\keycloak-admin.txt` mất hoặc đã đổi | dừng `dlc-keycloak`, chạy `set KC_ADMIN_PW=<mới>` rồi `C:\DLC\apps\keycloak\bin\kc.bat bootstrap-admin user --username admin2 --password:env KC_ADMIN_PW --no-prompt` (JAVA_HOME = `C:\DLC\apps\jdk21`), start lại, dùng `admin2` (đã thử 12/10) |
| Keycloak không start, báo cổng 9000 bận | Keycloak 26 mở cổng quản trị (health) 9000 | không để dịch vụ khác dùng 9000 trên VPS (KH dùng 9300) hoặc thêm `http-management-port=9001` vào `keycloak.conf` |
| Cần token để test API bằng curl | | `..\keycloak\test-login.ps1 ... -TokenFile C:\DLC\tmp\user.token` ghi access token (15 phút) ra file |

Log: `C:\DLC\logs\` (service wrapper), KH thêm `C:\DLC\apps\kh\logs\app.log`.

## 11. Rollback / gỡ

```powershell
pwsh -File .\uninstall-stack.ps1 -Config .\stack.config.psd1              # gỡ service + firewall, giữ dữ liệu
pwsh -File .\uninstall-stack.ps1 -Config .\stack.config.psd1 -RemoveFiles # xoá sạch C:\DLC (gõ DELETE)
```

Nâng cấp engine + FE: build kit mới (mục 1), copy các zip mới vào `C:\DLC-install`, sửa `DlcZip` / `FeZip`
trong `stack.config.psd1` nếu tên đổi, rồi (Admin):

```powershell
pwsh -File .\upgrade-stack.ps1 -Config .\stack.config.psd1                       # engine + FE
pwsh -File .\upgrade-stack.ps1 -Config .\stack.config.psd1 -WithKnowledgeStore   # thêm KH
```

Script kiểm `SHA256SUMS`, backup bản cũ vào `C:\DLC\backup`, giữ dữ liệu, secrets, token và chế độ chạy. Đổi
cấu hình Keycloak hoặc service thì chạy lại `install-stack.ps1` rồi `seed-stack.ps1` (an toàn khi chạy lại;
client secret được xoay vòng).

## 12. Production sau pilot

- Keycloak: Postgres thay `dev-file`, chứng chỉ thật (domain + Let's Encrypt hoặc CA nội bộ), bỏ bootstrap admin
  sau khi tạo admin thật.
- Sao lưu: `C:\DLC\data`, `C:\DLC\apps\kh` (dữ liệu KH nằm cạnh exe), `C:\DLC\apps\keycloak\data`,
  `C:\DLC\secrets`.

## 13. Key và secrets

Secret trên máy cài nằm trong `C:\DLC\secrets`, `C:\DLC\services` và `C:\DLC\data\dlc\secrets` (chỉ Administrators
+ SYSTEM, cộng tài khoản chạy engine, đọc được). Không gõ secret vào chat, không commit.

| Secret | Ai / cái gì tạo | Nhập hoặc đổi thế nào | Nằm ở đâu |
|---|---|---|---|
| Key ký token của KH `kh-signing-key.pem` | `build-deploy-kit.ps1` tạo 1 lần trên máy build | tự động: `install-stack.ps1` đọc từ `C:\DLC-install` | `C:\DLC\apps\kh\.env`. Xoá bản trong `C:\DLC-install` sau khi cài xong |
| Mật khẩu admin Keycloak (user `admin`) | `install-stack.ps1` tự sinh | đổi trong `https://<IP>:8443/admin`; mất thì xem mục 10 | `C:\DLC\secrets\keycloak-admin.txt` |
| Mật khẩu chứng chỉ https Keycloak | `install-stack.ps1` tự sinh | không cần đụng | `C:\DLC\secrets\keycloak-tls.pass` |
| Client secret để engine gọi KH | `seed-stack.ps1` cấp, xoay mỗi lần chạy lại | chạy lại `seed-stack.ps1` | biến `LINE_RAG_CLIENT_SECRET` trong `C:\DLC\services\dlc-engine.xml` |
| Mật khẩu user demo và user khác | người cài | `seed-stack.ps1` hỏi khi tạo; thêm user: `..\keycloak\new-user.ps1`; đổi trong Keycloak admin | Keycloak |
| Claude token của engine | chạy `claude setup-token` ở terminal bất kỳ, đăng nhập trình duyệt, copy token | lần đầu: `configure-claude-profile.ps1 -Mode Token` (dán khi được hỏi, hoặc `-TokenFile <file>`, file bị xoá sau khi đọc). Đổi sau này, chọn 1 trong 2: **web** Admin > Claude token (thử thật rồi mới lưu, không cần restart); **script** copy token rồi chạy `set-claude-token.ps1` (đọc clipboard, thử, restart engine, xoá clipboard) | web: `C:\DLC\data\dlc\secrets\claude-token`; script: biến `CLAUDE_CODE_OAUTH_TOKEN` của engine. Có file của web thì file đó được dùng |
| Tài khoản Autologin cho agent (Jira, BTP, ...) | người dùng | web Admin > Sidecars > Autologin: thêm entry, chọn nhóm agent được dùng, bấm Test. Mật khẩu chỉ ghi, không đọc lại được | `C:\DLC\data\dlc\secrets\autologin.json`, mật khẩu mã hoá DPAPI theo tài khoản chạy engine |

Autologin: đổi tài khoản chạy engine (ví dụ `engine-as-user.ps1`, mục 14) thì phải nhập lại mật khẩu các entry.
Đăng nhập headless không qua được MFA. Cần Chrome hoặc Edge trên máy.

## 14. Máy cá nhân / máy test

- Engine chạy bằng tài khoản Windows của mình (agent dùng được git, cf, gh, file của mình): 1 lần với quyền
  Admin `pwsh -File .\engine-as-user.ps1` (cài khác `C:\DLC` thì thêm `-Root <thư mục>`); quay lại service:
  thêm `-Revert`.
  Engine thành task `DLC Engine`, chạy khi đăng nhập. Không dùng trên VPS.
- Bật / tắt DLC khi cần mà không phải mở Admin mỗi lần: 1 lần với quyền Admin
  `pwsh -File .\startstop\grant-startstop.ps1 -Config .\stack.config.psd1`, rồi (không Admin)
  `pwsh -File .\startstop\make-shortcuts.ps1` để có shortcut **Start DLC** / **Stop DLC** trên desktop.
- `verify-stack.ps1` hiểu cả 2 chế độ (service hoặc task).

## 15. Biến môi trường của engine (ít khi phải đổi)

Đặt trong `C:\DLC\services\dlc-engine.xml` (chạy service) hoặc môi trường của task `DLC Engine` (mục 14), rồi
restart engine. Không đặt thì dùng mặc định.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `LINE_MERGER` | `auto` | Agent merger gỡ conflict khi rebase unit vào main, hoặc sửa phần ghép khi test nghiệm thu đỏ sau rebase. `auto` = bật khi dùng model thật (`LINE_LLM` khác `fake`), `1` = luôn bật, `0` = tắt (unit conflict quay về builder như trước) |
| `LINE_MERGER_MAX_TURNS` | `40` | Số lượt tối đa của 1 lần gọi merger |
| `LINE_MERGER_MAX_USD` | `2.0` | Tiền tối đa (USD) của 1 lần gọi merger |
| `LINE_MERGER_MAX_CALLS` | `2` | Số lần gọi merger cho 1 unit; quá số này unit quay về builder |
| `LINE_AGENT_RECALL_K` | `3` | Số finding / lesson gần nhất (theo độ giống với task) đưa vào turn context của agent, tính cho mỗi nguồn (findings của project, lessons của project, lessons dùng chung). Chỉ đưa tiêu đề kèm id |
| `LINE_AGENT_RECALL_FLOOR` | `0.6` | Độ giống tối thiểu (0..1) để một finding / lesson được đưa vào; thấp hơn thì bỏ |
| `LINE_AGENT_LEARN` | `1` | `0` = tắt học sau run: distiller cuối run (worklog của agent -> knowledge trong KH) và retro sau run thất bại (finding + lesson dùng chung). Cần KH qua http (`LINE_RAG=http`) và `LINE_AGENT_MEMORY` khác `0`. Distiller chỉ chạy cho project có trong `KH_DISTILL_PROJECTS` của KH (engine hỏi trước, không tốn lượt model) |
| `LINE_ASM` | `auto` | Cho agent mượn session đã đăng nhập của App Session Manager trên máy chạy engine (get_session, cf_login). `auto` = bật khi có file exe, `0` = tắt. Chỉ dùng trên máy cá nhân, không dùng trên VPS khách |
| `LINE_ASM_EXE` | `C:\Programs\ClaudeKH\tools\auto_login\AppSessionManager.exe` | Đường dẫn exe của App Session Manager |
