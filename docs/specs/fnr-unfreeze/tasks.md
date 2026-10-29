---
id: fnr-unfreeze
lát: fnr-unfreeze
cr: CR-103
làn: đầy đủ (quyền — mở route + chặn role); phần admin-web nav: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Prod tắt module đóng băng (`HUB_FROZEN_MODULES` vắng ⇒ off ⇒ Hub không mount route quy trình ⇒ 404), nên editor quy trình và
trang `/processes/showcase` của admin-web không chạy. Thêm chế độ route công khai quy trình ba giá trị `off | admin | all`
(`HUB_PROCESS_ROUTES`); `admin` mở đúng phần admin-web cần, chặn bằng **role trong JWT** (`requireAdminRole`: tenant_admin +
platform_admin) ở gốc mọi tiền tố quy trình. Không dựa `X-App` (client tự đặt, admin-web chỉ gửi ở `/auth/*`). chat-web giữ đóng băng.

## Làm
- [x] Test int viết TRƯỚC code (Luật 1b): `apps/hub-api/src/modules/processes/routes-mode.int.test.ts` — admin: member 403
  (`/process-defs`, `/process-runs`, `/process-runs/:id`, quyết định review), tenant_admin/platform_admin 200; route đóng băng
  (`/me/process-inbox`, `/me/review-tasks`, `/review-tasks/:id/answer`, `/admin/sources`, `/rooms`) vẫn 404; `off`/`all` như cũ.
- [x] `routes-mode.ts` (luật thuần `resolveProcessRoutes`) + unit `routes-mode.test.ts`; env `HUB_PROCESS_ROUTES` (env.ts,
  env-deps.ts, `AppDeps.processRoutes`); `processes.mount.ts` `mountRoutes(mode)`; `app.ts` truyền chế độ.
- [x] admin-web: `probeEngine` luôn dò `/process-defs` (bỏ chặn theo cờ build); `nav.ts` bỏ `/processes` khỏi `FROZEN_PREFIXES`,
  mục "Quy trình" theo kết quả dò, "Nguồn" vẫn cần cờ build; unit `nav.test.ts`.
- [x] `docs/platform/modules.md`, `.env.example`.

## Không làm / Chạm
- Không đổi RLS, không đổi luật quyền task (duyệt review ở showcase: admin vẫn phải thuộc nhóm duyệt).
- Không sửa node/defs/editor (lát khác); không sửa `deploy/**` hay secret prod; không push/merge/deploy.
- Nguồn (`/admin/sources*`, `/process-runs/sources`), asks, hộp thư `/me/*`, phòng, DLC vẫn không mount ở `admin`.

## Test tối thiểu
- unit: `routes-mode.test.ts`, `admin-web/.../nav.test.ts`.
- int: `bun run test:int:par apps/hub-api/src/modules/processes/routes-mode.int.test.ts`.

## Quyết định trong lúc làm
- Tên biến `HUB_PROCESS_ROUTES` (cùng họ `HUB_PROCESS_ENGINE`); đặt rõ thắng `HUB_FROZEN_MODULES`, vắng ⇒ on ⇒ `all`, off ⇒ `off`
  (mặc định prod không đổi: vẫn `off`). Prod không có `HUB_PROCESS_ENGINE`/`*_FROZEN_MODULES` trong `deploy/prod-sohoptac2` ⇒
  cần đặt tay trong `.env` server (xem Việc còn lại).
- Chế độ `admin` mount thêm `usage` (`/process-runs/:id/usage`) và `gates` (cancel/decide + `/review-tasks/:id/decision`): trang
  lượt chạy admin-web dùng tab Token + nút huỷ/quyết định; showcase cần duyệt review. Vẫn sau `requireAdminRole`.
- Chặn role đăng ký bằng `app.use` ở gốc 6 tiền tố (`PROCESS_PROTECTED_PREFIXES`) SAU `requireAuth`; không route nào khác đăng ký
  trước dưới các tiền tố này ở chế độ `admin` (nguồn chỉ mount khi `HUB_FROZEN_MODULES=on`).
- admin-web: dò lúc chạy thay vì thêm cờ build mới ⇒ prod chưa đặt `admin` sẽ có một 404 `/process-defs` trong console admin (5 phút
  một lần) — chấp nhận, đổi lại không cần build lại admin-web khi bật/tắt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Editor quy trình cho admin
Khi Hub chạy với `HUB_PROCESS_ROUTES=admin`, route quy trình của editor/lượt chạy (`/process-defs*`, `/agent-teams`,
`/process-editor/context`, `/processes`, `/process-runs*` gồm usage/cancel/decide, `/review-tasks/:id/decision`) được mount và chỉ
mở cho tenant_admin/platform_admin (role trong JWT); hộp thư quy trình và asks của chat-web vẫn không mount. admin-web hiện mục
"Quy trình" khi Hub trả 200 cho `GET /process-defs`, không phụ thuộc cờ build `PUBLIC_FROZEN_MODULES`.
- Kịch bản: khi `HUB_PROCESS_ROUTES=admin` và tenant_admin hoặc platform_admin gọi `GET /process-defs` hoặc `GET /process-runs` thì Hub trả 200.
- Kịch bản: khi `HUB_PROCESS_ROUTES=admin` và member gọi `GET /process-defs`, `GET /process-runs`, `GET /process-runs/:id` hoặc `POST /review-tasks/:id/decision` thì Hub trả 403 FORBIDDEN.
- Kịch bản: khi `HUB_PROCESS_ROUTES=admin` và bất kỳ ai gọi hộp thư chat-web (`GET /me/process-inbox`, `GET /me/review-tasks`) hoặc `POST /review-tasks/:id/answer` thì Hub trả 404 (vẫn đóng băng).
- Kịch bản: khi `HUB_PROCESS_ROUTES` vắng thì hành vi như cũ (`HUB_FROZEN_MODULES=on` ⇒ mọi route, off ⇒ 404).

## Việc còn lại
- **Prod (sohoptac2), người dùng đặt tay khi deploy** (không sửa secret trong lát): thêm vào `.env` server
  `HUB_PROCESS_ROUTES=admin` và `HUB_PROCESS_ENGINE=on` (nếu chưa có — engine tắt thì không route quy trình nào mount), rồi
  khởi động lại hub-api. Không đổi `PUBLIC_FROZEN_MODULES` (chat-web vẫn đóng băng); admin-web cần build lại để có thay đổi nav.
- Lát showcase (`/processes/showcase`): bọc trang bằng `ProcessRouteGate`; không gọi API nguồn/hộp thư (404 ở `admin`).
- Editor: phần chọn nguồn (`/admin/sources*`) sẽ 404 ở chế độ `admin` — kiểm khi UAT.
- Nợ: `GET /process-runs/<không-phải-uuid>` trả 500 thay vì 404 (thấy khi `/process-runs/sources` không mount; chỉ admin gặp ở `admin`) — để lát runs/defs sửa (validate uuid ở `view.get`), ngoài phạm vi lát này.
