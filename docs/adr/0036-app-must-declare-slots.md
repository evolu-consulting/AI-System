# ADR-0036 · Mọi app phải khai báo khe flow; gán quy trình có một nguồn

Trạng thái: **Accepted** (người dùng, 2026-11-05 — CR-120 "Flow là xương sống thật"). Liên quan: ADR-0017 (engine bền), ADR-0030,
ADR-0035 (FlowRuntime + FlowSlotAdapter), `docs/specs/CR-120/spec.md`.

## Bối cảnh
Flow chỉ chạy ở một khe (`contracts.approval`), Community 0 khe, runtime tắt ở prod. Gán quy trình nằm ở HAI bảng
(`process_slot_assignments` CR-105 và `process_tenant_defs`/luật CR-118) ⇒ lỗi prod: tenant gán cũ không thấy quy trình ở Cài đặt
(vá tạm bằng hub 0089). Không có gì chặn một app mới ra đời không có flow.

## Quyết định
1. **App phải có khe:** manifest app (`@ai/contracts/app-manifest`) khai báo ≥ 1 khe với `purpose`, `required`, `defaultDefKey`,
   `allowedKinds`, `trigger`; mỗi khe có `SlotSpec` + `FlowSlotAdapter` đăng ký lúc mount gói và hàng `hub.process_slots` + def
   mặc định đã xuất bản. `bun run check:app-slots` (pre-commit + CI) đỏ khi app 0 khe; ops-watch đỏ khi khe thiếu adapter/def.
2. **Một nguồn gán:** `hub.process_tenant_defs` (tập đã gán) + `hub.process_routing_rules` (luật, `is_default` = def hiệu lực) là
   nguồn duy nhất. `process_slot_assignments` thành VIEW dẫn xuất (CR-120), xoá ở CR-121. `process_slots.default_def_id` chỉ là mẫu
   cấp phát khi tenant bật app.
3. **Bất biến:** tenant bật app ⇒ mỗi khe bắt buộc (cổng mức/add-on đạt) có def hiệu lực; giữ bằng cấp phát idempotent
   (`ensureSlotDefaults`) và kiểm bằng ops-watch + e2e prod.
4. **Bảng mới thay bảng cũ ⇒ backfill** trong cùng lát (migration + int "tenant cũ thấy dữ liệu"); thiếu = Blocker khi review.
5. Flow runtime mặc định bật; `HUB_FLOW_RUNTIME=off` là công tắc rollback.

## Hệ quả
- Thêm app = thêm manifest + ≥ 1 khe + adapter + def mặc định; không còn app "không flow".
- Đường gán cũ (PUT/DELETE process-slots, onboarding `assignByKey`) ghi vào luật mặc định; đọc chỉ một câu SQL (Luật 4c).
- Một bản phát hành giữ VIEW + endpoint approvals cũ để rollback; sau đó xoá.
