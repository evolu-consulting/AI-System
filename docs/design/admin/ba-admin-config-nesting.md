# BA — Cải tổ cấu hình ai-admin: lồng theo công ty + RBAC 2 lớp (CR-107)

Trạng thái: **spec-readiness: quyết định nghiệp vụ READY (2 câu Chặn đã chốt 2026-11-02); chưa code — chờ ADR RBAC-layer + spec folder.** Bổ sung cho [`ba-admin.md`](ba-admin.md) (không sửa các mục ADM-FR hiện có). Vị trí: file riêng vì `ba-admin.md` đã dài (~330 dòng).
Mock đã duyệt: https://claude.ai/artifact/PETTuuoWp1GWotYoK9vSQq (4 màn: Khái niệm & nav · Wizard onboard · Workspace công ty · Phân quyền).

## 1. Vấn đề
Admin "trải đều" các màn cấu hình ở sidebar (catalog, tenant, user, quyền…), người quản trị phải nhảy giữa nhiều màn để cấu hình một công ty. Mục tiêu: **lồng theo công ty (tenant)**, giữ danh mục dùng chung ở cấp nền tảng.

## 2. Quyết định đã chốt
| # | Quyết định |
|---|---|
| D1 | **Nav lồng**: sidebar chỉ liệt kê tên công ty + "Thêm công ty". Click công ty → workspace bên phải; Tổng quan / Ứng dụng & Gói / Phân quyền / Người dùng / Chi phí & quota là **tab** trong workspace, không ở sidebar. |
| D2 | **Ranh giới lồng** ("chỉ lồng khi không ảnh hưởng"): lồng config thuộc phạm vi một tenant (có RLS): gán app/gói, entitlement, phân quyền, user/group, quota. Giữ **cấp nền tảng** (global, chỉ `platform_admin`): định nghĩa ứng dụng (`app_catalog`), features/commands/workflows dùng chung. |
| D3 | **Wizard "Onboard công ty"**: Bước 1 Thông tin công ty → 2 Gán ứng dụng → 3 Vai/quyền → 4 Người dùng. "Thêm công ty" mở Bước 1. Wizard = lần đầu; tab workspace = sửa về sau. |
| D4 | **Quyền 3 tầng, tách bạch**: ① **Vai hệ thống** = enum `users.role` (platform_admin / tenant_admin / member), gán ở hồ sơ user, quyết quyền quản trị — KHÔNG nằm trong màn Phân quyền. ② **Vai theo app**: mỗi vai thuộc ĐÚNG MỘT app, mang mức quyền {Đọc / Đọc+Ghi / Quản trị}; app bật gói có sẵn 3 vai mặc định (owner/editor/viewer → Chủ sở hữu/Biên tập/Người xem, hoặc tên theo app); cho phép **tạo vai tuỳ biến** trong từng app. ③ **Gán user vào vai theo app**; một user giữ vai ở nhiều app; quyền thực tế tính theo từng app. |
| D5 | **Production, không PoC**: mô hình roles/permissions mới là **nguồn quyền chính ở tầng admin, bảng thật, theo tenant (RLS)**; khi lưu thì **biên dịch/chiếu xuống** `feature_entitlements`/`feature_grants` đang chạy ở Hub. Hub GIỮ NGUYÊN điểm chặn quyền + cách ly tenant — không viết lại enforcement. Đây là **"lớp trên ánh xạ xuống feature-grant", không thay thế**. |

## 3. Hiện trạng (đối chiếu code, 2026-11-02)
- Tenant = company (không có bảng company riêng); user đơn-tenant (`users.tenant_id` NOT NULL, `admin.ts:88-124`). Đối tác = `admin.external_orgs` trong tenant chủ quản, user `kind='external'`.
- "Application" 2 lớp: (a) web apps `app_catalog` (chat/contracts/community/studio/admin; global, không RLS; app chat key `chat`); (b) packs nghiệp vụ (contracts/community/knowledge), nối qua `app_catalog.required_feature`.
- Gán app/pack cho tenant = `enablePack` (`apps/admin-api/src/modules/packs/packs.service.ts:72-92`): tạo `feature_entitlements` + 3 Group vai + 6 `feature_grants` + agent + NOTIFY Hub. Không có bảng `tenant_app`.
- Quyền: `features` (`<pack>-read/-write/-admin`, `packs.ts:27-48`) → `feature_entitlements` (cấp tenant, `admin.ts:365`) → `feature_grants` (group/user, `permissions.ts:74`). Không có bảng roles/permissions tổng quát. Luật hiệu lực ADM-BR-11/13/14 (`ba-admin.md` §6).
- Tạo user: `POST /admin/users` (`users.service.ts:161-221`); tenant kèm tenant_admin đầu (`createFirstAdmin`, ADM-FR-60). UI: catalog ở sidebar (`shell/lib/nav.ts:118-147`); gán-cho-tenant trong `/tenants/$id` các tab (`TenantDetailPage.tsx:158-166`).
- Module đóng băng ([`platform/modules.md`](../../platform/modules.md)): workflows/commands/transfer/sources. Đang dùng, sửa được: tenants/users/groups/access/packs/features. ADR liên quan: 0018 (SSO theo tenant), 0031 (cổng gói↔gói). **Chưa có ADR RBAC.**

## 4. Mô hình mục tiêu (khái niệm, chưa chốt tên bảng)
- **Vai theo app** = bản ghi theo tenant `(tenant, app, tên vai, mức quyền, là-mặc-định?)`, RLS theo tenant. 3 vai mặc định chính là 3 Group `<pack>-owner/-editor/-viewer` hiện có (`enablePack`) — được **nhận làm vai mặc định**, không tạo song song.
- **Mức quyền ↔ feature-action**: Đọc → `<pack>-read`; Đọc+Ghi → read+write; Quản trị → read+write+admin.
- **Vai tuỳ biến**: tạo → sinh 1 Group `<pack>-<slug>` + các `feature_grants` tương ứng mức quyền; đổi mức → viết lại grants của Group đó; xoá vai → gỡ grants + Group (chặn nếu còn user, hoặc yêu cầu chuyển — xem câu hỏi mở).
- **Gán user vào vai** = thêm user vào Group tương ứng (cơ chế đang có); quyền hiệu lực vẫn tính theo ADM-BR-11 ở Hub.
- **Biên dịch (D5)**: một bước idempotent trong một transaction khi lưu vai/gán; Hub chỉ thấy `feature_*` như cũ.

## 5. Đánh giá ảnh hưởng và rủi ro
| Mảng | Đánh giá | Làn |
|---|---|---|
| Mô hình quyền | Làm bảng roles làm nguồn **thay thế** sẽ mâu thuẫn ADM-BR-11/13. D5 chọn "lớp trên ánh xạ xuống" để tránh; rủi ro còn lại: **lệch hai nguồn** (sửa grant trực tiếp ở Hub/API cũ không phản ánh ngược vào vai) ⇒ cần quy tắc một chiều + đối soát/backfill từ Group hiện có. **Khuyến nghị ADR mới "RBAC-layer"** (việc cần, chưa viết). | Đầy đủ (Opus) |
| Cách ly tenant | Bảng mới BẮT BUỘC RLS theo tenant + 1 test chặn đọc chéo; gating: catalog/entitlement = `platform_admin`; tạo vai/gán/user trong tenant mình = `tenant_admin` (ADM-BR-09). | Đầy đủ |
| Community / đối tác | `community` ∈ EXTERNAL_APPS: gán/vai cho user `external` phải giữ cách ly đối tác HT-75/76; vai tuỳ biến không được cấp vượt phạm vi external. | Đầy đủ |
| Migration | Backfill: ánh xạ Group `<pack>-<role>` đã có của mọi tenant thành vai mặc định (dữ liệu khách thật) ⇒ migration có đối soát, chạy thử dry-run. | Đầy đủ |
| UI admin-web | Đổi cấu trúc nav (`shell/lib/nav.ts`), thêm wizard (chưa có component Stepper), mở rộng `TenantDetailPage` thành workspace nhiều tab. **e2e nav hiện có có thể gãy** (nêu, chưa sửa). Route cũ nên redirect để giữ link. | Nhanh |
| Nhãn / i18n | Tên vai, tên tab, mức quyền (vi/en). | Nhanh |

## Ảnh hưởng xuyên app (đánh giá)
D5 (enforcement giữ nguyên, mapping trong suốt) ĐÚNG với contracts, community, knowledge — chỉ đọc feature-grant qua Group.

| App | Lấy quyền | Ảnh hưởng | Rủi ro |
|---|---|---|---|
| contracts-web | `GET /pack/contracts/me` (`apps/contracts-web/src/features/pack-state/api.ts:1`), server `packGuard` | Trong suốt nếu mapping đủ grant | Thiếu grant ⇒ `/me` rỗng (R1) |
| community | `packGuard`; user ngoài bỏ qua Group hoàn toàn (`pack-guard.middleware.ts:65-69,84-85`); quyền đối tác `EXTERNAL_PACKS=["read","write"]` tĩnh (`external-access.rules.ts:8-10`) | Trong suốt | Vai tuỳ biến KHÔNG cấp chéo external |
| chat | KHÔNG phải pack; chỉ feature `chat-app` bật/tắt theo tenant (`app-catalog.rules.ts:31`; `chat-gate.rules.ts:32-41`) | "Vai 3 mức" KHÔNG áp dụng | Chat còn có dock contracts mở theo quyền đọc contracts (`chat-gate.rules.ts:43`) |
| knowledge | Có 3 vai + Group, chưa có app web tiêu thụ `packGuard` rõ | Trong suốt nhưng chưa có người dùng | Đừng hứa đủ 3 mức |
| studio, admin | Chỉ theo role hệ thống, `required_feature=null` (`app-catalog.seed.ts:42,51`) | KHÔNG áp dụng | — |

Hub đọc thẳng bảng admin (`catalog.repo.ts:68-78`; groups; `external_orgs`), nhưng bảng roles mới KHÔNG cần Hub đọc thêm, miễn mapping ghi vào bảng cũ + NOTIFY (R3).

## 6. Giai đoạn đề xuất (chưa chia spec)
P0–P6 do bước spec chia; gợi ý thứ tự: nav+workspace (giao diện, ít rủi ro) → wizard → bảng vai + biên dịch + RLS (rủi ro cao) → vai tuỳ biến → gán user nhiều app → backfill. Phần RBAC tách khỏi phần nav/wizard theo Luật 1b.

## 7. Quyết định đã chốt (Q1–Q10)
Người dùng chốt 2026-11-02, nhận toàn bộ mặc định.

2. Có viết ADR RBAC-layer không? — **Đã chốt:** **có**, trước khi code phần bảng/biên dịch.
3. Gán user vào vai = thêm vào Group (tái dùng) hay bảng riêng? — **Đã chốt:** tái dùng Group, vai là lớp metadata.
4. Xoá vai tuỳ biến còn user? — **Đã chốt:** chặn (409), yêu cầu chuyển user trước.
5. Sửa grant trực tiếp (API/UI cũ) sau khi có vai? — **Đã chốt:** chỉ đọc cho Group do vai quản lý; Group thủ công giữ nguyên.
6. `knowledge` có vai mặc định như contracts/community không? — **Đã chốt:** có (cùng `enablePack`).
7. Mức quyền chỉ 3 mức cố định hay chọn tập feature chi tiết? — **Đã chốt:** 3 mức cố định.
8. Wizard bước 3/4 bắt buộc hay bỏ qua được? — **Đã chốt:** bỏ qua được (tenant_admin đầu tiên đã tạo ở Bước 1, ADM-FR-60).
9. Vai tuỳ biến cho app bên ngoài (community, user external)? — **Q9 chốt (2026-11-02):** CẤM vai tuỳ biến cho user external. Community chỉ dùng 2 mức tĩnh read/write hiện có (`EXTERNAL_PACKS`). UI Phân quyền không hiện \"tạo vai\" cho app đối tác với subject external. Giữ cách ly HT-75/76.
10. Số ADM-FR mới — **Đã chốt:** cấp ở bước spec.

### Backfill Group `<pack>-<role>` lệch template
**Đã chốt (2026-11-02):** ép về chuẩn mặc định (mọi Group vai về đúng 3 mức chuẩn; muốn khác ⇒ tạo vai tuỳ biến mới). Vì đổi quyền hiệu lực của khách, BẮT BUỘC: (1) dry-run + báo cáo danh sách tenant/Group sẽ đổi trước khi áp; (2) xác nhận thủ công trước khi chạy thật ở prod; (3) ghi audit mỗi thay đổi grant. Làn đầy đủ (Opus), migration chạm dữ liệu khách.

### Ràng buộc mapping bắt buộc (kỹ thuật)
- **R1**: biên dịch đủ cả 3 action, không bao hàm: Đọc+Ghi ⇒ `-read` và `-write`; Quản trị ⇒ cả 3. Thiếu `-read` ⇒ `/me` rỗng + app ẩn khỏi launcher.
- **R2**: cấp qua Group `<pack>-<role>`, không dùng grant user lẻ (Hub bỏ qua).
- **R3**: sau biên dịch phải NOTIFY để ConfigCache (`adminSettled`) nạp lại.
- **R4**: "vai theo app" CHỈ cho business pack (contracts/community/knowledge). Chat = bật/tắt theo tenant; Studio/Admin = theo role hệ thống. UI Phân quyền KHÔNG hiện "tạo vai" cho chat/studio/admin (tránh quyền ảo).

### Tương tác CR-106
`caps.contracts` (P5 §5.1, mới ở mức spec) hiện thực bằng `packActionsFor`, KHÔNG đọc thẳng bảng roles mới (tránh 2 nguồn quyền); đối tác luôn none — khớp. Cap cao nhất: admin > write > read.
