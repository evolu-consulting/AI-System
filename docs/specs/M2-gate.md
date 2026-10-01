# Gate M2 — Catalog & command

Ngày: 2026-10-01 · Trạng thái: **ĐÃ DUYỆT 2026-10-01** · Readiness: READY (`M2-catalog-command/readiness.md`, 2 lần)

**Tự duyệt theo Luật 2b**: spec-readiness lần 2 READY (không Chặn, không Cao); mọi đề xuất A1–A12 (gồm gói bảo mật Secrets A2) và UI lệch artboard đã được người dùng chấp nhận trực tiếp tại câu hỏi Gate 2026-10-01 (4 câu, xem `readiness.md` mục "Gate 2026-10-01"); không thêm thư viện/dịch vụ (không ADR mới); không secret thật (`SECRET_MASTER_KEY` dev do `keys:dev` sinh). Không hard stop.

## 1. Phạm vi
Secrets (AES-256-GCM, chỉ ghi, `last4`), Workflows (catalog, "Chưa gắn", mô tả bắt buộc, input schema), Commands (tên/alias chung không gian tên, input map 8 nguồn, ≥ 1 feature, không Test), Features + entitlement (`core` bảo vệ, kill switch lưu `status`). Chỉ `platform_admin`. FR: ADM-FR-10, 11, 13, 14, 15, 20, 21, 22, 24 (phần tenant), 30, 31, 33, 34, 50; FR-12 chỉ test âm. BR-01, 02, 04, 06, 10, 13, 14. AC: AC-A03 (phía Admin), A05, A06, A13, M2-AC01…09.

## 2. Quyết định người dùng (2026-10-01)
1. Gói bảo mật Secrets theo plan §3.2 — chấp nhận.
2. AC-A03 vế ≤ 5 giây đo ở M3 (CR-011) — chấp nhận.
3. FR-12 hoãn (CR-012); FR-24 chỉ tenant (CR-013); tab Feature của Tenant "Chưa khả dụng"; không audit — chấp nhận.
4. UI: editor trang riêng, bỏ "Chạy thử" (CR-014) — chấp nhận.

## 3. Áp trong BUILD (Thấp readiness lần 2)
T5 sau T4 (`testHooks`) · xoá feature không tăng `version` command · BUILD theo R02/R22 · `M2/_fixtures.ts` nạp `secret-crypto` lười.

## 4. Thứ tự BUILD
T1 → Q2 (qc viết + sửa test khoá M0/M1) → Q3 khoá → T2 → T3 → T4 → T5 → T6 ∥ FE0/FE0b/FE2 → FE1a … FE7 → T7 Lệnh xong M2 → reviewer (≤ 2 vòng) → D1.
