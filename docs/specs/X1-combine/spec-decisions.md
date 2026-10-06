# X1 Combine — quyết định và kết luận

## Kết luận X1 (docs-architect, D1, 2026-10-07)

**Tóm tắt:** Chat, Admin, Hub, Studio chạy chung một stack (`combine:dev`). Chat có menu `/` và `@`, đính kèm file, đếm ngược 429, `responder`. Admin có cột `side_effect` (migration `0009`), nút Test command, tab Agent của group, Quyền hiệu lực phần agent, nút "Agent Studio". Hub bỏ nhánh `workflow_flags`, kiểm cột khi khởi động. `seed:dify` nạp app Dify có sẵn. Đóng **M5**. CR-036, 038, 040, 043, 044 "Đã áp"; CR-046 xong.

**Nghiệm thu:** `bun run done:x1` xanh (I1, 2026-10-07; số liệu từng bước ở hàng I1 trong [`tasks.md`](tasks.md)): 18 bước của lượt đủ + bước 19 contract chat 44 ca sau phân xử T10 (`1c0a503`). Smoke Dify thật (S1–S10, `DIFY_LIVE=1`) **chưa chạy** — người dùng quyết/bấm theo [`combine-test.md`](../../guides/combine-test.md) (I2).

**Review (hàng RV):** 2 vòng, APPROVED.
- Vòng 1: BE APPROVED (5 Minor). FE 2 Major (`check:fn`, `aria-expanded`; sửa `8e3804c`, `1217a62`) + 1 hồi quy code (`753068b`: diff xung đột commands AC-A07, `use-workflow-link` reset `keepValues` thay `keepFieldsRef`). Minor `a82f40b`.
- Vòng 2: APPROVED; 4 Minor (seed #3 sửa `ba5c5a7`; 3 còn lại → TECH-DEBT #90–#99).

**Tranh chấp test (T1–T10, [`test-plan §7.1`](test-plan.md)):** 10/10 **test sai, code sai 0** (T1 id upload song song, T2 lịch sử E10, T3 tên ca tự vi phạm quét tĩnh, T4 stub `GroupRef.name`, T5 PATCH không PUT, T6 "Chạy thử" hợp lệ, T7 timeout quét 16 s, T8 menu `/` còn mở khi Enter, T9 tiền đề `side_effect`, T10 >200 hội thoại trên DB dev). Cộng QC1a sửa test đã khoá L01–L13.

**Lỗi code tìm thấy khi làm:** 1 hồi quy (`753068b`) + 3 lỗi ở I1 — `8e6f464` (admin-web: `form.reset` làm mất tên command khi feature core nạp muộn, ADM-BR-01), `e84aee9` (chat-web: vòng phụ thuộc `delta.rules` ↔ reducer, component gọi fetch trực tiếp; depcruise).

**Quyết định lớn:**
1. **`side_effect` chỉ áp tool agent gọi qua MCP** (HUB-FR-95, HUB-BR-20, H2a-R21; spec §10 #13). Lệnh `/` user tự gõ là ý định trực tiếp, Hub chạy thẳng (cờ chỉ chặn retry, H2a-R13). BA thắng spec X1; S7 + combine AC08 sửa theo (T9).
2. **Dify thật dùng app có sẵn, không sửa flow** (X1-R01..R05, CR-046): không import/publish/xoá, không console API; key chỉ qua Admin secrets (đọc `.env` dự án cũ lúc chạy), không vào repo/docs/log.
3. **Flow Dify riêng cho chat để X1b** (đề xuất, chưa làm): hiện Chat dùng agent `dify-chatbot` trên app có sẵn.
4. Test command X1 chỉ `platform_admin`; `tenant_admin` và "chạy với tư cách user" → TECH-DEBT #89.

**Điểm mở:**
1. I2: người dùng test toàn luồng + smoke Dify thật (≤ 1 lần/app) — ghi kết quả vào file này.
2. Nợ: TECH-DEBT #89–#99 (smoke chưa khoá, test chờ cố định, a11y `SendErrorNotice`, SIGINT `combine.ts`, `tools/hub-dev` thiếu tsconfig, thư mục `commands` 15 file, `hub.workflow_flags` vô hiệu, 3 Minor FE vòng 1, overlay `dify-chatbot`, `check:fn` cũ).
3. Đưa lên production: mục "X1" trong [`PRODUCTION-NOTES.md`](../../PRODUCTION-NOTES.md).
4. H3c vẫn tạm dừng; H4b kế tiếp sau feedback; X1b đề xuất.
