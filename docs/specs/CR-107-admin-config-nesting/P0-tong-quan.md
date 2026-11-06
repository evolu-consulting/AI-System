# P0 · Tổng quan (CR-107)

Thuộc `index.md`. FR: **ADM-FR-76**. Chi tiết quyết định ở BA (không chép): [`ba-admin-config-nesting.md`](../../design/admin/ba-admin-config-nesting.md) §2 (D1–D5), §7 (Q1–Q10, R1–R4, backfill). ADR: [0033](../../adr/0033-rbac-layer-app-roles.md). Mock: https://claude.ai/artifact/PETTuuoWp1GWotYoK9vSQq.

## Từ điển
| Thuật ngữ | Nghĩa |
|---|---|
| tenant = công ty | một khái niệm, không có bảng company riêng |
| app (web) | dòng `app_catalog` (global, không RLS) |
| pack | gói nghiệp vụ (contracts/community/knowledge), schema + quyền riêng; nối app qua `required_feature` |
| feature | `<pack>-read/-write/-admin` |
| vai hệ thống | enum `users.role` (platform_admin/tenant_admin/member), gán ở hồ sơ user |
| vai theo app | bản ghi tenant-scope, thuộc đúng 1 pack, mang mức Đọc / Đọc+Ghi / Quản trị |
| grant | `feature_grants` (Group/user) mà Hub thực thi |

## Nguyên tắc bất biến
1. Một nguồn quyền ở tầng admin (bảng vai), biên dịch **một chiều** xuống Group + grant; Hub không đọc bảng vai (ADR-0033 §1).
2. R1–R4 (đủ 3 action · qua Group · NOTIFY · chỉ business pack) — nguyên văn ở BA §7 / ADR §2.
3. Bảng mới RLS theo tenant; catalog/entitlement = platform_admin; vai/gán/user trong tenant = tenant_admin (ADM-BR-09).
4. External: cấm vai tuỳ biến; community giữ 2 mức tĩnh; Hub bỏ qua Group với user external (HT-75/76).
5. Chat/Studio/Admin không có vai theo app; UI Phân quyền không hiện "tạo vai" cho chúng.
6. Module đóng băng (workflows/commands/transfer/sources) không đụng.

## Quyết định đã chốt
D1–D5, Q1–Q10, Q9 (cấm vai tuỳ biến external), backfill ép chuẩn + dry-run/xác nhận/audit — người dùng chốt 2026-11-02, xem BA. ADR-0033 Accepted.

## AC
| AC | Nội dung |
|---|---|
| P0-AC01 | Hub không import/đọc `admin.app_roles` (kiểm bằng depcruise/quy ước) |
| P0-AC02 | HT-75/76 hiện có vẫn xanh sau thay đổi |
| P0-AC03 | Không có thay đổi nào ở workflows/commands/transfer/sources |
