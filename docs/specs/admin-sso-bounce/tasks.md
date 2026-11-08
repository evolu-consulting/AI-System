---
id: admin-sso-bounce
lát: admin-sso-bounce
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi prod sohoptac2: từ Evolu Control (admin-web) sang Sổ Hợp Tác (contracts-web) bị hỏi đăng nhập.

Nguyên nhân (đọc code):
- Mỗi web có cookie refresh riêng theo host (`ai_rt_<app>`, `Path=/auth`, SameSite=Strict); sang web khác chỉ giữ phiên bằng mã
  SSO một lần (`/auth/sso/code` → `<đích>/sso#code=…`). App switcher của admin-web làm đúng (`Topbar.tsx` `handOffUrl`); int mới xác
  nhận đường platform_admin admin-web → contracts đổi mã được.
- Link "Cấu hình trong Sổ Hợp Tác" ở màn Agents (`BackgroundAgentsTable.tsx` CapCell) mở thẳng `app.url` (tab mới, không mã) ⇒
  contracts-web không có phiên ⇒ `guard.ts` dội sang `PUBLIC_SSO_URL` = AI System (chat-web) ⇒ người chỉ đăng nhập admin-web không
  có phiên chat-web ⇒ form đăng nhập AI System. Cùng hệ quả khi mở Sổ Hợp Tác bằng Ctrl/giữa-click trên switcher hoặc gõ URL.

## Làm
- [x] `features/shell/lib/open-app.ts` `appOpenUrl` (thuần) + `hooks/use-apps.ts` `openApp`: link ra app khác xin mã SSO như switcher.
- [x] CapCell (màn Agents) click thường ⇒ `openApp(app, "/", true)` (tab mới; popup bị chặn ⇒ mở ở tab này).
- [x] int: platform_admin đăng nhập admin-web ⇒ mã cho contracts ⇒ đổi mã được (`sso.int.test.ts`).

## Không làm / Chạm
- Không đổi cấu hình deploy (nginx/cookie domain/CORS): không cần.
- Không đổi nguồn SSO dự phòng của contracts-web (vẫn chỉ AI System). Cần quyết định (xem Việc còn lại).

## Test tối thiểu
- unit `apps/admin-web/src/features/shell/lib/open-app.test.ts`; int `apps/admin-api/src/modules/auth/sso/sso.int.test.ts`.

## Quyết định trong lúc làm
- Mở tab mới bằng `window.open` không `noopener` rồi `opener = null` (có `noopener` thì luôn trả null, không biết popup bị chặn).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Link từ admin-web sang app khác giữ phiên
Link trong admin-web mở một app có SSO (vd "Cấu hình trong Sổ Hợp Tác" ở màn Agents) chuyển phiên bằng mã một lần như app switcher, không mở thẳng URL app.
- Kịch bản: khi người đã đăng nhập admin-web bấm link sang Sổ Hợp Tác thì đích là trang /sso của Sổ Hợp Tác kèm mã một lần [test: apps/admin-web/src/features/shell/lib/open-app.test.ts » có phiên admin ⇒ trang /sso của Sổ Hợp Tác kèm mã một lần]
- Kịch bản: khi platform_admin đăng nhập admin-web xin mã cho contracts thì contracts đổi mã lấy phiên được [test: apps/admin-api/src/modules/auth/sso/sso.int.test.ts » platform_admin đăng nhập admin-web ⇒ mã cho contracts ⇒ phiên contracts]

## Việc còn lại
- Quyết định: contracts-web không phiên chỉ dội sang AI System (chat-web). Người chỉ đăng nhập admin-web mở Sổ Hợp Tác bằng URL/
  tab mới vẫn thấy form đăng nhập. Phương án: (a) giữ nguyên (đề xuất — Sổ Hợp Tác dùng đăng nhập chung AI System); (b) thêm chế độ
  nguồn `/sso?app=` cho admin-web và để contracts-web chọn nguồn theo `document.referrer` (thêm một nguồn SSO, cần duyệt).
- Kiểm trên prod: hàng catalog `contracts` phải là `https://sohoptac.evoluconsulting.com` (origin sai ⇒ đổi mã 401 ⇒ form đăng nhập).
