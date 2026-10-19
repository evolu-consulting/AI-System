# Kết luận lát HD1 Contracts nền (2026-10-19)

Quyết định: **đóng HD1** theo khuôn P-d2 (CR-094 đợt 1). HD1 không có UI (HD5 làm, D-02). Perf đo trên Windows dev; facets còn sát ngưỡng và cần đo staging (§6). Không nới ngưỡng.

## 1. Phạm vi đã giao

Contract zod 23 trường, enum, ListQuery/Row/Facets, Detail, Patch, mã lỗi (T4) · DDL 5 bảng, 4 hàm IMMUTABLE, cột sinh, index, REVOKE; `0002_category_ids` (cột `category_ids uuid[]` gộp sẵn + trigger câu lệnh) (T5) · domain thuần `fillFields`, `mergeFields`, `applyEdits`, `foldVi`, `personKey`, `sniffFileType`, `quotaVerdict`… + parity TS ↔ SQL (T6) · danh sách + facets (T7) · chi tiết, `/source`, `/file` 302 (T8) · PATCH có khoá lạc quan `version` (T9) · tải lên: `bodyLimit` 20 MiB, magic bytes, quota Redis, DOCX, FileBox `org`, 3 câu (T10). Mã FR: HD-FR-01…08, HD-AC01…14.

## 2. Kết quả

| Hạng mục | Kết quả |
|---|---|
| Gate | spec-readiness lần 2 **READY** (`97993e2e`; 0 Chặn, 0 Cao). Đóng Q7 (page/page_size/total, D-02, D-03) và Q8 |
| Review chung (`review.md`) | Vòng 1 CHANGES REQUESTED: M-01 thiếu số đo T8/T10 (sửa, ghi `spec-decisions.md`). Vòng 2 **APPROVED** (`c068fa99`) |
| Security | **SAFE** vòng 1 và vòng 2: FK kép, UNIQUE có `tenant_id` (D-19, chống dò chéo tenant), log không lộ PII/file id. Minor ghi nợ |
| Test | `T/**` (`tests/acceptance/HD1`) có test trước cho task rủi ro cao; số đo perf trong `rw.perf.int.test.ts`, `list.perf.int.test.ts` |

## 3. Perf (Luật 4c, số đo thật)

| Ca | Số đo (p95, lượt đo T7–T10) | Ngưỡng | Kết |
|---|---|---|---|
| Danh sách 2 câu (T7, T9) | 23,9–26,6 ms (tổ hợp tệ nhất) | ≤ 50 ms | Đạt |
| Facets 2 câu (T7, T9) | 41–46 ms sau trigger (trước D-22: 87–105 ms) | ≤ 50 ms | **Sát trần** — xem R-01 |
| Chi tiết (T8) | 1,6–2,1 ms | ≤ 30 ms | Đạt |
| PATCH 4 câu (T9) | 3,5–4,1 ms | ≤ 30 ms | Đạt |
| Tải lên 3 câu + 1 pipeline Redis (T10) | 3,7–5,1 ms | (không có ngưỡng riêng) | Đạt |
| Ghi lô 1.000 item (D-22) | p50 35 → 45 ms | ≤ 2× | Đạt |

Danh sách/chi tiết/PATCH/tải lên đo trước và sau `ANALYZE`, `EXPLAIN` không Seq Scan. `GIN` trên `category_ids` không tạo: planner không chọn (9,6 ms) ⇒ giữ semi-join `items_category_idx` (2,2 ms).

**R-01 (rủi ro, không phải Blocker):** một lượt máy tải cho facets 53,6 và 65,9 ms, vượt 50 ms. Không phải lỗi truy vấn; đường facets nhạy với tải chung. Chưa nới ngưỡng.

## 4. Quyết định chính (`spec-decisions.md`)

D-08 không xoá HĐ ở HD1 (REVOKE DELETE). D-13 chi tiết không trả `source_text` (≤ 5 MB), dùng `/source`. D-19 UNIQUE có `tenant_id`. D-22 gộp `category_ids` + trigger câu lệnh (đánh đổi ghi chậm ≤ 2×). T8: `:id` sai dạng ⇒ 400; tenant khác ⇒ 404 như không có. T9: khoá lạc quan trong thân (`version`), 409 `CONTRACT_STALE`, 422 `FIELD_UNKNOWN`/`FIELD_INVALID`. T10: không dùng `PackFiles.put` (tx riêng, 5 câu, để hàng mồ côi); gọi FileBox trước tx, gỡ khi tx lỗi.

## 5. Nợ mới liên quan (TECH-DEBT.md)

| # | Nội dung |
|---|---|
| 213 | `PackFiles.put` tự mở tx (N1 kit); HD1 đã bỏ dùng, còn nợ ở kit |
| 214 | Chú thích backfill `0002` ghi "qua RLS" (role không BYPASSRLS sẽ backfill 0 hàng) |
| 215 | Redis upload: `INCR` xong `EXPIRE` lỗi ⇒ khoá ngày không TTL |
| 216 | Trigger `category_ids` không đẩy outbox ⇒ chỉ mục ngoài lệch khi HD2/HD5 ghi item (HD2/HD5 phải enqueue) |
| 217 | Chưa có ca perf riêng cho `GET …/source` và `…/file` (qc) |

Minor m-01…m-15 và N-01…N-03 (vòng 2) ghi trong `review.md`. N-01: đếm câu SQL chỉ trong tx của request.

## 6. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| Đo facets p95 trên staging (dữ liệu và tải thật); nếu vượt 50 ms xét bảng tổng hợp theo tenant hoặc nới ngưỡng có lý do | Người dùng + backend-lead | Trước Gate release |
| Thêm ca perf `/source`, `/file` (#217) | qc | Đợt 2 |
| T12 smoke `bun run test:all` (không có `evidence/` trong repo) | qc-uat | Trước khi coi HD1 hoàn tất hẳn |
| Ràng buộc HD2/HD5: enqueue outbox khi ghi item (#216); xoá HĐ cấp lại ở HD5 (D-08) | HD2 / HD5 | Khi làm các lát đó |
