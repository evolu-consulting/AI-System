---
id: CR-107-admin-config-nesting
title: Cải tổ cấu hình ai-admin — nav lồng theo công ty + RBAC lớp trên
cr: CR-107
status: draft           # BA READY (2026-11-02); P1–P3 spec UI viết; P4–P5 chờ backend-lead; chưa Gate, chưa code
requirements: [ADM-FR-76..85]
adr: 0033
owner: frontend-lead (P1–P3) · backend-lead (P4–P5) · docs-architect giữ tài liệu
mock: https://claude.ai/artifact/PETTuuoWp1GWotYoK9vSQq
---

# CR-107 · Cải tổ cấu hình ai-admin

Nguồn chốt: [`ba-admin-config-nesting.md`](../../design/admin/ba-admin-config-nesting.md) + [ADR-0033](../../adr/0033-rbac-layer-app-roles.md). Khuôn theo phần như CR-106 (mỗi phần một file, duyệt độc lập). Không chép BA — chỉ trỏ mục.

## Mục đích một câu
Quản trị một công ty ở **một workspace** (tab), tạo công ty qua **wizard**, và phân quyền theo **vai theo app** biên dịch một chiều xuống feature-grant mà Hub không đổi.

## Danh sách phần
| Phần | File | Nội dung | Làn | Trạng thái |
|---|---|---|---|---|
| P0 | `P0-tong-quan.md` | Từ điển, bất biến, quyết định đã chốt | — | chờ review |
| P1 | `P1-dieu-huong-wizard.md` | Nav lồng + Wizard onboard | Nhanh | chờ review |
| P2 | `P2-workspace-cong-ty.md` | Workspace tab, redirect route cũ | Nhanh | chờ review |
| P3 | `P3-phan-quyen-ui.md` | UI Phân quyền (vai theo app, gán user) | Đầy đủ | chờ review |
| P4 | `P4-backend-rbac.md` | Bảng `app_roles`, biên dịch, endpoint, RLS | Đầy đủ (Opus) | **placeholder — backend-lead điền** |
| P5 | `P5-backfill.md` | Backfill migration ép Group về chuẩn | Đầy đủ (Opus) | **placeholder — backend-lead điền** |
| P6 | `P6-truy-vet.md` | Ma trận FR ↔ phần ↔ nguồn ↔ AC | — | chờ Gate |
| TP | `test-plan.md` | AC → loại test gợi ý | — | chờ Gate |

## Cấp mã FR
`ADM-FR-74/75` đã dùng (`com-c1-ext-identity`) ⇒ CR-107 dùng **ADM-FR-76…85**. P0: 76 · P1: 77–78 · P2: 79 · P3: 80–81 · P4: 82–84 · P5: 85. AC đánh số `P<n>-ACxx`.

## Còn mở cho backend-lead
Tên cột/khoá/index `admin.app_roles` (+ `groups.managed_by_role_id`) · endpoint + gating từng thao tác · schema request/response · cơ chế audit grant · luồng dry-run/xác nhận backfill · quan hệ với `enablePack` (tái dùng hàm tạo Group/grant).

## Ma trận truy vết
Bản đầy đủ ở `P6-truy-vet.md`. Code/Test: chưa có.
