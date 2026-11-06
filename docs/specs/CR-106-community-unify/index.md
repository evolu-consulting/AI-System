---
id: CR-106-community-unify
title: Hợp nhất lớp vỏ Community + Sổ Hợp Tác
cr: CR-106
status: ready           # spec READY (spec-readiness lần 2), chưa code
requirements: [COM-FR-26..46]
owner: frontend-lead (+ docs-architect giữ tài liệu)
mock: https://claude.ai/artifact/QWj14SrNPkErSZU2FC6GWQ
---

# CR-106 · Hợp nhất lớp vỏ Community + Sổ Hợp Tác

Ghi chú cấu trúc: không có khuôn spec phù hợp (`docs/specs/_template/` là khuôn feature backend+frontend theo mục 1–8), nên spec này tự đặt khuôn theo **phần (P0–P6)** dưới đây. Mỗi phần là một file, sửa/duyệt độc lập. Chưa chạy spec-readiness (chờ người dùng review P0–P1).

## Mục đích một câu
Người dùng chủ quản thấy **một giao diện** (một vỏ: thương hiệu công ty, sidebar, user-menu, cài đặt) cho cả Community lẫn Sổ Hợp Tác (SHT), còn nghiệp vụ và dữ liệu của hai app **giữ nguyên, tách biệt**.

## Danh sách phần
| Phần | File | Nội dung | Trạng thái |
|---|---|---|---|
| P0 | `P0-tong-quan.md` | Tổng quan, từ điển, nguyên tắc bất biến, quyết định đã chốt | chờ review |
| P1 | `P1-khung-dieu-huong.md` | Topbar, sidebar cố định, nhóm xổ/gập, user-menu, routing 3 view + settings dialog | chờ review |
| P2 | `P2-bang-tin.md` | Bảng tin (feedbar, Composer, PostCard, Rail) | chờ review |
| P3 | `P3-ho-so.md` | Hồ sơ kiểu Facebook (chủ quản + đối tác; đối tác không có mục SHT) | chờ review |
| P4a | `P4a-cai-dat-khung.md` | Cài đặt chung: dialog, nav nhóm xổ/gập, lưu, quyền theo nhóm | chờ review |
| P4b | `P4b-ca-nhan.md` | Nhóm Cá nhân [CM]: Tài khoản, Giao diện (màu công ty), Thông báo | chờ review |
| P4c | `P4c-cong-ty-thanh-vien.md` | Nhóm Công ty [SHT]: Công ty, Thành viên (nguồn của brand) | chờ review |
| P4d | `P4d-sht-cau-hinh.md` | Nhóm Sổ Hợp Tác [SHT]: Điểm uy tín, Điểm kinh doanh, Dò giá, Quy trình duyệt readonly + Ký số | chờ review |
| P5 | `P5-tich-hop-sht.md` | Deep-link, SSO, brand dùng chung nguồn, hạ tầng i18n | chờ review |
| P6 | `P6-truy-vet.md` | Ma trận truy vết FR ↔ mock ↔ nguồn ↔ AC; trạng thái quyết định/chủ | chờ Gate |
| TP | `test-plan.md` | AC → loại test gợi ý (mô tả, chưa viết test) | chờ Gate |

## Khuôn mỗi phần (bắt buộc)
1. **Mục tiêu** · 2. **Nghiệp vụ** (mỗi mục gắn **Giữ nguyên / Đổi / Mới** + nguồn `file:dòng`, khóa i18n hoặc tài liệu) · 3. **Mock** (link + tên mục) · 4. **Điều hướng & trạng thái** · 5. **Dữ liệu / Contract** (zod, endpoint nếu có) · 6. **Quyền & cách ly** · 7. **Nhãn VI/EN verbatim** · 8. **Tiêu chí chấp nhận** (AC đánh số `P<n>-ACxx`) · 9. **Mã truy vết** `COM-FR-xx` · 10. **Việc còn mở**.

Quy ước: nhãn không có trong source không được bịa; mọi điểm mở đã có mặc định (P0 D-bảng) hoặc gắn chủ "backend-lead chốt khi code". Nguồn dòng lấy theo commit `d209d045` (platform/gd0); code thắng tài liệu khi lệch.

## Cấp mã FR
`COM-FR-26` trở đi (người dùng nêu COM-FR-25 là mã cuối; Grep repo chỉ thấy tới COM-FR-23 trong `docs/intake/community/2026-10-28-intake.md` — cần xác nhận 24–25). P0: 26 · P1: 27–31 · P2: 32–34 · P3: 35–37 · P4a: 38 · P4b: 39 · P4c: 40 · P4d: 41–42 · P5: 43–46.

## Quyết định bổ sung (2026-11-02)
Q10 deep-link mục SHT trong Cài đặt (tiền đề `?sec=` ở contracts-web) · Q11 SSO fallback · bảng mặc định D3–D17 ở `P0-tong-quan.md`. Song ngữ VI/EN (EN = đề xuất dịch, chờ duyệt; việc nền i18n = COM-FR-46) · `brand` trong phạm vi CR-106 (COM-FR-45) · viết đủ P2–P6.

## Ma trận truy vết
Bản đầy đủ (FR ↔ mock ↔ nguồn ↔ AC ↔ code/test) ở `P6-truy-vet.md`. Tóm tắt:
| Dải FR | Phần | Số AC |
|---|---|---|
| 26 | P0 | 5 |
| 27–31 | P1 | 14 |
| 32–34 | P2 | 8 |
| 35–37 | P3 | 7 |
| 38–42 | P4a–d | 8 + 5 + 7 + 7 |
| 43–46 | P5 | 9 |
Code/Test: chưa có (điền bằng `bun run trace` khi làm).

## Tài liệu nền liên quan
`docs/current/community/{nghiep-vu,hien-thi}.md` · `docs/current/sht/cai-dat-va-quyen.md` · `docs/platform/modules.md` · `docs/adr/0031-pack-to-pack-ports.md`

## Bảng EN chờ người dùng duyệt
Toàn bộ nhãn EN ở mục "Nhãn VI / EN" của P1–P5 là **đề xuất dịch, chờ duyệt**; VI giữ verbatim nguồn. Người dùng duyệt từng bảng (P1 §7, P2 §7, P3 §7, P4a–d §7, P5 §7) rồi chuyển sang khoá `packages/i18n/locales/community/en.json` khi code.
