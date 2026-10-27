# Sổ Hợp Tác · Pháp lý và "Cần xử lý"

Cập nhật: 2026-10-27 · Gộp từ: DOC-legal (CR-101), MS-impact (Câu 11), REP-v3 mục 7, DOC-ui-gaps, V2-K/N (nền).

## 1. Cảnh báo pháp lý
- **Điều kiện** (`legalWarning`, `H/domain/legal-warn.rules.ts`): chứng từ `doc_type = 'deal'`, `frame_root_id` null (đứng riêng), tổng giá trị ≥ ngưỡng, còn mốc tiền mở (thu/trả/hoa hồng, `status = open`). Tổng: mua/bán = `value`; Giới thiệu = hoa hồng dự kiến (`moneyBase`). HĐ kinh tế thường và HĐ NT **không** cảnh báo; giao dịch thuộc HĐ NT không cảnh báo.
- **Ngưỡng** `approval_settings.legal_warn_threshold` (bigint, mặc định 5.000.000 đ, ≥ 0; **0 = tắt**). Đặt ở Cài đặt › Công ty (`CompanyPane.tsx`) qua `PUT /company` (`legal_warn_threshold`, vắng ⇒ giữ nguyên); `PUT /company` chỉ quyền `admin` của gói = `contracts-owner` (ngoài ra 403 `PACK_FORBIDDEN`); nhật ký trước/sau ở `approval_settings_audit`.
- **Chỉ cảnh báo, không chặn** lưu/xác nhận; luôn kèm dòng "cần kế toán xác nhận" (`contracts.legal.{title,reason,accountantNote}`). Ngưỡng 5 triệu là diễn giải luật thuế, cần kế toán xác nhận.
- **Hiển thị:**
  1. Chi tiết: `GET /pack/contracts/contracts/:id` trả `legal_warning: {threshold, reason} | null` (không thêm câu SQL: ngưỡng là sub-select); banner `W/features/contract-review/components/LegalBanner.tsx`.
  2. Cần xử lý: nguồn `kind = legal` (nhãn "Pháp lý"; khoá Bỏ qua `legal:<id>:<ngày tạo>`; `amount` = tổng; `contract_id` = giao dịch).
  3. Form Giao dịch: cảnh báo trước khi lưu (`legal-warn.ts` ở web, cùng luật; ngưỡng từ `GET /company`); không áp khi có HĐ NT hoặc tích "đã giao/đã thanh toán ngay"; giới thiệu chỉ tính hoa hồng cố định.
  4. Danh sách: chưa có nhãn (API chưa có trường).
- SQL `legalSource` (`todo.repo.ts`) phải khớp `legalWarning` (domain): sửa cả hai.
- Code: `H/domain/legal-warn.rules.ts`, `H/adapters/todo.repo.ts`, `H/application/get-contract.usecase.ts`, `H/application/company.usecase.ts`, `MG/0057_doc_legal.sql`, `W/features/settings/components/CompanyPane.tsx`, `W/features/legal/**`; locale `legal.{vi,en}.json`. Test: `T/DOC-legal/legal.int.test.ts`.

## 2. Nguồn Cần xử lý (`GET /my-work/todo`, `POST /my-work/todo/dismiss`)
- Một câu SQL tổng hợp các nguồn (mỗi nguồn một khối, `LIM` hàng, số câu SQL cố định); Bỏ qua dùng cơ chế dismiss có sẵn (khoá `<kind>:<id>:<mốc>`). HĐ NT bị loại khỏi nguồn.
- Nguồn đã biết từ các lát này:
  - `legal` — Pháp lý (§1).
  - `verify_fault` — **"Xác minh lỗi mốc trễ"** (hàm `verifyFaultSource`, khối `vf`): mốc `done`, `fault = 'unknown'`, xong ≥ 3 ngày và ≤ 90 ngày; hạn = ngày xong + 3; khoá `verify_fault:<id>:<ngày xong + 3>`. Xử lý = Bỏ qua/Đã xong (đổi lỗi: huỷ dòng sổ rồi xác nhận lại).
  - `rating` / `rating_quarter` — "Đánh giá đối tác" (`ratingSources`), **chỉ khi `REPUTATION_ENGINE=v2e`**.
  - Nguồn nền (V2-K/N: nhắc hạn mốc, gia hạn, quá hạn…): không mô tả lại ở đây — xem `H/adapters/todo.repo.ts` và `H/domain/todo.rules.ts`.
- Tổng quan: khối "Chờ tôi duyệt" (`approvals[]` từ `GET /my-work`, khi engine duyệt bật).
- Code UI: `W/features/overview/**` (`TodoBlock.tsx` có tông màu theo `kind`; kind mới bắt buộc thêm cho typecheck); locale `kind.legal`, `kind.verify_fault`.

## Chưa rõ
1. Danh mục đủ các nguồn nền của Cần xử lý (V2-K/N) chưa kê ở đây; chỉ ghi nguồn do các lát CR-101 thêm.
2. e2e ô ngưỡng Cài đặt chưa viết (cuối đợt).
