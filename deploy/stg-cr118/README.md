# stg-cr118 — UAT web gộp CR-118 trên host prod, CÔ LẬP

Chạy **trên cùng máy** `149.202.83.5` (để UAT đúng môi trường Docker/nginx của prod) nhưng không đụng prod:

| Mục | Giá trị | Vì sao |
|---|---|---|
| Project Docker | `sohoptac2-cr118` (mạng, container, tmpfs riêng) | không trộn với `sohoptac2` / `sohoptac2-stg` |
| Image | `sohoptac2-app:cr118`, `sohoptac2-web:cr118` — **không bao giờ `:latest`** | prod nhận `:latest` ở lần restart sau |
| Cổng | `127.0.0.1:28531` SHT+Community · `28532` admin · `28533` chat · `28534` hub/Studio · `28535` community.<d> cũ (301) | khác prod 1843x, stg 2843x |
| Dữ liệu | Postgres/Redis/FileBox/MinIO **tmpfs** (mất khi `down -v`), bí mật sinh mới bằng `openssl` | không copy gì của prod |
| Dùng lại, chỉ đọc | `sohoptac2-filebox:latest`, `sohoptac2-runtime:latest` (CR-118 không đổi) + một file `minio-bin/minio` | không build lại; `down.sh` KHÔNG xoá chúng |
| Truy cập | chỉ SSH tunnel | không public, không domain/TLS |

Chạy khi người dùng xác nhận UAT (không nằm trong deploy prod). Không cần quyền sửa host nginx/edge.

## Quy trình
```
# 1) từ máy dev (đẩy mã nhánh + kit; chưa build/chạy gì)
powershell -File deploy/stg-cr118/push.ps1 -Ref <nhánh/commit> [-DryRun]
# 2) trên host
cd ~/workspace/sohoptac2-cr118
bash build.sh [--dry-run]     # docker compose build admin-api web  → hai image :cr118 (từ chối nếu image không phải cr118)
bash up.sh    [--dry-run]     # gen-env (một lần) → pg/redis/filebox → migrate → seed → admin/hub/agent/web → s2-app-urls (community /community, sso=false) → kiểm nhanh
# 3) tunnel (máy dev)
ssh -i F:\workspace\id_evoc_key -N -L 28531:127.0.0.1:28531 -L 28532:127.0.0.1:28532 -L 28533:127.0.0.1:28533 -L 28534:127.0.0.1:28534 -L 28535:127.0.0.1:28535 evoc@149.202.83.5
# 4) dọn (BẮT BUỘC sau UAT)
bash down.sh [--dry-run] [--rm-dir]
```
`--dry-run` ở mọi script chỉ in lệnh (không gọi docker, không ghi file). Kiểm cấu hình offline: `bun test tools/scripts/src/cr118-deploy-kit.test.ts`.

## UAT (spec CR-118 §9) — http://127.0.0.1:28531
Tài khoản: platform admin `admin` (mật khẩu ở `ADMIN.pw`), chủ quản `demo-owner` (`DEMO_OWNER.pw`), đối tác trong `out/partners.json`
(mật khẩu tạm), thành viên thường = tạo trong admin-web (28532) bằng admin. Đọc mật khẩu bằng `cat` trên host, không dán vào chat/commit.
1. Chủ quản (admin/owner): chuyển Community ↔ Sổ Hợp Tác **không tải lại trang** (một dấu gán tạm lên `window` trong console vẫn còn sau điều hướng).
2. Tắt Community ở Admin → Ứng dụng/năng lực ⇒ mục nav Community biến mất sau khi cấu hình đổi (SSE `config.changed`, ≤ vài giây).
3. Đối tác: đăng nhập một lần, vào `/community`; gõ `/contracts` ⇒ bị chặn (không có SHT); `/community/profile/<org>/<section>` tải lại trực tiếp = 200 (history fallback).
4. Hash cũ: mở `http://127.0.0.1:28531/community#/feed`, `#/profile/<o>/<s>`, `#/settings` ⇒ ánh xạ đúng.
5. 301: `curl -sI -H 'Host: community.example.test' http://127.0.0.1:28535/` ⇒ `301`, `Location: https://sohoptac.example.test/community`; `/auth/`, `/pack/` trên 28535 vẫn proxy (tab cũ).
6. Link báo giá/thông báo từ hub dùng `/community` (không `#/feed`): `COMMUNITY_WEB_URL=http://127.0.0.1:28531/community`.
Giới hạn: không HTTPS/domain ⇒ cookie `Secure`/SSO khác prod chỉ ảnh hưởng đúng kiểu đã có ở stg-sohoptac2 (APP_ENV=development).

## Dọn sau UAT (`down.sh` + nhắc lại)
`down.sh` = `docker compose -p sohoptac2-cr118 down -v --remove-orphans` + `docker rmi sohoptac2-app:cr118 sohoptac2-web:cr118` rồi in số container/volume/image còn lại (mong 0). Sau đó
`--rm-dir` (xoá `.env`, mật khẩu, `build/`). Máy dev: `bun run e2e:reap`, `bun run e2e:lanes --prune`, xoá worktree slice (kiểm đĩa F:).
**Không** `docker image prune -a` / `docker system prune` trên host (xoá image prod).

## Chống nhầm prod (tự kiểm)
- Tên project + tag cố định trong `lib.sh` (không đọc env); `guard_tag` thoát khi gặp `:latest`; `build.sh` so `docker compose config --images` phải đúng hai image cr118.
- `docker-compose.yml`: mọi cổng `127.0.0.1:2853x`, không volume host ngoài thư mục kit, không `claude-home`, tmpfs cho DB.
- `stg-seed.ts` từ chối khi `APP_ENV=production` hoặc URL admin không phải `127.0.0.1:285xx`.
- Test: `tools/scripts/src/cr118-deploy-kit.test.ts` kiểm các bất biến trên (tag, cổng, project, không `down` project khác).
