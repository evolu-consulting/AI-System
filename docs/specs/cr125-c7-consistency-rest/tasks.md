---
id: cr125-c7-consistency-rest
lát: cr125-c7-consistency-rest
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Đối chiếu từng dòng + từng check của `docs/specs/CR-125/consistency-audit.md` với code gd0 hiện tại, thêm cột "Trạng thái"; sửa dòng S/M còn lại; thêm check rẻ; dòng L ghi thành nhóm lát độc lập.

## Làm
- Audit: cột "Trạng thái" (Đã sửa + commit / Còn / Không áp dụng) cho 34 dòng + 9 check; mục "Dòng còn lại — nhóm lát độc lập".
- #10 web dùng `c.title` hub trả (đã là tên HĐ); bỏ allowlist của `check:contract-name`.
- #13 nhắc 4–168 / chuyển cấp 4–2160: ô nhập + câu lỗi + gợi ý lấy `{{min}}/{{max}}` từ hằng; check mới `check:shared-limits` (trong `check` + cổng sau rebase).
- #26 gỡ `JobRow.tsx` (hook `useJobName` sang `tenants/flows/lib`), #25/#27 xoá khoá i18n chết (`tenants.flows.*` CR-121, `contracts.flow.esign*`), #19 một câu "Mở lại quy trình", #33 hằng `CONTRACTS_PARTNER_CONFIRM_FEATURE` dùng chung, #23 ghi ADR-0001.

## Không làm / Chạm
canvas/*, admin-api template-fixes, def-group-bind, DLC. Dòng L: xem audit.

## Test tối thiểu
Unit: `check-shared-limits.rules.test.ts`, `slice-rebase.test.ts`, `check-contract-name.test.ts`; `i18n:check`; bộ unit admin-web/processes+tenants+features, contracts, i18n, tools. e2e journey-approval một lần cuối.

## Quyết định trong lúc làm
- #22 (tenant → công ty trong vi.json) để lại: e2e `users.spec.ts` khoá câu cũ; gộp vào nhóm lát riêng.
- #34 (đếm hộp thư đối tác) để lại: cần cổng đếm trong kit nav (đường nóng `/pack/nav`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

Không thay đổi hành vi (lý do: sửa chữ/hằng dùng chung, gỡ code và khoá i18n không còn dùng, thêm check tĩnh; số 4–168 và 4–2160 giữ nguyên giá trị)

## Việc còn lại
Các nhóm lát G1–G8 trong audit (dòng L và dòng cần quyết định).
