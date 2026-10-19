---
id: HD2-extract-verify
fr: [HD-FR-21, HD-FR-22, HD-FR-23, HD-FR-24, HD-FR-25, HD-FR-26]
nguon: docs/platform/intake-hd.md (HD2 — R2, R3, R4, R5, R6, R8, R15), CR-094 đợt 2
nen: docs/specs/HD1-contracts-base/ket-luan.md
lan: đầy đủ một phần (tenant + prompt injection) · nhanh cho màn hình
---
# HD2 — AI đọc hợp đồng + kiểm trích dẫn + màn kiểm/sửa

## 1. Phạm vi
**Làm**
| Mã | Nội dung | Nguồn mgmt-app |
|---|---|---|
| HD-FR-21 | Agent trích 23 trường + hàng hoá + điều khoản, mỗi trường kèm `quote` nguyên văn. Văn bản HĐ là **dữ liệu không tin cậy** (HUB-BR-31): rào bằng thẻ có nonce, lệnh hệ thống cấm làm theo chỉ dẫn trong văn bản, đầu ra zod strict (khoá lạ ⇒ hỏng, không ghi). Agent không có tool | `extract.py` |
| HD-FR-22 | Kiểm trích dẫn (luật thuần TS): quote có trong văn bản (chịu được chữ PDF bị tách), số/ngày khớp quote, số tiền tiếng Việt ("1,5 tỷ", "1.500 triệu"). ≤ 5 ms cho HĐ 30.000 ký tự | `verify.py` |
| HD-FR-23 | Cảnh báo luật: ngày ngược, tổng dòng hàng lệch > 1 %, MST sai định dạng, VAT chưa rõ, tự gia hạn thiếu số ngày báo trước, chưa rõ chiều mua/bán; cảnh báo Cục Thuế (MST không tồn tại, ngừng hoạt động, tên khác) | `verify.py:76-140` |
| HD-FR-24 | Khởi chạy trích sau tải lên (không chặn upload), trích lại `POST …/:id/extract`; trích lại giữ trường `edited` (HD-BR-01) | `ingest.py:63-98` |
| HD-FR-25 | Tra MST Cục Thuế (Q10): cổng `TaxRegistry`, adapter HTTP có egress cấu hình (`CONTRACTS_TAX_LOOKUP_URL`, vắng ⇒ tắt), cache, nghỉ khi 429; transport giả cho test | `companies/registry.py` |
| HD-FR-26 | Nhập tay HĐ không file (Q15) `POST /pack/contracts/contracts/manual`; màn S04 `/contracts/new`, S05 `/contracts/$id` port nguyên giao diện (D-02) | `manual.py`, `NewContractPage.tsx`, `ContractPage.tsx` |

**Không làm:** flow duyệt / nút "Xác nhận" (HD3), trạng thái theo ngày + nhắc hạn (HD4), xoá HĐ, đối tác/pháp nhân của mình (HD8), engine N2.

## 2. Hành vi
- Tải lên ⇒ hàng `extracting` ⇒ hàng đợi trích (trong tiến trình hub-api, đồng thời ≤ 2) chạy agent ⇒ `verify` ⇒ ghi `fields` (gộp `edited`), `items` (chỉ khi HĐ chưa có dòng nào — `contract_items` không có quyền DELETE, D-08), `clauses`, `warnings`, `status = needs_review`, event `extracted`, outbox. Agent lỗi/đầu ra hỏng ⇒ `extract_failed` + `error` là mã (không lộ nội dung).
- Trích lại: chỉ khi `status ∈ {needs_review, extract_failed}` và có văn bản/tệp; đang `extracting` ⇒ 409 `EXTRACT_BUSY`.
- Nhập tay: trường `edited: true, verified: true`, `quote ""`; `direction` chọn ⇒ đối tác vào bên bán (mua vào) hoặc bên mua (bán ra); trạng thái `needs_review` (duyệt ở HD3, Q1). Tra MST nhanh (≤ 4 s), lỗi/chậm ⇒ bỏ qua cảnh báo Cục Thuế.
- Quyền: `write` cho extract/manual; đọc như HD1. Mọi câu SQL qua `PackUow` (RLS tenant); id tenant khác ⇒ 404 như không có.

## 3. Quyết định trong lúc làm (Luật 2)
| # | Quyết định |
|---|---|
| D2-01 | **Gọi agent:** cổng `ExtractionAgent` + `AgentTransport` (agent Claude trong Agent Hub, không Dify, không tool). Chạy agent qua job Hub cần run nền (hội thoại/flow/run ẩn) — đúng phần N2 `PackRunsBridge` (R14, đang làm song song); HD2 không đụng `modules/processes|runs`. Chưa tiêm transport ⇒ không chạy lượt trích: tải lên giữ hành vi HD1 (`extracting`), trích lại 503 `AGENT_UNAVAILABLE` (trước mọi SQL). Test int/e2e dùng transport giả tất định; transport trả mã lỗi ⇒ `extract_failed` + mã |
| D2-02 | Hàng đợi trích trong tiến trình (không bảng mới, không migration). Mất khi hub-api khởi động lại ⇒ hàng kẹt `extracting`; nợ TECH-DEBT #218 (vòng quét theo tập khi có N2/engine) |
| D2-03 | Không có danh bạ pháp nhân của mình (HD8) ⇒ HĐ tải lên `direction` null ⇒ cảnh báo `direction_unknown`; nhập tay có `direction` ⇒ không cảnh báo |
| D2-04 | Nhập tay để `needs_review` (không tự `active` như `manual.py`): Q1 bắt buộc kiểm/duyệt |
| D2-05 | Màn S05 bỏ nút "Xác nhận" (HD3) và khối "Ghi việc" (HD7); "Lưu" dùng PATCH HD1 (`version`). Lệch ghi `e2e/contracts-web/DEVIATIONS.md` |
| D2-07 | Tra MST nằm ở `apps/hub-api/src/lib/tax-registry.http.ts` (egress Hub), `packs.mount.ts` tiêm vào gói qua cổng `TaxRegistry` — module gói không gọi HTTP (PK-AC12) |
| D2-08 | Trích lại khi HĐ đã có dòng hàng: giữ dòng cũ (`contract_items` không có quyền DELETE — D-08 HD1); chỉ trường được gộp |
| D2-06 | Tra MST không ngủ chờ lượt (Luật 4c): cache 24 h/1 h, 429 ⇒ nghỉ theo `Retry-After`, trả `unavailable` |
