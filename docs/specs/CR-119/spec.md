---
id: CR-119
requirements: UW-DEP-04..06
design: ../../adr/0034-web-hop-nhat.md
trạng thái: Đang làm (chưa push/deploy); cờ S2_APP_HOST_LIVE mặc định 0
---
# CR-119 · Chuẩn tên miền: host trung tính `app.<d>` + đường dẫn theo app

## 1. Vì sao
Sau CR-118 web gộp phục vụ cả Sổ Hợp Tác (SHT) và Community nhưng vẫn mang tên `sohoptac.<d>` — gây hiểu nhầm với người dùng Community/đối tác. Chuẩn mới:
**một host vỏ trung tính cho web gộp + đường dẫn theo app**: `app.<d>` (test: `app-test.<d>`); SHT ở gốc (`/`, `/overview`…), Community ở `/community`.
Admin (`ai-admin`), Chat (`ai`), Hub/Studio (`ai-hub`) giữ nguyên. Đường dẫn không đổi ⇒ web, SPA, cookie `Path=/auth`, link thông báo không phải sửa logic.

## 2. Hành vi
| Mục | Mô tả |
|---|---|
| UW-DEP-04 host mới | Edge có `app`/`app-test` phục vụ web gộp (nginx `web:8081`) song song với `sohoptac[-test]` — không cần DNS/cert để triển khai (chưa có DNS thì host đó chưa vào được, các host khác không đổi). |
| UW-DEP-05 cờ chuyển | `S2_APP_HOST_LIVE` (mặc định `0`; lưu trong `.env`): `0` = `sohoptac.<d>` vẫn phục vụ như cũ, `community.<d>` 301 → `sohoptac.<d>/community`, URL công khai (build web, hub/admin env, catalog) giữ `sohoptac`. `1` = `sohoptac[-test].<d>` 301 → `https://app[-test].<d>$request_uri` (giữ path+query), `community[-test].<d>` 301 → `app[-test].<d>/community`, URL công khai = `app`. Đích 301 là **domain cấu hình cố định** (map theo `$host` đã khớp `server_name` + `__BASE__`), không bao giờ lấy từ Host của client. |
| UW-DEP-06 URL/CORS/catalog | `gen-env.sh`: `CORS_ORIGINS`/`HUB_CORS_ORIGINS` luôn gồm cả `app*` và `sohoptac*` (+ community cũ, localhost) trong giai đoạn chuyển; `S2_PUBLIC_CONTRACTS_URL`/`COMMUNITY_WEB_URL`/`APP_URL_*` theo cờ. `s2-app-urls.ts --base-domain <d> --hosts prod\|test --app-host` đặt catalog `contracts`=`https://app.<d>`, `community`=`https://app.<d>/community` (idempotent, thay cả hàng còn `sohoptac*`). Link "mở app" của admin-web/chat-web/studio đọc catalog (`/me/apps`), không hardcode host. |

## 3. Chuyển đổi
1. Triển khai kit với cờ `0` → `app.<d>` có sẵn ở edge nhưng chưa dùng. 2. Người dùng tạo DNS `app`/`app-test` + mở rộng cert (`certbot --expand`). 3. Đặt `S2_APP_HOST_LIVE=1`: `gen-env.sh` + build lại web + `cutover.sh` (render edge) + `s2-app-urls.ts --app-host --apply`. Rollback: đặt lại `0`, chạy lại các bước (301 `max-age=86400`).
Sau đó (CR riêng): đưa SHT về tiền tố `/contracts` (app.<d>/contracts) để mọi app đối xứng; `app.<d>/` thành trang chọn app. Chưa làm trong CR-119.

## 4. Không làm
Không đổi đường dẫn SPA, không đổi cổng/compose, không đổi mã app, không migration; DNS/cert do người dùng làm.