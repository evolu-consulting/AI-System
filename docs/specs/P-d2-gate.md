# Gate · P-d2 (P-d-durable, lát 2) — GĐ1 platform

**Kết quả: DUYỆT CÓ ĐIỀU KIỆN — Tự duyệt theo Luật 2b (2026-10-18, phiên chính).** Vào BUILD trên nhánh `platform/gd0` (không push).

## Căn cứ
- spec-readiness **lần 2 READY** (vòng cuối; 0 Chặn, 0 Cao; 5 Thấp #116–#120 sửa khi BUILD), xem `P-d-durable/readiness.md` (commit fdc6f0b).
- Cao vòng 1 #97–#102 đóng ở a02a9d1 + T15c 69f6df2; Cao mới #112–#115 đóng bằng D2-43…D2-47 (`spec-decisions.md`).
- Không ADR thêm thư viện/dịch vụ mới; không câu hỏi mới cho người dùng; không hard stop.

## Điều kiện trước T17
| # | Điều kiện | Trạng thái |
|---|---|---|
| G1 | qc: nhãn E01 theo i18n `…tool.argValue` (D2-43), sửa mã truy vết `tool.int:162`, PD2-I43 trùng mã (#119) | Xong 5562ddc |
| G2 | qc: PD2-I51 (notice chuyển cấp `group`/`after_h`, D2-47), PD2-I52 (`wait_until`/`retry_at`, D2-45) — đỏ đúng lý do | Xong 5562ddc (đỏ ở `expect`, thiếu trường) |
| G3 | docs: #116 plan-d2 §12, #118 tasks (tick T15c, thêm D2-43…47 vào mục Đọc) | Xong 0c579a2 |

## Ràng buộc trong BUILD (báo lại ở T20)
- Luật 4c: hot path tập hợp; T17b đo trước rồi mới chọn cách; PD2-P01…P05 xanh ở `PERF=1`.
- Security S1–S12 ở T20, hard stop nếu lỗi cách ly tenant (S9 lọc tenant tường minh ở executor tool).
- `paramCompatible` hai bản (BE/FE theo ADR-0023) phải có test đối chiếu.
- Thêm `number` vào `INPUT_TYPES` (D2-44) sửa test khoá `contracts-pd1.test.ts:86` ở T17.
- UAT T20 kiểm lại B3 (khung luồng kẹt skeleton) và 2 chỗ contract dời từ P-d1.
- Review T20 phải kiểm 2 tự quyết T18-1 (d8663e0): (a) bỏ transaction read-only repeatable-read ở đọc editor context (PD2-P02) — 2 câu không cùng snapshot có gây sai hiển thị không; (b) stage tool đọc đích gọi thẳng `admin.workflows` (không qua cache catalog lọc input schema hợp lệ) — tool có schema hỏng vẫn chạy được không, có cần chặn.
- **PD2-P04 p95 chờ đo staging Linux** (người dùng 2026-10-18): giữ ngưỡng 30 ms; Windows n=40 đã làm nóng pool: p50 ~26 ms, p95 ~43 ms sau 3 vòng tối ưu (2846c49, fb8ac3a, fd53f88; sàn ước tính 20–23 ms). `run-spike.sh` chạy cả `perf/` nên đo cùng lượt staging với P-d1. Trên staging vẫn > 30 ms ⇒ thiết kế lại (launch stage kế ngoài tx quyết định). `done:pd2` bước perf đỏ ở P04 là đã biết.
- Perf P-d1 p95 vẫn chờ đo staging (người dùng chạy `run-spike.ps1`).

**Đóng 2026-10-18:** P-d2 đóng — done:pd2 10/11 (perf PD2-P04 + PD-P13/P14 chờ staging), review APPROVED, security SAFE, UAT ĐẠT CÓ ĐIỀU KIỆN; xem [ket-luan-pd2.md](P-d-durable/ket-luan-pd2.md).
