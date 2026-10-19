# Gate · HD1 (nền dữ liệu hợp đồng) — CR-094

**Kết quả: DUYỆT — Tự duyệt theo Luật 2b (2026-10-19, phiên chính).** Vào BUILD trên nhánh `platform/gd0` (không push) sau khi N1 xong T5c (`withPackScope`, khuôn module gói).

## Căn cứ
- spec-readiness **lần 2 READY** (97993e2e; 0 Chặn, 0 Cao; Thấp #18–#20 sửa khi build). Lần 1 (207b581) 7 Cao đều có mặc định, đã áp ở 483cfd76; test theo mặc định ở abb7969a.
- Q7 (page/page_size/total thay `next_cursor`) đóng theo D-02 người dùng đã chốt (contracts-web giống mgmt-app — màn danh sách có tổng + trang số), ghi D-03. Q8 đóng (danh bạ thành viên ⇒ HD5, N1 spec).
- Không ADR thư viện mới; không câu hỏi mới cho người dùng; không hard stop.

## Điều kiện trước / trong build
| # | Điều kiện | Khi |
|---|---|---|
| G1 | N1 T5c xong (`withPackScope`, `PackUow`, khuôn `modules/packs/`) | trước T4 |
| G2 | backend-lead đặt export `asDate(s: string \| null): string \| null` (plan §4, giữ ≤ 18.432 B) ⇒ qc thêm ca parity TS khi relock | T6 |

## Ràng buộc trong BUILD
- 10 task rủi ro cao ⇒ test qc (78bdab1, abb7969a) có trước; T6/T12/T13 thường ⇒ code + test cùng task, qc đọc nhanh sau.
- Luật 4c: danh sách/facets p95 ≤ 50 ms (2 câu), chi tiết ≤ 30 ms (2 câu), PATCH ≤ 30 ms (4 câu), upload 3 câu + 1 pipeline Redis; đo cả trước và sau `ANALYZE`, EXPLAIN không Seq Scan; seed perf theo tập.
- Security review: RLS gói, quyền owner/editor/viewer, upload (magic bytes, zip-names, quota) — hard stop nếu lỗi cách ly tenant.
