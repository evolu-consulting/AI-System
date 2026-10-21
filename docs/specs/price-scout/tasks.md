---
id: price-scout
title: Dò giá thị trường — agent Hub `price-scout`, cấu hình theo SP/nhóm, lịch dò, cảnh báo Cần xử lý, quản lý usage + trần tháng
lane: đầy đủ một phần (RLS bảng mới, trần/usage, vòng nền perf) — một agent, Luật 0b
---
# price-scout — tasks

## Plan (đã làm)
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Hub 0052 (`when` 1795900000000): `usage_logs.trigger_kind`/`subject_id` + `hub.log_ai_usage_v4` (app, agent_id, trigger, subject) | xong |
| 2 | Cổng nền `lib/ai-client/agent-call.ts` (`AgentCaller`: model + lệnh hệ thống từ `hub.agents`/profile, qua AI client chung) + `modules/agents/agent-spec.service.ts` (1 câu) | xong |
| 3 | Seed agent `price-scout` (`agents.yaml`, agentic-cli, `$HUB_SEED_PROFILE:std`); Studio sửa model/prompt, `studio_overrides` giữ | xong |
| 4 | Contracts 0040 (`when` 1796700000000): `price_scout_defaults`, `price_scout_configs` (lịch, lease), `price_scout_usage` (ngày), `price_scout_quota`, `price_scout_alerts`; RLS `secure_table`; job role đọc cột lịch | xong |
| 5 | Gói: domain `price-scout.rules.ts` (+ types), use case cấu hình/dò tay/vòng lịch, repo, route `/products/:id/price-scout`, `/price-scout/defaults`, `/price-scout/quota`; "Tìm giá" (`/suppliers/search`) đi qua agent; bỏ model/prompt cứng (`price-search.rules.ts` chỉ còn parse) | xong |
| 6 | Cần xử lý: nguồn `market_price` "Giá thị trường thay đổi" (`todo.repo.ts`) | xong |
| 7 | FE: panel "Cấu hình dò giá" (tab NCC & giá), Cài đặt › Dò giá thị trường (mặc định nhóm + trần), lỗi `SCOUT_MONTHLY_CAP`, Cần xử lý | xong |
| 8 | Test: unit `price-scout.rules.test.ts`, `agent-call.test.ts`, FE `lib/scout.test.ts`; int `tests/acceptance/price-scout/price-scout.int.test.ts`; perf `…/perf/due-pick.perf.int.test.ts`; deployed `e2e/deployed/09-price-scout.deployed.ts` (viết, chưa chạy) | xong |

## Quyết định trong lúc làm
- D1 Agent chạy qua AI client chung (không qua run/job Hub): lời gọi một lượt, JSON chặt, cần usage từng lời gọi + trần token. Runtime `agentic-cli`/`llm` ⇒ nhà cung cấp của AI client (mặc định gói Claude CLI + WebSearch); thay thế: `AI_PROVIDER_CONTRACTS_PRICE_SCOUT=api` (Anthropic API + web_search, Studio đặt model id đầy đủ). `dify-*` không chạy ở cổng này ⇒ 503. Agent tắt/chưa seed ⇒ 503 `SEARCH_UNAVAILABLE`.
- D2 Agent không cấp cho tenant (không hiện trong chat); gói gọi được vì quyền `contracts-write` của người gọi / vòng nền.
- D3 Riêng tư: lời nhắc = JSON {product, keywords, spec, unit, include_sites, exclude_sites, watched_suppliers, region, vat}. Tên NCC theo dõi là tên công khai người dùng tự gõ (cho phép); không MST/HĐ/tên đối tác lấy từ hồ sơ.
- D4 Cấu hình: jsonb; SP lưu ghi đè (khoá vắng = theo nhóm), nhóm = `service`/`goods` (Giới thiệu không có). Mặc định hệ thống: tắt, VAT chưa, lịch off.
- D5 Lịch: chưa dò ⇒ tới hạn ngay; tuần +7 ngày; tháng +1 tháng lịch (kẹp cuối tháng) — TS (`nextScoutAt`) và SQL (`NEXT`) cùng luật. Lỗi agent ⇒ thử lại sau 1 ngày. SP mới của nhóm có mặc định dò theo lịch: tạo hàng lịch mỗi giờ (`materialize`, 1 câu/tenant) và ngay khi lưu mặc định nhóm.
- D6 Vòng nền khuôn HD4: role `contracts_job` tìm tenant tới hạn; tx tenant MỘT câu nhận lô `FOR UPDATE SKIP LOCKED` với n = min(lượt đồng thời còn trống [env `CONTRACTS_PRICE_SCOUT_CONCURRENCY`=2], trần ngày [`…_DAILY`=50], trần tháng còn lại; hết token tháng ⇒ 0); agent gọi song song ngoài tx; MỘT câu lưu cả lô. Kết quả theo lịch TỰ LƯU (nguồn market, `created_by` null); bấm tay vẫn tick rồi lưu như V2-J2.
- D7 Trần tháng = platform ghi đè ?? tenant admin ?? hệ thống (`CONTRACTS_PRICE_SCOUT_MONTHLY`=300 lượt; token không trần nếu không đặt). Đếm lượt = tay + lịch theo ngày lịch tenant. Lượt tay giữ chỗ bằng một câu (insert…where dưới trần); không tới nhà cung cấp (503/hết token ngày) ⇒ trả lượt. Trần "mềm": các lượt bấm đồng thời ở biên có thể vượt ≤ số lượt đang chạy. Ghi đè platform: chỉ JWT role `platform_admin` gửi `platform_*` (PUT quota trong tenant đó).
- D8 VAT "gồm" ⇒ quy về chưa VAT ÷ 1,1 (bảng so sánh lưu giá chưa VAT), ghi chú cách quy đổi.
- D9 Cảnh báo (chỉ lượt theo lịch): giá mua mới thấp nhất lệch giá vốn BQ (thành phần chính) ≥ n%; NCC theo dõi có giá mua mới khác lần lưu market trước. Nguồn Cần xử lý ≤ 30 ngày, cả tenant thấy, Bỏ qua/Đã xong theo người.
- D10 Usage: mỗi lượt ghi `hub.usage_logs` feature `contracts.price_scout`, app `contracts`, `agent_id` = price-scout, `trigger_kind`, `subject_id` = id SP ⇒ `usage_daily(_dim)` có agent/feature ⇒ màn Usage analytics lọc được không cần đổi (int kiểm dòng `usage_daily_dim`).

## Tranh chấp test (khoá)
- `tests/acceptance/V2-J2/suppliers.int.test.ts:59` kỳ vọng lời nhắc cứng `Tìm giá nhà cung cấp cho sản phẩm: "…"` và không seed agent — hành vi đã thay theo yêu cầu (prompt ở agent Hub, lời nhắc = JSON dữ liệu). qc: seed agent `price-scout` trong `_support/v2j2.ts` (như int price-scout) + kỳ vọng `JSON.parse(prompt).product`.
- `tests/acceptance/H3a/db.int.test.ts`: thêm 2 cột cuối `trigger_kind`, `subject_id` (như usage-analytics đã làm với `app`/`outcome`) — qc relock.

## Kết quả test (2026-10-21)
- Unit local: hub-api domain contracts + ai-client 277 pass; contracts-web product-suppliers/overview/settings 31 pass; typecheck hub-api, contracts, contracts-web, tests sạch; i18n OK; check:size OK.
- Int (evotest, `-Dirty`): `price-scout.int.test.ts` 4 pass + `H3a/db.int.test.ts` 4 pass.
- Perf (evotest): nhận lô trên 100.000 SP tới hạn (+100.000 nền) p95 **73,6 ms → 4,0 ms** (LIMIT hằng = số lượt đồng thời rồi cắt theo n trong CTE — LIMIT dạng truy vấn con làm planner bỏ index); tìm tenant p95 1,0 ms.
- Chưa sạch, có sẵn trước lát: `depcruise` (`kit/application/context.ports.ts`), `check:pack-sql` (0039), `check:fn` (app.ts, runs.service, 2 test).
- e2e: viết `09-price-scout.deployed.ts`, chưa chạy.

## Việc còn lại
- Chạy `e2e/deployed/09-price-scout.deployed.ts` sau deploy (migrate hub 0052 + contracts 0040, `hub:seed`).
- Màn admin-web cho platform_admin đặt trần tenant khác (hiện chỉ trong Cài đặt của tenant khi đăng nhập platform_admin).
