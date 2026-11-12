---
id: cr139c-demo-org
cr: CR-139 (Q13), chuẩn bị CR-140 (Q14)
lane: Sonnet high (seed/dữ liệu demo; không đụng RLS/quyền/máy trạng thái) · không UI
---
# CR-139c · dựng lại tenant `demo` thành công ty mẫu có cấu trúc doanh nghiệp thật

## Plan ngắn
| Phần | Làm |
|---|---|
| Phòng ban | `deploy/tenants/demo.yaml`: 6 phòng (Ban Giám đốc gốc + Kinh doanh, Mua hàng, Kế toán – Tài chính, Pháp chế, Kho vận), trưởng phòng + thành viên theo email — NGUỒN DUY NHẤT của «ai thuộc phòng nào / ai là trưởng». |
| Người dùng + dựng | `bun run demo:org` (`tools/scripts/src/seed-demo-org.ts`, dữ liệu/luật thuần `seed-demo-org.data.ts`): tạo 15 user qua admin-api, onboard phòng ban qua use case `tenant-onboard`, đồng bộ nhóm gói + nhóm vai, chạy `seed-cr128-flows`, dọn nhóm trùng phòng ban, gửi 4 HĐ mẫu qua hub rồi kiểm người nhận việc. Từ chối production/DB ngoài localhost. |
| Gỡ nhóm trùng | Seed hub (`seed.cr125-config.ts` `Cr125Opts.skipGroups` + `seed.cr125-members.ts` `SKIP_TEMPLATE_GROUPS`): công ty `demo` không còn tạo `truong-phong`, `giam-doc`, `phong-kinh-doanh`, `nhan-vien-phong-ban`, `truong-bo-phan`, `mua-hang`, `truong-mua-hang`, `phap-che`, `ke-toan`, `ke-toan-truong`, `kho`; `evolu` KHÔNG đổi (`writeCr125Config` 2 tham số vẫn như cũ). `ACCOUNTING.members.demo = []`. |
| Quy trình demo | `seed-cr128-flows.ts`: «Trưởng phòng duyệt» ⇒ `approver_mode:'starter_head'`, không `group_id`; «Giám đốc duyệt» ⇒ phòng Ban Giám đốc `head_only` + `need:'head'`; nhánh > 500 triệu giữ. `seed-flow-showcase`: nhóm Pháp chế mặc định `pb-phap-che`; không còn tự thêm `demo-owner` vào các phòng duyệt. |
| dev-up | `scripts/dev-up.ps1 -SeedDemo` chạy `seed-demo-org.ts` sau `seed-flow-showcase`. |
| UAT | `docs/specs/uat-2026-11-12/UAT.md`: sơ đồ + bảng tài khoản + 5 ca quy trình theo người thật. |
| Perf | Không (script seed dev, không đường nóng). |

## Quyết định trong lúc làm
| # | Quyết định | Lý do |
|---|---|---|
| 1 | Nhóm **gỡ** cho `demo` (11 nhóm trùng phòng ban): trưởng phòng/giám đốc/NV phòng ban/phòng Kinh doanh, Pháp chế, Kế toán, KT trưởng, Kho, Mua hàng, Trưởng mua hàng, Trưởng bộ phận | Suy được từ phòng ban + trưởng phòng (luật gốc 1). Mẫu Thư viện «Quy trình mua hàng» trỏ mã nhóm cũ ⇒ bản công ty để `group_id` trống tới khi CR-140 dựng lại theo phòng ban. |
| 2 | Nhóm **giữ** dạng nhóm vai: «Người ký HĐ» (An + Em), «Tài chính» (Giang), «Thủ quỹ» (Hùng); **thêm** «Kế toán thanh toán / mua hàng» (Hà) | Không suy được từ phòng ban/trưởng phòng (nhiều vai khác nhau trong cùng Phòng Kế toán). Quy trình mua hàng CR-140 cần. |
| 3 | Quyền Sổ Hợp Tác: Giám đốc = Toàn quyền; trưởng phòng + kế toán + NV = Nhân viên; Thủ quỹ = Chỉ xem | Theo brief; `demo-viewer` (NV Kế toán) lên Nhân viên cho đúng vai (e2e/UAT cũ không dựa vào quyền Chỉ xem của nó; UAT B5 đổi sang `hung.dinh`). |
| 4 | Mật khẩu dev: MỘT câu SQL đặt hash `DEMO_OWNER_PW` cho 14 user (trừ `demo-owner`) | Trần đăng nhập 30 lần/10 phút/IP — `ensureUser` của hub-dev tốn 1 lần đăng nhập mỗi user. Chỉ chạy máy dev (script chặn production), như `setPartnerDevPasswords`. |
| 5 | `demo-editor` → «Hồ Minh Quân» (NV Kinh doanh), `demo-viewer` → «Phan Thị Yến» (NV Kế toán) | Tránh trùng tên với Lê Minh Cường/Trần Thị Bình mới; giữ username cho e2e/UAT cũ. |
| 6 | HĐ mẫu thứ 4: Bình (trưởng phòng) tự gửi 150 triệu ⇒ lên An | Phủ ca «trưởng phòng tự gửi» (UAT P3). Tạo nháp bằng SQL như `seed-cr113-samples`, GỬI bằng `POST …/submit` của chính người gửi. |
| 7 | HĐ đang duyệt theo quy trình cũ trỏ nhóm bị gỡ ⇒ người tạo Rút; bản quy trình công ty trỏ nhóm bị gỡ (vd Phần 2 mua hàng) ⇒ xoá | Chưa có khách thật (memory no-data-migration-yet): dọn tạo lại, không backfill. |
| 8 | `seed-cr128-flows` gọi với `--skip-check` từ `demo:org` | `demo:org` tự kiểm sâu hơn (4 HĐ, đúng người nhận việc); tiết kiệm lượt đăng nhập. |

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED tools/demo-org.md
#### Yêu cầu: Công ty mẫu demo có cấu trúc doanh nghiệp thật
`bun run demo:org` dựng lại công ty `demo`: phòng ban + trưởng phòng theo `deploy/tenants/demo.yaml` (nguồn duy nhất), mỗi người thuộc đúng một phòng, nhóm gói và nhóm vai suy từ sơ đồ; công ty demo không có nhóm trùng phòng ban; quy trình «Duyệt hợp đồng»/«Đề nghị mua hàng» giao «Trưởng phòng duyệt» theo trưởng phòng của người gửi; chạy lại không đổi gì; từ chối production.
- Kịch bản: nhóm mong muốn suy từ phòng ban, mỗi người đúng một phòng, Thủ quỹ chỉ xem [test: tools/scripts/src/seed-demo-org.data.test.ts » mọi người đúng một phòng ban, Thủ quỹ chỉ xem, Giám đốc toàn quyền]
- Kịch bản: chênh lệch thành viên chỉ đụng người trong danh sách quản lý [test: tools/scripts/src/seed-demo-org.data.test.ts » diff: thêm người thiếu, bớt người quản lý đứng sai chỗ, không đụng người ngoài danh sách]
- Kịch bản: seed hub không tạo nhóm trùng phòng ban cho demo, evolu giữ nguyên [test: apps/hub-api/src/modules/seed/seed.tenant-fixtures.int.test.ts » development + fixtures (chạy 2 lần)]

## Việc còn lại
- CR-140: dựng lại «Quy trình mua hàng» (1 cha + 3 con) trên sơ đồ mới; mẫu Thư viện cũ còn trỏ mã nhóm đã gỡ (`group_id` trống cho tới lúc đó).
- Chạy lại `bun run test:int` cho `seed.cr126-demo-purchase`/`seed.cr125-config` cuối đợt (không đổi hành vi hai tham số).
