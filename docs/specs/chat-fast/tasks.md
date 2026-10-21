# chat-fast — câu trả lời chat nhanh hơn (Luật 0b, Luật 4c)

Làn: **đầy đủ về quyền** (định tuyến chạm HUB-BR-03) nhưng không đổi luật quyền — dùng lại đúng hàm AU. Nhánh `slice/chat-fast`.

## 1. Đo (trước)

Không đọc được DB/log production (sohoptac2) từ phiên này (bị chặn "Production Reads"); số dưới lấy từ (a) smoke thật `claude-sub`
(`docs/specs/H2b-routing/smoke.md`, CLI 2.1.286, 2026-10-05) và (b) perf int mới trên evotest với Runtime kịch bản (Hub thật, không CLI).

**Một job `agent.cli` (đường thật, smoke SM1 sau sửa F1, run `direct @assistant`):**

| Đoạn | Thời gian | Nguồn |
|---|---|---|
| E12 → `run.started` + INSERT job + NOTIFY (Hub) | 34 ms p50 / 41 ms p95 (fake) | perf (b) |
| claim (LISTEN/NOTIFY) → spawn job host Python → import SDK → spawn CLI → CLI sẵn sàng (`session`) | ≈ 7,4 s (= delta đầu 9,15 s − 1,7 s); riêng CLI start dao động **1,1–6,7 s** | smoke SM1, SM3b |
| CLI `session` → token đầu (model) | 1,7 s | smoke SM1 |
| sinh hết câu trả lời (~800 ký tự, stream đều, 85 `job.delta`) | +3,9 s (tới `final` 5,8 s) | smoke SM1 |
| `job.delta` → SSE `delta` (Hub, Redis → SSE) | p95 ≤ 150 ms (PF3 H2b) | perf H2b PF3 |
| nginx | `proxy_buffering off`, không gzip trên `/conversations`, `/runs` ⇒ không đệm | `deploy/prod-sohoptac2/nginx.conf` |
| **Tổng 1 job** | first delta ≈ 9 s, xong ≈ 13 s | smoke SM1 |

**Tin AI System không tag (trước):** 2 job nối tiếp — Orchestrator (haiku, không stream khi `delegate`) rồi agent (sonnet):
2 × (dispatch + spawn + CLI start ≈ 3–7 s) + quyết định Orchestrator (~1–2 s JSON) + agent (token đầu 1–2 s + sinh 4–6 s + tool) ⇒
**17–25 s** như người dùng thấy; token đầu chỉ tới sau khi job Orchestrator xong **và** job agent khởi động xong. Dock hợp đồng đi
thẳng `mgmt-assistant` (1 job) nên nhanh hơn ~1 lần khởi động CLI.

**Chi phí Hub thuần (perf (b), evotest, Runtime trả ngay, N=20):**

| Đường | E12 → job đầu p50 / p95 | E12 → `run.finished` p50 / p95 |
|---|---|---|
| Orchestrator (2 job) | 34 / 40 ms | 89 / 105 ms |
| fast (1 job) | 34 / 41 ms | 62 / 71 ms |

⇒ Hub không phải nút cổ chai (vài chục–trăm ms); thời gian nằm ở **số lần khởi động CLI** và model.

## 2. Làm

| # | Việc | Trạng thái |
|---|---|---|
| 1 | `fast-route.rules.ts`: tin không tag sẽ vào Orchestrator (`legacy` / Orchestrator "không khớp" ≠ `ask`) mà AU người gửi = **đúng 1 agent** ⇒ run `direct` agent đó (như `@agent`) — bỏ hẳn job Orchestrator | ✅ |
| 2 | `RunService.prepare` → `untaggedRoute` (run-plan.ts); `directOnSnapshot` vẫn kiểm lại AU trên ảnh của run; log `run-fast-route` | ✅ |
| 3 | Cờ `HUB_FAST_ROUTE` (mặc định `off` ⇒ test khoá giữ hành vi), `deploy/prod-sohoptac2/docker-compose.yml` bật `on` | ✅ |
| 4 | Tách `AppDeps` → `app.deps.ts`, `flowBusy`/`newRun` → `create-run.ts`, `emptyStream` → `run-view.ts` (file ≤ 400) | ✅ |
| 5 | Unit `fast-route.rules.test.ts` (10 ca: grant user/group/tenant, thiếu grant/entitlement, tenant khác, tắt, runtime, AU ≥ 2, Orchestrator, chính sách) | ✅ local |
| 6 | Int `tests/acceptance/chat-fast/fast-route.int.test.ts` — direct khi AU=1; thiếu grant / mất entitlement ⇒ không đi thẳng **và** Orchestrator delegate ⇒ `skipped not_allowed`; AU ≥ 2 ⇒ Orchestrator | ✅ evotest 4/4 (4,2 s) |
| 7 | Perf `tests/acceptance/chat-fast/dispatch.perf.int.test.ts` — fast p95 tổng ≤ 150 ms và < đường Orchestrator | ✅ evotest (fast p95 71 ms, < Orchestrator 105 ms) |

## 3. Kết quả (trước → sau, tin không tag, người dùng thấy 1 agent)

- Job CLI mỗi tin: **2 → 1**; token đầu sớm hơn đúng một job Orchestrator (dispatch + spawn + CLI start + quyết định ≈ **5–9 s**), tổng
  17–25 s → ước **≈ 10–15 s** (= 1 job như dock hợp đồng). Số thật trên sohoptac2 đo bằng câu SQL ở §5 sau khi deploy.
- Token: bỏ hẳn prompt Orchestrator mỗi tin (system prompt + JSON Schema quyết định + `<agents>` + `<history>` tới `history_n`×4000
  ký tự + `<message>`) — hàng nghìn token cache-write/lượt; agent nhận cùng prompt như trước (`history_n`, resume session).
- Bảo mật: không đổi. AU = `visibleAgents(accessInput(snapshot, who))` — cùng hàm của `canDelegate` (vòng Orchestrator) và
  `directOnSnapshot`; Orchestrator không bao giờ là đích; RLS/`withHubScope` của run `direct` y như `@agent`; không cache kết quả tool.

## 4. Quyết định trong lúc làm

- Chỉ luật tất định "AU = 1". Router từ khoá cần cấu hình mới (`runtime_options` là `strictObject` ở Studio) ⇒ để sau; "theo agent cũ
  của flow" không tất định (người dùng đổi chủ đề) ⇒ không làm.
- Flow đang chờ trả lời (`pending_ask`) giữ đường Orchestrator (`waiting_for`, xác nhận tool) như CR-054.
- Chính sách "không khớp" = `ask` giữ Orchestrator (phải hỏi lại khi không khớp).
- Không làm ở lát này (Runtime, rủi ro sandbox): giữ CLI ấm / dùng lại tiến trình (mỗi job một tiến trình + HOME/cwd/hook riêng là
  hàng rào cách ly — dùng chung tiến trình giữa job phá hàng rào này); spawn trước job host Python (env/cwd phụ thuộc job).
  Stream đã đầu-cuối (FGTS bật, pump 100 ms, nginx không đệm) ⇒ không sửa.

## 5. Còn lại

- Sau deploy: đo thật trên sohoptac2 (chỉ đọc), so `kind` `direct` vs `orchestrated`:
  ```sql
  select r.kind, j.payload->'agent'->>'role' as role, count(*),
    round(percentile_cont(.5) within group (order by extract(epoch from j.started_at - j.queued_at))::numeric, 2) as claim_p50_s,
    round(percentile_cont(.5) within group (order by extract(epoch from j.finished_at - j.started_at))::numeric, 2) as job_p50_s,
    round(percentile_cont(.5) within group (order by extract(epoch from r.finished_at - r.created_at))::numeric, 2) as run_p50_s
  from hub.runs r join hub.jobs j on j.run_id = r.id
  where r.created_at > now() - interval '7 days' and r.status = 'finished' group by 1, 2 order by 1, 2;
  ```
- Router từ khoá (cấu hình agent) cho tenant nhiều agent; Orchestrator rẻ hơn khi có API key (runtime `llm`, không khởi động CLI).
- e2e/test:all cuối đợt (Luật 0b).
