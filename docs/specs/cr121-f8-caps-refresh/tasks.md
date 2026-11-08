---
id: cr121-f8-caps-refresh
lát: cr121-f8-caps-refresh
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Lỗi F8: lưu mức app ở tab Ứng dụng xong, tab Quy trình vẫn hiện "Chưa dùng ứng dụng" tới khi tải lại: query năng lực công ty và luật/tóm tắt không được làm tươi.

## Làm
- `tenants/flows/lib/invalidate.ts`: MỘT hàm `invalidateCompanyFlows(qc, tenantId)` (+ `companyFlowKeys`) làm tươi năng lực (`process/assigned/caps/<công ty>`), luật mọi việc và thân quy trình (`process/routing/<công ty>`), bản thư viện, lượt chạy, danh sách khe và vai theo ứng dụng (tóm tắt).
- Dùng chung ở 3 chỗ: lưu mức/tính năng của tab Ứng dụng (`use-apps-tab.ts`, cả khi lưu lỗi một phần), gán/đổi/Sao chép (`use-flow-assign.ts`), gán/bỏ gán/lưu luật ở ngăn platform (`use-slot-routing.ts`) — thay các dòng invalidate rải rác.

## Không làm / Chạm
Không đổi hub. Không sửa e2e.

## Test tối thiểu
- unit: `tenants/flows/lib/invalidate.test.ts` (đúng khoá, đúng công ty, trùng khoá hook đọc).

## Ca e2e cần đổi (qc)
- `e2e/cr121-c-flows.spec.ts`: gỡ `expect.soft` chờ sửa này — sau khi lưu mức app ở tab Ứng dụng, chuyển sang tab Quy trình phải hết "Chưa dùng ứng dụng" ngay, không cần tải lại.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/cong-ty-lam-tuoi-nang-luc.md
#### Yêu cầu: Lưu mức ứng dụng làm tươi ngay tab Quy trình và tóm tắt
Sau khi lưu mức ứng dụng hoặc tính năng của công ty, tab Quy trình, luật và dòng tóm tắt "x/y việc" thấy dữ liệu mới ngay mà không cần tải lại trang.
- Kịch bản: lưu mức app/gán/đổi luật làm tươi đúng các khoá năng lực, luật, thư viện, lượt chạy và vai của công ty đó [test: apps/admin-web/src/features/tenants/flows/lib/invalidate.test.ts » CR-121 f8 · invalidateCompanyFlows]

## Việc còn lại
- qc gỡ `expect.soft` ở `cr121-c-flows.spec.ts`.