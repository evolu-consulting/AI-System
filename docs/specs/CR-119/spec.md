---
id: CR-119
requirements: UW-DEP-04..06
design: ../../adr/0034-web-hop-nhat.md
trạng thái: Đang làm (chưa push/deploy); 2026-11-05: bỏ host sohoptac, không còn cờ S2_APP_HOST_LIVE
---
# CR-119 · Chuẩn tên miền: host trung tính `app.<d>` + đường dẫn theo app

## 1. Vì sao
Sau CR-118 web gộp phục vụ cả Sổ Hợp Tác (SHT) và Community nhưng vẫn mang tên `sohoptac.<d>` — gây hiểu nhầm với người dùng Community/đối tác. Chuẩn mới:
**một host vỏ trung tính cho web gộp + đường dẫn theo app**: `app.<d>` (test: `app-test.<d>`); SHT ở gốc (`/`, `/overview`…), Community ở `/community`.
Admin (`ai-admin`), Chat (`ai`), Hub/Studio (`ai-hub`) giữ nguyên. Đường dẫn không đổi ⇒ web, SPA, cookie `Path=/auth`, link thông báo không phải sửa logic.

## 2. Hành vi
| Mục | Mô tả |
|---|---|
| UW-DEP-04 host duy nhất | Edge có `app`/`app-test` phục vụ web gộp (nginx `web:8081`). `sohoptac[-test].<d>` **không còn** server_name/301 (quyết định 2026-11-05). |
| UW-DEP-05 community 301 | `community[-test].<d>` giữ **301 cố định** → `https://app[-test].<d>/community` (đích từ domain cấu hình theo `$host` đã khớp `server_name` + `__BASE__`, không bao giờ lấy từ Host của client) + proxy API cho tab cũ tới mốc sunset 30 ngày (~2026-12-05), sau đó gỡ server `community` + DNS. Không còn cờ `S2_APP_HOST_LIVE`. |
| UW-DEP-06 URL/CORS/catalog | `gen-env.sh`: `S2_PUBLIC_CONTRACTS_URL`/`COMMUNITY_WEB_URL`/`APP_URL_*`/`OPS_PUBLIC_URLS` = `app[-test].<d>` vô điều kiện; `CORS_ORIGINS`/`HUB_CORS_ORIGINS` gồm `app*`, `community*` (tab cũ), `ai*` + localhost (không còn `sohoptac*`); khoá `S2_APP_HOST_LIVE` cũ trong `.env` bị xoá. `s2-app-urls.ts --base-domain <d> --hosts prod\|test` đặt catalog `contracts`=`https://app.<d>`, `community`=`https://app.<d>/community` vô điều kiện (idempotent, thay cả hàng còn `sohoptac*`/`community*`/localhost). Link "mở app" của admin-web/chat-web/studio đọc catalog (`/me/apps`). |

## 2b. Quyết định 2026-11-05: bỏ host sohoptac
Người dùng chốt: `sohoptac.<d>`/`sohoptac-test.<d>` không còn dùng; web gộp chỉ ở `app.<d>`/`app-test.<d>`. Kéo theo: (1) đổi tên app/package `apps/sohoptac-web` → `apps/workspace-web` (`@ai/workspace-web`; job e2e `sohoptac-web-stack` → `workspace-web-stack`); tên hiển thị sản phẩm "Sổ Hợp Tác" giữ nguyên; (2) kit deploy: bỏ `sohoptac*` khỏi edge-lib/gen-env/enable-domain/cutover/CORS/URL công khai, bỏ cờ `S2_APP_HOST_LIVE` và `deploy.ps1 -AppHostLive`; (3) tên thư mục `deploy/prod-sohoptac2`, project Docker `sohoptac2`, volume, `~/workspace/sohoptac2` **giữ nguyên**.

## 3. Chuyển đổi
Runbook: deploy/prod-sohoptac2/README.md mục "Deploy CR-119". Tóm tắt: A tạo DNS pp/pp-test + mở rộng cert; B deploy kit, cutover.sh, s2-app-urls.ts --apply. Rollback = deploy lại ref trước CR-119 + đặt tay 2 hàng catalog (301 max-age=86400).
Sau đó (CR riêng): đưa SHT về tiền tố `/contracts` (app.<d>/contracts) để mọi app đối xứng; `app.<d>/` thành trang chọn app. Chưa làm trong CR-119.

## 4. Không làm
Không đổi đường dẫn SPA, không đổi cổng/compose, không đổi mã app, không migration; DNS/cert do người dùng làm.