---
id: usage-analytics
fr: [ADM-FR-42]
lane: full (tenant isolation + migration + perf path) — one agent, Luật 0b
---
# usage-analytics — Phân tích token cho màn Usage (Admin)

## Plan (≤ 1 trang)
1. **Dữ liệu (hub 0049)**: `hub.usage_logs` + `app`, `outcome` (nullable); `hub.runs.surface`. Ghi:
   - AI client (contracts.extract / price_search / partner-search, knowledge.rerank/graph) → `hub.log_ai_usage_v3` (+ outcome ok/error/cancelled; app = tiền tố feature).
   - Runtime agent (chat, dock, phòng, quy trình) → Hub gắn khi job xong: `hub.tag_run_usage(tenant, run, stage, ok)` (thay `tag_chat_usage`): feature `chat` (trừ stage — giữ ngữ nghĩa trần token), app `process|rooms|<surface>|chat`, outcome.
   - Dock Sổ Hợp Tác gửi header `X-Ai-Surface: contracts` → `hub.set_run_surface` (một câu, sửa cả dòng đã gắn `chat`).
   - `hub.usage_daily` (ngày VN) giữ bằng trigger THEO CÂU LỆNH (bảng chuyển tiếp, set-based) cho INSERT/UPDATE/DELETE/TRUNCATE; backfill một câu. RLS admin_rw (platform/tenant).
2. **API admin-api** (`modules/usage-analytics`): `GET /admin/usage/analytics` (KPI kỳ này + kỳ trước, chuỗi ngày/tuần/tháng × app, MỘT câu GROUPING SETS cho mọi breakdown + cây app→agent→feature→model, nhãn theo lô), `GET /admin/usage/records` (keyset), `/records.csv` (≤ 50k), `GET /admin/usage/runs/:id`. Lọc tenant/app/feature/agent/model/user/outcome. Tenant theo actor + RLS; tenant_admin không thấy `cost_usd`.
3. **admin-web** `/usage/analytics` + tab trên `/usage`: lọc, KPI so kỳ trước, cột chồng theo app, breakdown (app/agent/tier/model/feature/user/tenant), bảng "token đổ vào đâu", quota tháng (báo cáo M4), bản ghi + CSV + drill-down run. vi/en.

## Quyết định trong lúc làm
- Rollup bằng trigger theo câu lệnh (không cron): đúng ngay cả khi Hub gắn nhãn sau (UPDATE dời dòng tổng hợp). `runs` = dòng sớm nhất của run (cộng dồn được; hai job cùng run ghi đồng thời có thể lệch 1 — chấp nhận).
- `cost_usd` = chi phí ước tính theo bảng giá (`pricing.ts`); gói Claude = 0, token vẫn đếm. Ẩn với tenant_admin như M4-AC03.
- Admin không đọc `hub.agents` (A51) ⇒ hàm `hub.agent_labels(uuid[])` SECURITY DEFINER.
- Bản ghi thô: bảng không RLS ⇒ tenant luôn từ actor + JOIN `admin.tenants` (RLS).
- Lời gọi bị chặn trước nhà cung cấp (CAP_EXCEEDED/UNAVAILABLE) không ghi dòng (0 token) — như trước.
- Màn cũ `/usage` giữ nguyên (e2e khoá), thêm thanh tab.
- Hai bảng tổng hợp: `usage_daily` (đủ chiều, có user) và `usage_daily_dim` (không user/provider; trigger trên `usage_daily`
  cộng chênh lệch). Không lọc user ⇒ KPI/chuỗi/breakdown đọc `_dim`; top user đọc `usage_daily`. Lần đo đầu chỉ một bảng:
  platform 90 ngày p95 1307,6 ms (180.000 dòng tổng hợp) — không đạt ⇒ tách bảng gọn.
- Int/perf của admin-api chạy trên DB đầy đủ Admin + Hub (template `full`, gọi service + scope RLS thật): DB test Admin
  (`createM4Env`) chỉ có stub hub (không có cột/bảng hub 0049).

## Kết quả (evotest)
- int: 6 file, 26 pass (analytics.int + H1/db, H3a/db, hub-rls, M3D/ai-usage, AI-SUB).
- perf (1.000.000 dòng, 90 ngày, 4 tenant, 1000 user; `usage_daily` 180.000 dòng): p95 analytics platform 90 ngày/tuần
  266,9 ms · một tenant 30 ngày lọc app 12,0 ms · trang bản ghi 5,1 ms (ngưỡng 300 ms). Seed 1M dòng qua trigger 59,7 s.

## Test
- unit: `analytics.rules.test.ts`, `admin-web …/lib/view.test.ts`, sửa `chat-usage.test.ts`, `ai-client.test.ts`.
- int: `analytics.int.test.ts` (3 endpoint + chặn chéo tenant); sửa kỳ vọng cột `H3a/db.int.test.ts`, policy `hub-rls.int.test.ts`.
- perf: `analytics.perf.int.test.ts` (1M dòng, p95 ≤ 300 ms).
- e2e (viết, chưa chạy): `e2e/usage-analytics.spec.ts`; deployed `e2e/deployed/07-usage.deployed.ts`.

## Còn lại
- Chạy e2e cuối đợt; deployed: `deploy/prod-sohoptac2/e2e-deployed.ps1 -Spec e2e/deployed/07-usage.deployed.ts -User <platform-admin>` sau khi deploy (migration hub 0049).
