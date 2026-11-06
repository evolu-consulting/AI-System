# P2 · Workspace công ty (Làn nhanh)

FR: **ADM-FR-79**. BA: D1, D2. Mock: màn 3.

## Nghiệp vụ
Tái dùng `TenantDetailPage` (`TenantDetailPage.tsx:158-166`) thành workspace với tab: Tổng quan · Ứng dụng & Gói · Phân quyền (P3) · Người dùng · Chi phí & quota. Chỉ config thuộc phạm vi tenant (D2); catalog nền tảng không vào workspace.

## Bản đồ redirect route cũ → tab
| Route cũ | Đích |
|---|---|
| `/tenants`, `/tenants/$id` | workspace công ty, tab Tổng quan |
| các tab hiện có của `/tenants/$id` | cùng tên tab trong workspace |
| mục users/groups/access/quota trong sidebar cũ | tab Người dùng / Phân quyền / Chi phí & quota của công ty đang chọn |

Chốt route cụ thể khi code (đối chiếu `nav.ts`); route cũ giữ redirect để link/bookmark không gãy.

## e2e cần sửa (nêu, chưa sửa)
e2e nav admin-web hiện có (tìm bằng Grep `e2e/` theo `nav`/`tenants`) có thể gãy; sửa trong lát nav.

## AC
| AC | Nội dung |
|---|---|
| P2-AC01 | 5 tab hiển thị theo quyền (tenant_admin chỉ công ty mình) |
| P2-AC02 | Route cũ redirect đúng tab |
| P2-AC03 | Tab Ứng dụng & Gói giữ hành vi bật/tắt gói hiện có |
