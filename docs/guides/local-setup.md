# Chạy AI System trên máy mới (lõi + Sổ Hợp Tác + Community)

Một lệnh dựng đủ: admin-api, hub-api và 5 web. Chỉ dùng cho máy dev; deploy xem `deploy.md`.

## Cần cài

| Công cụ | Ghi chú |
|---|---|
| Git | clone repo |
| Bun 1.3+ | https://bun.sh |
| Docker Desktop | Postgres 16 + Redis 7 qua `compose.yaml` (cổng chỉ mở 127.0.0.1). Đã có Postgres :5432 + Redis :6379 chạy sẵn thì không cần. |

## Chạy

```powershell
git clone https://github.com/evolu-consulting/AI-System.git
cd AI-System
git checkout platform/gd0
powershell -ExecutionPolicy Bypass -File scripts\dev-up.ps1
```

Script tự làm, chạy lại an toàn:
1. `bun install` (lần đầu).
2. Tạo `.env.local` từ `.env.example` bằng `bun run keys:dev`: sinh khoá JWT, khoá secret, mật khẩu platform admin (không in ra màn hình). `.env.local` nằm trong `.gitignore`, không commit.
3. Postgres + Redis: dùng cái đang chạy, chưa có thì `docker compose up -d --wait`.
4. `db:migrate` + `db:seed` (tenant `platform` + platform admin).
5. `hub:dev`: admin-api :3001, tenant demo `evolu` + 5 user, `hub:seed`, hub-api :4000 (không bật agent-runtime).
6. Bật gói **Sổ Hợp Tác** (`contracts`) và **Community** cho `evolu`, đưa user demo vào nhóm của gói.
7. 5 web dev server.

| App | URL |
|---|---|
| ai-admin (quản trị) | http://localhost:3000 |
| Chat | http://localhost:3100 |
| Studio (Agent Hub) | http://localhost:3200 |
| Sổ Hợp Tác | http://localhost:3300 |
| Community | http://localhost:3400 |
| admin-api / hub-api | http://localhost:3001 · http://localhost:4000 |

Tắt: `scripts\dev-down.ps1` (Postgres/Redis vẫn chạy; tắt bằng `docker compose stop`). Log: `.data\dev-up\*.log`.

## Tài khoản

| Đăng nhập | Mã công ty | Tài khoản | Mật khẩu |
|---|---|---|---|
| Platform admin (ai-admin) | `platform` | `admin` | `SEED_ADMIN_PASSWORD` trong `.env.local` |
| Demo, chủ gói (tenant_admin) | `evolu` | `julian.bui` | `1234567890` (mật khẩu dev cố định trong `tools/hub-dev/src/fixture.ts`) |
| Demo, thành viên (editor) | `evolu` | `thomas.tran`, `vio.ngo`, `edgar.nguyen`, `rowan.nguyen` | như trên |

Chỉ dùng trên máy dev; không dùng các mật khẩu này ở môi trường khác.

## Tuỳ chọn

| Lệnh | Tác dụng |
|---|---|
| `scripts\dev-up.ps1 -Only core` | chỉ admin-api + hub-api |
| `scripts\dev-up.ps1 -DbName ai_system_try` | chạy trên DB riêng (tự tạo), không đụng DB `ai_system` |
| `scripts\dev-up.ps1 -Fresh` | xoá DB dev rồi dựng lại (mất dữ liệu dev) |

## AI thật (tuỳ chọn)

Mặc định không gọi AI. Muốn trợ lý chat/Sổ Hợp Tác dùng Claude: xem `hub-dev.md` (agent-runtime + `claude-sub` trong WSL) và các biến `AI_PROVIDER`, `AGENT_RT_*` trong `.env.example`.

## Lỗi hay gặp

- `db:setup lỗi (migrate-guard lệch …)`: DB dev từng chạy migration của nhánh khác. Dùng `-DbName <tên mới>` hoặc `-Fresh`.
- `Có phiên dev-up đang chạy`: chạy `scripts\dev-down.ps1` trước.
- Cổng 3000–3400/3001/4000 bị chiếm: tắt tiến trình đang giữ cổng rồi chạy lại.
