# ADR-0038 · Mô hình flow theo sự kiện (node Bắt đầu khi + `company_flows`)

Trạng thái: **Accepted** (người dùng, 2026-11-06 — CR-122, "Chốt theo mặc định" mục A–I và H1–H6 của `docs/platform/flow-model.md`; bổ sung node Công cụ).
**Thay thế ADR-0035, ADR-0036; sửa ADR-0030 §3.** Liên quan: ADR-0017 (engine bền, snapshot lượt), ADR-0031 (cổng gói↔gói), ADR-0032 (Delta).

## Bối cảnh
CR-118 → 121 dựng "khe" (`process_slots`) + luật định tuyến (`process_routings`, `process_routing_rules`) + `slot_body` + `FlowSlotAdapter`, và giữ `Flow` riêng của contracts (~30 file, `withConfirmStep`). Sai ý người dùng ("flow là xương sống mọi app; flow động; tenant admin sửa được; nhất quán"): mỗi app chỉ một flow mỗi khe, chọn flow bằng luật ngoài sơ đồ, hai định dạng flow, bước ẩn (route/finalize/confirm), UI lộ chữ "khe" (vi phạm Luật GỐC 3), Community 3 khe cố định, DLC buộc theo khe.

## Quyết định
Nguồn đầy đủ: `docs/platform/flow-model.md` (không chép lại ở đây). Tóm tắt:
1. **Một định dạng `FlowDef`** cho Thư viện, bản công ty, mẫu chạy thử; `stages[]` giữ định dạng engine hiện có (+ `next_step`, `outcome`), thêm `trigger {event, when?}`. Bỏ `slot_body`, `Flow` riêng contracts.
2. **Nhiều flow mỗi app**, mỗi flow có đúng một node **Bắt đầu khi** theo sự kiện app khai trong manifest `events[]` (thay `AppSlotDecl`; `check:app-events` thay `check:app-slots`).
3. **`company_flows`** (tenant, flow, `enabled`, `replaced_by`, `position`) là nguồn duy nhất "công ty có flow nào, đang bật không"; thay `process_tenant_defs` + `process_routings` + `process_routing_rules` + `process_slots`.
4. **Chạy khi** flow Bật cho công ty **và** sự kiện khớp. Khớp nhiều: chạy tất cả; sự kiện `decides` chỉ flow đầu tiên theo thứ tự (H1). Idempotent `(tenant, event_id)`, sự kiện ghi cùng transaction với bản ghi.
5. **Clone dùng thay**: xuất bản lần đầu ⇒ bản sao Bật + gốc tự Tắt (`replaced_by`), một tx; "Quay về bản gốc" đảo lại.
6. **Không bước ẩn**: Duyệt, Nếu (đọc dữ kiện hiện tại qua `FactsReader` + gộp nhánh `next_step`), Ký số (node app), Kết thúc (`outcome` → `OutcomeHandler`), Công cụ (workflow Dify / tool MCP / tool app) đều là node. "Trả lại" = Kết thúc · Trả lại (H3).
7. **Sửa ADR-0030 §3**: bước route/finalize/confirm của duyệt HĐ không còn là bước hệ thống ẩn; thành node Duyệt/Kết thúc. ADR-0030 §6 (finalize idempotent, an toàn khi giá trị đổi) giữ, chuyển vào `OutcomeHandler` (H2).
8. **DLC (Rowan) không đụng**: giữ một cổng đọc chỉ cho `dlc.*` (chữ ký `resolveSlot`); khe chỉ còn bên trong DLC.

## Hệ quả
- Engine chỉ cộng thêm (trigger, hàng đợi sự kiện, node mới); lượt cũ chạy nốt theo snapshot (`after.branch`, `contracts-route`, `contracts-finalize`).
- Chuyển đổi (backfill 2 công ty prod, cờ `FLOW_TRIGGERS` chạy bóng, bật Demo trước rồi NiTi, gỡ code + bảng cũ sau một bản phát hành khi 0 lượt cũ mở — D6): `docs/specs/CR-122/spec.md` mục 4.
- Tài liệu mâu thuẫn phải sửa khi xong: `docs/specs/CR-122/spec.md` mục 8. `CLAUDE.md` (Luật GỐC 2 "khe flow") do điều phối sửa với người dùng.
- Rủi ro: trigger/dispatcher là đường nóng mới (p95 ≤ 5 ms chọn flow); hai flow `decides` khớp cùng sự kiện bị cảnh báo trên danh sách công ty.
