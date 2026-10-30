# DEPLOY RUNBOOK (LINUX) — KH + Keycloak + DLC engine + FE mặc định trên một máy Linux (INTERNAL - do not ship to customers)

Bản Linux của `DEPLOY-RUNBOOK.md` (Windows). Cùng 4 thành phần, cùng cổng mặc định, cùng realm Keycloak; khác ở
chỗ mỗi thành phần là một **systemd service** và script là bash.

Hai chế độ cài (`SERVICE_MODE` trong `stack.config.env`):

| Chế độ | Khi nào | Quyền | Service |
|---|---|---|---|
| `system` | server riêng cho khách | root (`sudo`) | `/etc/systemd/system/dlc-*.service`, chạy dưới user `dlc` |
| `user` | máy dùng chung, không có root (vd host demo) | user thường | `~/.config/systemd/user/dlc-*.service`, cần linger (`loginctl enable-linger`) |

Bài học riêng của Linux (đọc trước):

1. **Firewall**: cổng của container Docker được publish thì đi vòng qua ufw, nhưng process chạy trực tiếp trên
   host thì không. Sau khi cài, thử mở `http://<IP>:8795` từ **máy khác**. Nếu không vào được thì mở cổng (root:
   `ufw allow 8795/tcp` ...; installer tự làm khi chạy bằng root và ufw/firewalld đang bật) và security group của
   nhà cung cấp.
2. Keycloak 26 mở thêm cổng quản trị (health), mặc định 9000. Kit dùng `KEYCLOAK_MGMT_PORT` (mặc định 9001).
3. Engine/FE tin chứng chỉ tự ký của Keycloak qua `SSL_CERT_FILE=<root>/config/ca-bundle.pem` (CA hệ thống +
   chứng chỉ Keycloak). Chế độ `system` còn cài chứng chỉ vào trust store của máy (`update-ca-certificates`).
4. Claude cho engine: `configure-claude.sh --mode token|login|user`. `user` = engine chạy bằng chính user đang
   cài và dùng luôn sign-in Claude Code có sẵn của user đó (`~/.claude`), hợp với host đã cài sẵn Claude CLI.
5. File env của service (`<root>/services/*.env`, mode 600) chứa secret (client secret KH, token Claude, mật khẩu
   admin Keycloak lúc bootstrap). Không chia sẻ thư mục này.

## 1. Build kit (máy build Windows có Docker Desktop)

```powershell
cd Slaves\SDLC\deploy
pwsh -File .\build-deploy-kit-linux.ps1 -Out E:\lw\dlc-kit-linux `
     -LessonsFile ..\docs\internal\deploy\seed\lessons-customer.json `
     -KeycloakZipFrom E:\lw\dlc-kit\keycloak-26.0.7.zip     # tuỳ chọn, tránh tải lại
```

Build trong Docker (Debian bookworm, glibc 2.36): `dlc-0.1.0-linux-x64.tar.gz` (~11 MB), `dlc-fe-0.2.0-linux-x64.tar.gz`
(~9 MB), `KnowledgeHub-linux-x64.tar.gz` (~840 MB, torch CPU). Build dừng nếu có file `.py` của mình lọt vào gói.
Kit còn có JDK 21 Linux, Keycloak 26.0.7, `kh-signing-key.pem` (bí mật), `lessons-customer.json`, `SHA256SUMS`,
`kit/linux/*` (scripts), `kit/keycloak/realm-dlc.template.json`.

## 2. Yêu cầu trên server

Debian 12+/Ubuntu 22.04+/RHEL 9+ x64, systemd, `python3` 3.10+, `git`, `curl`, `tar`, `unzip`, `openssl`; Claude
Code CLI (`curl -fsSL https://claude.ai/install.sh | bash`); RAM 8 GB, 4 vCPU, 40 GB trống. Node.js chỉ khi target là
JS/TS.

## 3. Copy kit + cấu hình

```bash
# từ máy build (Git Bash): tar -cf - dlc-kit-linux | ssh user@host 'mkdir -p ~/dlc-install && tar -xf - -C ~/dlc-install --strip-components=1'
cd ~/dlc-install && sha256sum -c SHA256SUMS && chmod +x kit/linux/*.sh
cp kit/linux/stack.config.example.env kit/linux/stack.config.env && nano kit/linux/stack.config.env
```

Đặt `PUBLIC_HOST`, `SERVICE_MODE`, kiểm tra các cổng chưa bị chiếm (`ss -ltn`). Cổng mặc định: 8443 Keycloak,
9001 Keycloak mgmt, 9300 KH (127.0.0.1), 8796 engine, 8795 FE, 9100-9199 app.

## 4. Cài + Claude + seed + verify

```bash
cd ~/dlc-install/kit/linux
./install-stack.sh   --config ./stack.config.env                  # system mode: sudo ./install-stack.sh ...
./configure-claude.sh --config ./stack.config.env --mode user     # hoặc --mode token / --mode login
DLC_USER_PASSWORD='<mật khẩu demo>' ./seed-stack.sh --config ./stack.config.env \
     --lessons ../../lessons-customer.json --user demo --roles dlc-user,dlc-admin
DLC_USER_PASSWORD='<mật khẩu demo>' ./verify-stack.sh --config ./stack.config.env --user demo          # không tốn tiền model
DLC_USER_PASSWORD='<mật khẩu demo>' ./verify-stack.sh --config ./stack.config.env --user demo --demo   # + 1 run thật (~$1, 4-10 phút)
```

Checkpoint: install in `Keycloak up`, `KH up`; configure-claude in `claude -p answers: ready`; seed in
`lessons: stored 367 ... failed 0`, `engine up`, `frontend up`; verify in `all checks passed`.

Quản lý service: `systemctl [--user] status|restart dlc-keycloak dlc-kh dlc-engine dlc-fe`; log ở `<root>/logs/*.log`
(KH thêm `<root>/apps/kh/logs/app.log`).

## 5. Demo, bàn giao, sự cố

Như `DEPLOY-RUNBOOK.md` mục 8-10 (máy demo tin `config/keycloak-tls.cer`, vào `http://<IP>:8795`, ...). Riêng Linux:

| Triệu chứng | Xử lý |
|---|---|
| Từ ngoài không vào được 8795/8443 nhưng `curl` trên server được | firewall (ufw/firewalld/security group), xem bài học 1 |
| `systemctl --user` báo lỗi "Failed to connect to bus" khi SSH | `export XDG_RUNTIME_DIR=/run/user/$(id -u)` |
| Service user mode tắt khi logout | `sudo loginctl enable-linger <user>` |
| Keycloak không lên, log báo port bận | đổi `KEYCLOAK_MGMT_PORT` / `KEYCLOAK_HTTPS_PORT`, chạy lại install |
| Cài lại / upgrade báo `Permission denied` (jdk21/legal) hoặc `Text file busy`, route mới vẫn 404 | kit cũ trước 12/10: JDK có file read-only, chương trình đang chạy không ghi đè được. Script hiện tại tự `chmod u+w`, tự dừng service trước khi giải nén rồi bật lại engine/FE (gặp ngày 12/10 trên host demo) |
| Sau khi cài lại, engine không tìm được lesson/KH | kit cũ đặt lại `LINE_RAG=off`; script hiện tại giữ giá trị cũ. Với kit cũ: chạy lại `seed-stack.sh` |

## 6. Upgrade một phiên bản mới

1. Build kit mới (mục 1), copy các tarball đổi (`dlc-*`, `dlc-fe-*`, KH nếu đổi) + `SHA256SUMS` + `kit/linux/*` lên thư mục kit trên server.
2. `sha256sum -c SHA256SUMS`, kiểm tra không có run đang chạy (`/api/runs`), rồi `./install-stack.sh --config ./stack.config.env`
   (giữ dữ liệu, secret, chứng chỉ, kết nối KH; không cần seed lại).
3. `./verify-stack.sh --config ./stack.config.env --user demo` và thử tính năng mới.

Gỡ: `./uninstall-stack.sh --config ./stack.config.env [--remove-files]`.
