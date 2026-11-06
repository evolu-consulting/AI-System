# CR-122 · readiness (2026-11-06, một vòng, Luật 0d — chỉ đợt 1: F0, E1, E2, U1)

## Kết luận: READY (đợt 1, với mặc định dưới đây áp vào brief; không trái quyết định đã chốt H1–H6)
Phạm vi đã kiểm: docs/specs/CR-122/ (spec.md, tasks.md "Bản đồ file") · đối chiếu code bằng grep · mã: FLOW2-FR-01..24, NFR-01..05.

## Lỗ hổng Cao (mặc định đề xuất — điều phối áp luôn)
| # | Mức | Lát | Vấn đề | Mặc định |
|---|---|---|---|---|
| 1 | Cao | E2 | `runs/apply*.ts` là thật: `apply-driver.ts`, `apply-launch.ts`, `apply-settle.ts` (`loadHead`, `fixContext`), `apply.rules.ts` = máy trạng thái chạy bước (không phải luồng PR). Chỗ dừng "Cần xử lý" (H2) chưa ghi. | Kết thúc → `OutcomeHandler` gọi trong `apply-settle.ts` cùng tx settle; H2 = trạng thái run mới `needs_action` đặt trong `apply.rules.ts` (luật thuần) + ghi ở `apply-settle.ts`; chạy lại từ node Nếu qua `gates/run-control.service.ts`. Không thêm migration (cột status là text) — nếu có CHECK thì dùng 0109. |
| 2 | Cao | E2 | `gates/` có sẵn (`gates.service.ts`, `gate.rules.ts`, `gate-task.repo.ts`, `review-out.ts`, `back.effects.ts`). | Node Duyệt dùng lại gate task hiện có: duyệt/từ chối qua `gates.service.ts`, Trả lại qua `back.effects.ts` → Kết thúc · Trả lại (H3); nhắc/chuyển cấp dùng timer engine. |
| 3 | Cao | E1 | `FLOW_TRIGGERS` chưa có nơi đọc; spec không nói lưu ở đâu. | Cờ theo công ty: thêm vào 0106 bảng nhỏ `hub.tenant_flow_settings(tenant_id pk, flow_triggers bool default false, RLS)`; đọc qua một hàm `flowTriggersOn(tx, tenantId)` trong `processes/triggers/flags.ts`; dispatcher tắt ⇒ chỉ ghi lịch sử "lẽ ra chạy". |
| 4 | Cao | E1 | Q3 (retry/kẹt hàng đợi) còn ở "câu hỏi mở". | Áp mặc định Q3: `attempts int default 0`, tối đa 5 lần, backoff khuôn timer engine; `processed_at`/`error` trên `flow_events`; ops-watch báo chưa xử lý > 5 phút (check thêm ở M1). |

## Điểm bản đồ file báo thiếu — cách xử lý
- R1 `FlowSlotAdapter`: CÓ — `apps/hub-api/src/modules/packs/kit/application/flow.ports.ts:15` (dùng ở `approval-flow-slot.usecase.ts:55`, `community/adapters/flow-slots.ts:95`, `kit/adapters/slot-contract.check.ts`). Bản đồ sửa "không tìm thấy" → đường dẫn này. F0 thêm cổng mới cạnh nó, không gỡ.
- `process_routing_rules` chỉ SQL (0087/0096), không Drizzle: E1 KHÔNG thêm Drizzle cho bảng cũ; đọc/ghi cũ giữ bằng SQL thô như hiện tại; M1 backfill đọc bằng SQL; R1 0108 drop. Chỗ đọc cần chuyển (D6): `capabilities.repo.ts`, `ops/.../flow-coverage.check.ts`, `community-flow.mount.ts`, `scripts/process-library-backfill.ts`, `admin-api/.../onboard-approval-process`, `preflight-cr121.sql` — liệt kê cho M1/R1.

## Trung bình/Thấp (không chặn)
- TB: Q1/Q2/Q4 mặc định ở spec §6 chưa ghi vào §5 — áp như ghi.
- TB: Kiểu đầy đủ cột `flow_events`/`company_flows` (null/default/index) để E1 chốt trong Delta; index chọn flow `(tenant_id, trigger_event, enabled, position)`.
- Thấp: không có plan.md/test-plan.md riêng (đúng Luật 0b); U1 không có nhãn nguyên văn cho mọi node — lấy theo flow-model mục E.
- Thấp: AC chỉ e2e prod G1–G3; int từng lát ghi ở cột "Xong khi" là đủ cho đợt 1.

## Chưa kiểm
flow-model.md và ADR-0038 không đọc lại toàn văn (spec tuyên bố là nguồn đã chốt); đợt 2–3 (E3, A1, A2, U2, M1, Q1, R1).

## Lát A2 · community (2026-11-06, một vòng)
READY, không lỗ hổng Cao mới. Mặc định áp: (1) gói không import `processes` — ghi sự kiện qua hàm DB `hub.emit_flow_event` (0109); (2) role `community_rw` tạo SAU hub 0109 ⇒ GRANT USAGE `hub` + EXECUTE hàm đặt ở migration gói `0010_emit_flow_event_grant` (idempotent); (3) OutcomeHandler chạy tx engine nên chuyển tạm role gói + `app.*`, idempotent bằng so-sánh-và-đặt trạng thái chờ (không thêm cột); (4) cờ tắt giữ khe cũ — gỡ `flow-slots` ở R1. Trung bình: chuông bài mới khi flow Hiện bài và mở lại lượt khi sửa bài chưa làm (xem tasks A2 "Việc còn lại"). Bẫy cho A1: contracts_rw cũng cần GRANT tương tự trong migration gói contracts.
