---
id: cr122-m1-backfill
lát: cr122-m1-backfill
cr: CR-122
làn: đầy đủ (migration dữ liệu khách; Sonnet high + Opus low soát diff)
migration: hub 0107 (journal when 1805600000000)
phụ thuộc: F0..E3b, A1, A2
---
## Plan (ngắn)
Backfill khe → FlowDef + `company_flows` bằng MỘT migration theo tập, chạy lại vô hại, không xoá gì (đường khe cũ vẫn chạy khi cờ `FLOW_TRIGGERS` tắt). Bật `STRICT_DEFAULT_FLOW`. Báo cáo bóng `bun run flow:shadow-diff`.

## Làm
- `packages/db/migrations-hub/0107_flow_backfill.sql` + journal: (A) def Thư viện có khe ⇒ `trigger {event}` + `app` + node Kết thúc (outcome dương tính) cuối `stages`, release v+1 (release cũ + `slot_body` giữ); (B) bản riêng Q9 cùng đổi; (C) `company_flows`: luật `is_default` ⇒ Bật position 900+priority; công ty bật app chưa có luật ⇒ mẫu khe; luật điều kiện (phòng ban × loại HĐ) ⇒ bản công ty mang `trigger.when` (Group mã → id), position = priority; Q9 Bật ⇒ gốc Tắt `replaced`.
- `tools/scripts/src/check-app-events.ts`: `STRICT_DEFAULT_FLOW = true`; flow mặc định chỉ tính "đã seed" khi migration nói tới `trigger`.
- `apps/hub-api/scripts/flow-shadow-diff.ts` + `package.json` `flow:shadow-diff`.
- Test: `apps/hub-api/src/modules/processes/library/flow-backfill.int.test.ts`.

## Không làm / Chạm
Không đụng engine/node, admin-web, DLC (`dlc.*` bị loại khỏi map), `process_runs`, `tenant_flow_settings` (cờ tắt). Chưa làm: ops check bóng (`flow-coverage.check.ts`), `seed-niti.ts`/`rename-process-defs.ts`, `preflight-cr121.sql`, audit ghi xuất bản v+1.

## Test tối thiểu
int backfill: chạy migration thật 3 lần ⇒ y hệt; contract.submitted chọn flow như `routeSlot` (8 ca, 4 công ty); lượt cũ không đổi; chặn chéo tenant. `bun run check:app-events` (strict).

## Quyết định trong lúc làm
- Kết thúc thêm vào CUỐI stages, một node (`approved|accepted|shown|accepted|kept`); stage cũ (kể cả `contracts-route/finalize`) giữ nguyên theo brief.
- Luật điều kiện không chuyển được (phòng ban đã xoá, khe community, thiếu Group mã) ⇒ không tạo, NOTICE đếm; đường khe cũ vẫn chạy.
- Công ty có luật nhưng không mặc định (như W) ⇒ không thêm mặc định (đúng đường cũ chặn `route_none`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: cờ `FLOW_TRIGGERS` mặc định tắt — đường khe cũ vẫn mở lượt; migration chỉ thêm `trigger`/`app`/node Kết thúc/release mới và dòng `company_flows` mà bộ điều phối chỉ ghi bóng; kiểm bằng int `flow-backfill.int.test.ts`).

## Việc còn lại
- A1/A2 chỉ phát `flow_events` khi cờ BẬT (`approval.usecase.ts:91`, `community flows.service`) ⇒ bóng chưa có dữ liệu; phải phát cả khi tắt (chỉ bỏ nhánh mở lượt cũ khi bật) trước khi dùng `flow:shadow-diff`.
- ops check so lệch bóng + "sự kiện bắt buộc × công ty thiếu flow không điều kiện = 0" (`flow-coverage.check.ts`); `seed-niti.ts`/`rename-process-defs.ts` (D7); `preflight-cr121.sql`; audit publish v+1.
- Mô phỏng 4 HĐ mẫu trên prod: chạy `flow:shadow-diff` sau khi bóng có dữ liệu.
