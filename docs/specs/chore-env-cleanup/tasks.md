# chore-env-cleanup · dọn biến môi trường kit prod/stg-test [CR-159]

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### REMOVED deploy/cr118-rollout.md
#### Yêu cầu: UW-DEP-02 UAT web gộp trên host prod cô lập khỏi prod
Lý do: kit UAT `deploy/stg-cr118/` đã gỡ khỏi repo (UAT CR-118 xong, máy chủ không còn container/volume của kit; staging dùng `deploy/stg-test/`); test tương ứng trong `cr118-deploy-kit.test.ts` đã bỏ.

Không thay đổi hành vi (lý do: dọn cấu hình môi trường)

## Việc làm
- [x] Kiểm kê biến ở env-contract, env.template, 2 gen-env.sh, 2 docker-compose.yml, filebox-env.sh, `.env.example`, `.env.production.example`; đối chiếu nơi code đọc.
- [x] Gỡ biến chết: `CONTRACTS_APPROVAL_ENGINE` khỏi `stg-test/gen-env.sh` + `stg-test/docker-compose.yml` (không code ứng dụng nào đọc; duyệt HĐ luôn chạy trên engine từ cr121-a2); `S2_PORT_COMMUNITY` khỏi allowDiff.
- [x] Mail tắt ở cả hai kit: prod `gen-env.sh` đặt `HUB_NOTIFY_MODE=off` (bản mới + `.env` cũ khi vắng, giữ giá trị đã có); `HUB_SMTP_*`/`SMTP_PASSWORD` chuyển từ «bắt buộc» sang `optional` (chỉ khi live), tên vẫn ở `env.template`.
- [x] `check:env-contract` đọc thêm `docker-compose.yml` (`parseComposeNames`, có test); đăng ký `HUB_PARTNER_MAILBOX`, `HUB_FAST_ROUTE`, `HUB_STICKY_AGENT` (chỉ prod); `CONTRACTS_EXTRACT_TIMEOUT_S`/`CONTRACTS_EXTRACT_READ_TIMEOUT_S` vào `optional` + `env.template`.
- [x] allowDiff ghi lý do (`_allowDiffWhy`), bỏ cảnh báo chênh lệch có lý do.

- [x] Xoá kit cũ `deploy/staging`, `deploy/stg-cr118`, `deploy/stg-sohoptac2` + `e2e/stg/` (4 file, chỉ do các kit đó gọi; smoke staging nay là `deploy/stg-test/e2e-smoke.ps1` → `e2e/deployed`); `cr118-deploy-kit.test.ts` bỏ phần stg-cr118 (giữ phần prod + CR-119); sửa chú thích `stg-test/stg-seed.ts`, `up.sh`, README prod; `test:lock` ghi lại (1552 file, verify OK).

## Quyết định trong lúc làm
- Hai biến CR-155 KHÔNG vào `vars` (mặc định code đúng, đăng ký bắt buộc sẽ buộc đặt giá trị vào kit — trái quyết định cr155 tasks.md:22); vào mục `optional` để tra cứu.
- Cờ dev/test (`HUB_SEED_FIXTURES`, `LOGIN_IP_MAX_ATTEMPTS`, `APP_ENV=development`) đã chỉ nằm ở stg-test, giữ nguyên; prod không có cờ fake/frozen nào.
- Lệch ghi nhận, không sửa (đổi hành vi stg): stg-test chưa đặt `HUB_STICKY_AGENT` (prod bật).
- `tools/demo/purchase-templates-stack.ts:57` còn đặt `CONTRACTS_APPROVAL_ENGINE` (vô nghĩa, ngoài phạm vi kit) — để điều phối quyết.
- `verify:predeploy` không chạy được trên máy này: cần khoá ssh `F:\workspace\id_evoc_key` (đọc VERSION prod); không đụng.
