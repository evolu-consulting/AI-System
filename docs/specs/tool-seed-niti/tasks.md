---
id: tool-seed-niti
lát: tool-seed-niti
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-route-kind (đã merge)
---
## Plan (ngắn)
`tools/scripts/src/seed-niti.ts [--apply]` nạp tenant thật "NiTi Group" qua CHÍNH service của admin-api/hub-api: `onboardTenant`
(tenant + gói contracts/community + cây phòng ban + trưởng phòng/thành viên), `createUser` (mật khẩu tạm ngẫu nhiên, must_change),
`grantGroup` (vai gói), `LibraryService.clone/publish` + `DefsService.update` (3 quy trình thư viện), `RoutingService.assign/put`.

## Làm
- seed-niti.data.ts (dữ liệu khách), seed-niti.rules.ts (thuần), seed-niti.ts (chạy), 2 file test.
- Mặc định chạy thử (chỉ đọc). `--apply` ngoài localhost/test hoặc APP_ENV=production cần thêm `--i-know-prod`.
- Mật khẩu tạm CHỈ vào `$HOME/niti-credentials.txt` (600, ghi ngay khi tạo từng user), không in; user đã có không bị reset.

## Không làm / Chạm
Không HĐ mẫu; không sửa web/web-kit/i18n; không chạm DLC. Không migration.

## Test tối thiểu
unit `seed-niti.rules.test.ts`; int `seed-niti.int.test.ts` (evotest): chạy thử không ghi, apply tạo đủ, chạy lại không đổi,
file mật khẩu không lọt log, tenant lệch hình bị từ chối.

## Quyết định trong lúc làm
- Khoá tenant `nitigroup` (khớp `deploy/tenants/nitigroup.yaml`), tên "NiTi Group"; tenant trùng khoá/tên mà khác hình ⇒ dừng.
- Phòng: Ban Giám đốc = gốc (`pb-giam-doc`, như demo.yaml); Kinh doanh/Kế toán ngay dưới gốc.
- User: username thường `tien|thong|chieu|kim|ha`, email `<username>@nitigroup.example.invalid` (đổi bằng `--email-domain`; tenant_admin cần email).
- Vai: Tiên = tenant_admin + contracts/community owner; còn lại = member + contracts/community editor (trưởng phòng duyệt qua cổng trưởng phòng `head_only`, không cần owner).
- Bước duyệt: review `head_only`, due 24h, không đặt nhóm chuyển cấp (mặc định về Toàn quyền).
- Điều kiện luật `{departmentIds, contractKinds}` dựng ở MỘT hàm `conditionOf` (seed-niti.rules.ts). Không luật mặc định.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED docs/current/tools/seed-niti.md
#### Yêu cầu: Nạp tenant khách NiTi Group bằng một lệnh chạy lại được
Công cụ `seed-niti` chạy thử mặc định, ghi khi `--apply`, đi qua service của ứng dụng; chạy lại không đổi gì; mật khẩu tạm chỉ ở file.
- Kịch bản: khi chạy thử thì không hàng nào ở admin/hub đổi [test: tools/scripts/src/seed-niti.int.test.ts » chạy thử không ghi gì (kể cả file mật khẩu)]
- Kịch bản: khi `--apply` thì tenant, phòng ban, user, vai gói, 3 quy trình xuất bản + gán, luật phòng × loại HĐ được tạo và mật khẩu chỉ ở file [test: tools/scripts/src/seed-niti.int.test.ts » --apply tạo đủ và mật khẩu chỉ ở file, không ở log]
- Kịch bản: khi chạy lại thì mọi bước báo "không đổi" và số hàng/phiên bản cấu hình giữ nguyên [test: tools/scripts/src/seed-niti.int.test.ts » chạy lại = không đổi gì]
- Kịch bản: khi tenant trùng tên khác khoá thì từ chối, không ghi [test: tools/scripts/src/seed-niti.int.test.ts » tenant trùng tên nhưng khác khoá ⇒ từ chối, không ghi]
- Kịch bản: khi `--apply` trên DB không phải localhost/test mà thiếu `--i-know-prod` thì từ chối [test: tools/scripts/src/seed-niti.rules.test.ts » guard: apply ngoài localhost hoặc production cần --i-know-prod, chạy thử luôn được]

## Việc còn lại
Chạy trên prod do người dùng/điều phối (không chạy trong lát).
