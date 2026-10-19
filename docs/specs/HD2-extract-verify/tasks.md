# HD2 — tasks (một agent làm trọn lát, CR-094 đợt 2)

| # | Việc | Làn | FR | Xong khi | Trạng thái |
|---|---|---|---|---|---|
| A1 | Contract zod `extract.ts` + mã lỗi | đầy đủ (contract) | HD-FR-21, 26 | `bun test packages/contracts` | [x] |
| A2 | Domain verify/warnings + port test `test_contract_verify.py` + perf ≤ 5 ms | nhanh (thuần) | HD-FR-22, 23 | `bun test …/domain` | [x] |
| A3 | Prompt + rào injection + parse strict | đầy đủ (HUB-BR-31) | HD-FR-21 | unit injection | [x] |
| A4 | Test int tenant/quyền (viết TRƯỚC code route): extract/manual chéo tenant 404, viewer 403 | đầy đủ | HD-FR-24, 26 | đỏ đúng lý do rồi xanh | [x] |
| A5 | Use case trích + hàng đợi + repo + route extract + thay `ExtractionStarter` no-op | đầy đủ (tenant) | HD-FR-24 | int HD2 | [x] |
| A6 | Tra MST: port + adapter HTTP + transport giả | nhanh | HD-FR-25 | unit + int | [x] |
| A7 | Nhập tay: use case + repo + route | đầy đủ (tenant) | HD-FR-26 | int HD2 | [x] |
| A8 | FE S04/S05 + i18n + unit | nhanh | HD-FR-26 | `bun test apps/contracts-web` | [x] |
| A9 | e2e so màn hình S04/S05 + baseline ref | nhanh | HD-FR-26 | `bun run e2e:contracts` | [x] |
| A10 | Cổng lát + security review + commit | — | — | brief mục 2 | [x] (xem Kết quả) |

Nợ: TECH-DEBT #218 hàng đợi trong tiến trình (D2-02); #219 transport agent qua run Hub (D2-01, chờ N2/HD3); #220 "Xem file gốc" cần link JSON.

## Kết quả (2026-10-19)
- Perf `verify` HĐ 30.000 ký tự + 50 dòng: p50 1,5–1,9 ms · p95 2,2–3,3 ms (≤ 5 ms), `verify.perf.test.ts`.
- Lượt trích (trích lại + chạy nền): 6 câu SQL cố định, 3 dòng = 60 dòng hàng (`extract.int.test.ts`).
- Int `test:int:par HD2 HD1 N1`: 274 pass, 0 fail. e2e `e2e:contracts` 24/24 (S04 ×3, S05 ×4 khớp mgmt-app 3 lớp + 3 hành vi); e2e N1 29/29.
- Security review (1 vòng, chỉ đọc): CHANGES REQUESTED — M1 đầu ra agent có NUL/surrogate lẻ/năm 0000 làm HĐ kẹt `extracting` ⇒ sửa: `pgText`/`outDate` trong `ExtractionOutputSchema` + tx ghi hỏng ⇒ `extract_failed SAVE_FAILED` (unit test); m2–m4 tra MST (lọc ký tự điều khiển + cắt 300, kẹp Retry-After 1–600 s, trần thân 64 KiB) đã sửa; m1 ghi #218; m5 ghi #221. Phần còn lại SAFE (injection, tenant, quyền, egress, FE).

## Vòng sửa review (`review.md`, 2026-10-19)
| Mục | Sửa | Test |
|---|---|---|
| Trung 1 | Kiểm trích dẫn NGOÀI tx, trước ghi (`verifyExtraction` / `mergeExtraction`); văn bản > 200.000 ký tự ⇒ Bun Worker (`adapters/verify.worker.ts`, khuôn DOCX ADR-0024); tx ghi không khoá trước: `saveResult` có điều kiện `version` ∧ `extracting`, thua đua ⇒ đọc lại gộp lại (≤ 3) | `extraction-flow.test.ts` (sửa tay xen giữa giữ `edited`); perf `verify-worker.perf.int.test.ts` (PERF=1): 5 MB/500 dòng worker 1.036 ms, nghẽn vòng sự kiện 14,4 ms (tại chỗ: chặn 860 ms) |
| Trung 2 | Agent có hạn giờ (`CONTRACTS_EXTRACT_TIMEOUT_S`, mặc định 300 s) + `AbortSignal` cho transport ⇒ `TIMEOUT` ⇒ `extract_failed` (trích lại được), trả chỗ hàng đợi | `extraction-flow.test.ts` (hạn giờ giả) |
| Trung 3 | Port nguyên `party_form` + `same_name` (≥ 4 ký tự mới so chứa; so cả tên viết tắt, tên quốc tế) | ca đối chiếu `link.py:90` + tên ngắn/tiếng Anh |
| Trung 4 | Cổng MST giãn 2 s (`registry.py:13`); khe chưa tới / 429 ⇒ `unavailable` + `retryAt`; hàng đợi hẹn MỘT bộ hẹn giờ mỗi HĐ ⇒ lượt `refreshParties` (cập nhật `warnings` theo `version`, ≤ 5 lần); nhập tay cũng hẹn | `extraction-flow.test.ts` (đồng hồ + hẹn giờ giả) |
| #220 | `GET …/contracts/:id/file-link` ⇒ `{url}` (no-store); S05 bấm ⇒ mở tab, xin link có Bearer; `<a>` giữ nguyên (so màn hình không đổi) | int `#220`, e2e `hd2-flow` popup |
| Thấp 5, 6, 7, 8, 9, 12 | Bỏ `direction_unknown` khi chưa có pháp nhân; gộp lời gọi MST chỉ cùng `fast`; HĐ đã duyệt ⇒ 409 `EXTRACT_NOT_ALLOWED`; perf đồng hồ thật dưới `PERF=1` (`*.perf.int.test.ts`); bỏ `requestExtract` FE; mã nợ đổi sang số TECH-DEBT | int + unit |
| Thấp 14 | Ca int trích lại khi đã có dòng hàng (giữ dòng cũ) | `extract.int.test.ts` |
| Lỗi phát hiện thêm | `d.onSettled?.(id, await d.run())` bỏ qua cả `run` khi không có hook (`?.` không tính đối số) ⇒ production không bao giờ chạy lượt trích; sửa gọi `run` trước | `extraction-flow.test.ts` (Trung 4 không có hook) |

Còn lại (không sửa vòng này): Thấp 10 (strict tuyệt đối — giữ, an toàn hơn), Thấp 11 (`clauses` chưa có `heading`/`chunk_id` — làm khi có lát tìm kiếm điều khoản), Thấp 13 (thứ tự `tests/.lock`: lần này giữ thứ tự cũ, chỉ chèn/đổi dòng của lát). Lượt trích nay 5 câu SQL cố định (3 = 60 dòng).
