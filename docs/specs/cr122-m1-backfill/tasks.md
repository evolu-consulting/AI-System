---
id: cr122-m1-backfill
lát: cr122-m1-backfill
cr: CR-122
làn: đầy đủ (migration dữ liệu khách; Sonnet high + Opus low soát diff)
migration: hub 0111 (journal when 1806100000000; 0107 bỏ trống — máy đã áp 0109/0110 sẽ bỏ qua `when` nhỏ hơn)
phụ thuộc: F0..E3b, A1, A2
---
## Plan (ngắn)
Backfill khe → FlowDef + `company_flows` bằng MỘT migration theo tập, chạy lại vô hại, không xoá gì (đường khe cũ vẫn chạy khi cờ `FLOW_TRIGGERS` tắt). Bật `STRICT_DEFAULT_FLOW`. Báo cáo bóng `bun run flow:shadow-diff`.

## Làm
- `packages/db/migrations-hub/0111_flow_backfill.sql` + journal: (A) def Thư viện có khe ⇒ `trigger {event}` + `app` + node Kết thúc (outcome dương tính) cuối `stages`, release v+1 (release cũ + `slot_body` giữ); (B) bản riêng Q9 cùng đổi; (C) `company_flows`: luật `is_default` ⇒ Bật position 900+priority; công ty bật app chưa có luật ⇒ mẫu khe; luật điều kiện (phòng ban × loại HĐ) ⇒ bản công ty mang `trigger.when` (Group mã → id), position = priority; Q9 Bật ⇒ gốc Tắt `replaced`.
- `tools/scripts/src/check-app-events.ts`: `STRICT_DEFAULT_FLOW = true`; flow mặc định chỉ tính "đã seed" khi migration nói tới `trigger`.
- `apps/hub-api/scripts/flow-shadow-diff.ts` + `package.json` `flow:shadow-diff`.
- Test: `apps/hub-api/src/modules/processes/library/flow-backfill.int.test.ts`.

## Không làm / Chạm
Không đụng engine/node, admin-web, DLC (`dlc.*` bị loại khỏi map), `process_runs`, `tenant_flow_settings` (cờ tắt). Chưa làm: ops check bóng (`flow-coverage.check.ts`), `seed-niti.ts`/`rename-process-defs.ts`, `preflight-cr121.sql`, audit ghi xuất bản v+1.

## Test tối thiểu
int backfill: chạy migration thật 3 lần ⇒ y hệt; contract.submitted chọn flow như `routeSlot` (8 ca, 4 công ty); lượt cũ không đổi; chặn chéo tenant. `bun run check:app-events` (strict).

## Sửa sau soát điều phối
- Đổi số migration 0107 → 0111 (`when` 1806100000000, sau 0109/0110).
- Bóng có dữ liệu: A1 (`startApproval`, `handleExtractJob`, duyệt xong, tải lên) và A2 (đăng bài, xin tham gia, báo cáo) phát sự kiện CẢ KHI cờ tắt (cờ chỉ quyết có mở lượt/bỏ đường cũ). Không cổng/lỗi cổng ⇒ `FLOW_OFF` ⇒ không phát. Int: community cờ tắt ⇒ có event + `outcome.shadow`, 0 `process_runs` có `flow_event_id`.
- `contract.uploaded` thành `decides` (manifest contracts): luật điều kiện (position = priority) trước, mặc định (900+) sau ⇒ chỉ một flow, như đường cũ. Test dispatcher/perf chuyển sang kỳ vọng mới (perf dùng `contract.approved` làm sự kiện không decides).

## Bước kiểm khi chạy prod (đọc trước khi bật cờ bất kỳ công ty nào)
1. Đọc NOTICE của migration: "N luật điều kiện không chuyển được" ⇒ liệt kê luật đó (`process_routing_rules` không có bản công ty tương ứng) và quyết định trước khi bật cờ công ty đó.
2. Công ty CÓ luật nhưng KHÔNG có luật mặc định (đường cũ chặn `route_none`): sau backfill không có flow không điều kiện cho `contract.submitted` ⇒ truy vấn `company_flows` ∖ flow không có `trigger.when`; xử lý (gán mặc định hoặc chấp nhận chặn) trước khi bật.
3. `flow:shadow-diff` = 0 lệch trên Demo ít nhất một ngày có HĐ gửi duyệt thật, rồi mới bật cờ.

## Quyết định trong lúc làm
- Kết thúc thêm vào CUỐI stages, một node (`approved|accepted|shown|accepted|kept`); stage cũ (kể cả `contracts-route/finalize`) giữ nguyên theo brief.
- Luật điều kiện không chuyển được (phòng ban đã xoá, khe community, thiếu Group mã) ⇒ không tạo, NOTICE đếm; đường khe cũ vẫn chạy.
- Công ty có luật nhưng không mặc định (như W) ⇒ không thêm mặc định (đúng đường cũ chặn `route_none`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

Không thay đổi hành vi (lý do: cờ `FLOW_TRIGGERS` mặc định tắt — đường khe cũ vẫn mở lượt, người dùng không thấy khác; app chỉ phát thêm `flow_events` để ghi bóng; migration chỉ thêm `trigger`/`app`/node Kết thúc/release mới và dòng `company_flows` mà bộ điều phối chỉ ghi bóng; kiểm bằng int `flow-backfill.int.test.ts`).

## Việc còn lại
- ops check so lệch bóng + "sự kiện bắt buộc × công ty thiếu flow không điều kiện = 0" (`flow-coverage.check.ts`); `seed-niti.ts`/`rename-process-defs.ts` (D7); `preflight-cr121.sql`; audit publish v+1.
- Mô phỏng 4 HĐ mẫu trên prod: chạy `flow:shadow-diff` sau khi bóng có dữ liệu.
