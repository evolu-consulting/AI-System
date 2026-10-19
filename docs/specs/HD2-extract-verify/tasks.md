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
