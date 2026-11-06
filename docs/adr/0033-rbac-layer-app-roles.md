# ADR-0033 · RBAC-layer: "vai theo app" ở tầng admin, biên dịch một chiều xuống feature-grant

Trạng thái: **Accepted** (CR-107, người dùng duyệt 2026-11-02). Liên quan: `docs/design/admin/ba-admin-config-nesting.md` (D1–D5, Q1–Q10, R1–R4, backfill), `docs/design/admin/ba-admin.md` §6 (ADM-BR-11/13/14), ADR-0016 (Postgres nguồn chuẩn), ADR-0018 (SSO/identity theo tenant), ADR-0031 (cổng gói↔gói), ADR-0023 (Clean Architecture). Chưa có ADR RBAC trước đây.

## Bối cảnh
CR-107 (D4) muốn admin phân quyền bằng **"vai theo app"** dễ hiểu, lồng theo công ty (tenant): mỗi vai thuộc đúng một app, mang mức {Đọc / Đọc+Ghi / Quản trị}, có 3 vai mặc định + cho tạo vai tuỳ biến. Nhưng mô hình quyền **đang chạy** ở Hub là feature/entitlement/grant: quyền = feature (ADM-BR-11/13). Hub enforce bằng `packActionsFor` trả `[]` khi thiếu entitlement/off; read/write/admin độc lập (`apps/hub-api/src/modules/packs/kit/domain/pack-access.rules.ts:33-36`); grant đọc từ Group qua ConfigCache (`pack-guard.middleware.ts:54-79`), **bỏ qua grant user** và **bỏ qua Group với user external** (`:65-69,84-85`). Bật gói hiện tạo entitlement + 3 Group `<pack>-owner/-editor/-viewer` + 6 grant + NOTIFY (`apps/admin-api/src/modules/packs/packs.service.ts:72-92`; `packs.ts:27-48` `<pack>-read/-write/-admin`, `packGroupKey`).

Rủi ro trung tâm: nếu thêm bảng vai làm **nguồn quyền thứ hai**, sẽ **lệch hai nguồn** (sửa grant trực tiếp không phản ánh ngược vào vai; Hub và bảng vai bất đồng) và mâu thuẫn ADM-BR-11/13. Cần một quyết định kiến trúc chốt "một nguồn, một chiều" trước khi code bảng/biên dịch.

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| A. Thay máu: bỏ feature-grant, Hub đọc thẳng bảng vai mới | Một mô hình duy nhất, "sạch" về lý thuyết | Viết lại enforcement **mọi pack** + ConfigCache + cách ly external; migrate toàn bộ grant khách thật; rủi ro rất cao, chạm tiền/dữ liệu khách; trái D5 → **LOẠI** |
| B. Chỉ đổi nhãn "feature"→"quyền" ở UI, không bảng mới | Ít code nhất | Không có vai thật, không tạo được vai tuỳ biến, không lồng theo tenant như D4 yêu cầu → **LOẠI** |
| C. RBAC tổng quát resource/action đa cấp (role→permission→resource) | Mạnh, mở rộng xa | Thừa so với nhu cầu; không khớp mô hình read/write/admin **phẳng, 3 mức cố định** của Hub (R1, Q7); tăng bề mặt bảo mật vô ích → **LOẠI** |
| **D. Lớp vai ở tầng admin, biên dịch MỘT CHIỀU xuống feature-grant** | Giữ nguyên enforcement + cách ly tenant/external của Hub; một nguồn hiệu lực (feature-grant); vai là metadata ánh xạ; đổi/backfill cục bộ | Thêm bước biên dịch idempotent khi lưu; cần ràng buộc một chiều + đối soát backfill; bảng vai Hub không đọc (phải kỷ luật để không rẽ thành nguồn hai) |

## Quyết định
Chọn **D** — khớp D5 của BA.

1. **Một nguồn, một chiều (D5).** Bảng vai mới (mặc định `admin.app_roles`, tên chốt ở spec) là **nguồn ở TẦNG ADMIN**, theo tenant, **RLS theo `tenant_id`** (bắt buộc, + 1 test chặn đọc chéo tenant mỗi bảng mới). Khi lưu vai/gán, hệ thống **biên dịch một chiều xuống** lớp đang chạy: Group `<pack>-<role>` + `feature_grants` + `feature_entitlements`. **Hub và các app KHÔNG đổi** điểm chặn — vẫn đọc feature-grant qua Group / `PackMeResponse.actions`. **Bảng vai mới Hub KHÔNG đọc.** Hiệu lực quyền vẫn tính theo ADM-BR-11 ở Hub.

2. **Ràng buộc biên dịch R1–R4 là bất biến của ADR** (sửa cần CR/ADR mới):
   - **R1 — đủ cả 3 action, không bao hàm** (read/write/admin độc lập, khớp `pack-access.rules.ts:33-36`): Đọc ⇒ grant `-read`; Đọc+Ghi ⇒ `-read` & `-write`; Quản trị ⇒ cả 3. Thiếu `-read` ⇒ `/me` rỗng + app ẩn khỏi launcher.
   - **R2 — cấp qua Group `<pack>-<role>`, KHÔNG grant user lẻ** (Hub bỏ qua grant user: `pack-guard.middleware.ts:65-79`; `pack-access.rules.ts` D-11). Gán user vào vai = thêm user vào Group tương ứng (Q3: tái dùng Group, vai là lớp metadata).
   - **R3 — sau biên dịch phải phát NOTIFY** để ConfigCache (`adminSettled`) nạp lại, như `enablePack` làm (`packs.service.ts`). Biên dịch là một bước **idempotent trong một transaction** khi lưu vai/gán.
   - **R4 — "vai theo app" CHỈ cho business pack** (contracts/community/knowledge, Q6: knowledge có vai mặc định qua cùng `enablePack`). Chat = feature `chat-app` on/off theo tenant (`app-catalog.rules.ts:31`; `chat-gate.rules.ts:32-43`) — KHÔNG có vai. Studio/Admin = theo role hệ thống (`required_feature=null`) — KHÔNG có vai. UI Phân quyền loại chat/studio/admin khỏi "tạo vai" (tránh quyền ảo).

3. **External (cách ly HT-75/76).** CẤM vai tuỳ biến cho user external/community (Q9 chốt). Community giữ **2 mức tĩnh** read/write (`EXTERNAL_PACKS=["read","write"]`, `external-access.rules.ts:8-10`). Hub đã bỏ qua Group với user external ⇒ cách ly HT-75/76 giữ nguyên, không đổi. UI Phân quyền không hiện "tạo vai" cho app đối tác với subject external.

4. **Vai mặc định & backfill (làn đầy đủ, Opus; migration chạm dữ liệu khách thật).** 3 Group `<pack>-owner/-editor/-viewer` hiện có của mỗi tenant được **nhận thành 3 vai mặc định** (không tạo song song). Group đã sửa tay lệch template ⇒ **ép về chuẩn mặc định** (3 mức cố định, muốn khác thì tạo vai tuỳ biến mới). Vì đổi quyền hiệu lực của khách, BẮT BUỘC: (a) **dry-run + báo cáo** danh sách tenant/Group sẽ đổi; (b) **xác nhận thủ công** trước khi áp prod; (c) **audit** mỗi thay đổi grant.

5. **Phân biệt Group do-vai-quản-lý vs thủ công.** Đề xuất cột `admin.groups.managed_by_role_id` (nullable; null = Group thủ công) để thực thi "Group của vai là **read-only** ở `/groups`" (Q5). Group thủ công giữ nguyên hành vi cũ; biên dịch chỉ ghi lên Group do vai quản lý.

6. **Vai tuỳ biến.** slug → Group key `<pack>-<slug>`; validate `^[a-z0-9-]{2,32}$`; cấm trùng owner/editor/viewer và Group đã tồn tại ⇒ **409**. Đổi mức ⇒ viết lại grants của Group đó. Xoá vai còn user ⇒ **chặn 409** (FK `ON DELETE RESTRICT`, Q4: yêu cầu chuyển user trước).

7. **Liên quan CR-106.** `caps.contracts` hiện thực bằng `packActionsFor`, **KHÔNG** đọc bảng vai mới (tránh 2 nguồn). Cap cao nhất: admin > write > read; đối tác luôn `none`.

## Hệ quả
- Enforcement, cách ly tenant, cách ly external của Hub **không đổi**; bảng vai mới là lớp metadata + biên dịch, Hub không biết đến nó. `enablePack` vẫn là nơi tạo entitlement/Group/grant/NOTIFY; biên dịch vai dùng lại cùng cơ chế.
- Gating: catalog/entitlement = `platform_admin`; tạo vai/gán/user trong tenant mình = `tenant_admin` (ADM-BR-09) — chốt chi tiết endpoint ở spec.
- Module chạm (không đóng băng theo `docs/platform/modules.md`): packs/features/access/groups/users. Thêm cột `admin.groups.managed_by_role_id` + bảng `admin.app_roles` (RLS) — migration + schema thật làm ở spec, không ở ADR này.
- Test khi BUILD: unit cho hàm biên dịch thuần (vai → cặp grant theo R1); int đường chính + 1 test chặn đọc chéo tenant cho bảng vai; int chặn vai tuỳ biến cấp cho external; int backfill dry-run; audit grant. Không test lặp luật feature-grant ở Hub (đã có).
- Rủi ro còn lại: kỷ luật "bảng vai không phải nguồn hai" phải được giữ bằng review + depcruise/quy ước (Hub không import/đọc `admin.app_roles`); lệch nguồn nếu ai đó sửa grant trực tiếp lên Group do vai quản lý ⇒ chặn bằng read-only ở `/groups` (quyết định 5). Backfill là điểm rủi ro cao nhất ⇒ làn đầy đủ + dry-run + xác nhận thủ công.

### Cần spec làm rõ (không chốt ở ADR)
- Tên bảng/cột cuối cùng (`admin.app_roles` chỉ là mặc định đề xuất), khoá, index, FK chính xác.
- Số ADM-FR mới (Q10: cấp ở bước spec).
- Endpoint + role gating từng thao tác (tạo/sửa/xoá vai, gán user), schema request/response từng trường.
- Cơ chế audit cụ thể (bảng/định dạng) và luồng dry-run/xác nhận của migration backfill.
