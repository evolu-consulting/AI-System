---
id: hub-agent-handoff
lát: hub-agent-handoff
cr: CR-114
làn: đầy đủ phần RLS bảng `hub.artifacts` + MCP theo tenant; còn lại nhanh
migration: 0084 (hub, `when` 1802600000000)
phụ thuộc:
---
## Plan (ngắn)
Giảm token khi agent chuyển việc cho nhau (Orchestrator ⇄ agent, bước sau đọc kết quả bước trước) bằng **tham chiếu tới
artifact** thay vì dán nguyên văn.
1. Bảng `hub.artifacts` (0084): khoá = sha256 nội dung (lộ 8 ký tự đầu `art:xxxxxxxx`, giữ khoá đủ bên trong), `kind`
   text|json, `body`, `size_bytes`, `tokens` ước tính, `summary` 1–2 dòng, `run_id`/`step_id` tạo ra, `expires_at` (TTL,
   mặc định 30 ngày; ghi lại cùng nội dung ⇒ dedup theo (tenant, key), gia hạn TTL). RLS như bảng hub khác (`system` hoặc
   `user` đúng `app.tenant_id`). Vector `emb real[]` + `emb_model` (cùng cách lưu của gói knowledge, không DB vector mới).
2. Luật thuần `artifacts/artifact.rules.ts`: `artifactKey`, `shortKey`, `estimateTokens`, `shouldInline` (< 300 token ⇒
   dán thẳng rẻ hơn), `shouldEmbed` (≥ 500 token), `handoffEnvelope` `{g,in,sum,c,o,b}`, `sliceRange`.
3. MCP `artifact-get(key, range?)` + `artifact-search(query, k?)` trên `/mcp` cho mọi token job (không cho token chat chỉ
   đọc). Đọc trong `withHubScope(user tenant của job)` ⇒ RLS chặn khác tenant; khoá 8 ký tự giải theo tiền tố trong tenant.
4. `artifact-search`: có `Embedder` (cùng `openAiEmbedder` của knowledge, bật khi có key) và artifact đã nhúng ⇒ tích vô
   hướng; không ⇒ FTS `simple` trên `body`. Artifact nhỏ không nhúng.
5. Nén lịch sử `artifacts/history.rules.ts`: hội thoại dài hơn N lượt ⇒ lượt cũ → 1 mục tóm tắt + khoá artifact, N lượt cuối
   giữ nguyên.
6. Orchestrator: `LoopIo.handoff?` (vắng = như cũ). Có ⇒ kết quả agent dài vào `<steps>` dạng `{ref, sum}`, delegate gửi
   kèm phong bì `{g,in,sum,c,o,b}`, lịch sử cho agent được nén.
7. Đo trên kịch bản cố định (LLM giả, đếm token prompt dựng ra) trước/sau + fixture dữ kiện bắt buộc.

## Làm
- `packages/db/migrations-hub/0084_hub_artifacts.sql` + journal.
- `apps/hub-api/src/modules/artifacts/` (rules, history.rules, repo, service, mcp provider, tests).
- `modules/mcp/mcp.service.ts` (dep `artifacts?`), `app.mcp.ts` nối; `orchestrator.loop.ts` (`LoopIo.handoff?`),
  `orchestrator.service.ts` nối kho artifact.

## Không làm / Chạm
Không đụng prompt caching của `lib/ai-client` và logger (lát khác). Không thêm DB vector. Không sửa contract `@ai/contracts`.

## Test tối thiểu
- int (viết TRƯỚC code): `artifacts-rls.int.test.ts` (đọc/ghi chéo tenant), `artifact.mcp.int.test.ts` (job tenant A không
  đọc artifact B qua `artifact-get`/`artifact-search`).
- unit: `artifact.rules.test.ts`, `history.rules.test.ts`, `handoff.scenario.test.ts`, `orchestrator.handoff.test.ts`.

## Quyết định trong lúc làm
- Bật bằng `HUB_ARTIFACT_HANDOFF=1` (driver Orchestrator + tool MCP); tắt (mặc định) = hành vi cũ nguyên vẹn ⇒ không đổi
  fixture tools/list, prompt delegate của bộ H1/H2a hiện có. Bật trên prod sau khi chạy e2e đợt.
- Orchestrator không có MCP (runner: không tool) ⇒ `<steps>` giữ NGUYÊN VĂN bước mới nhất, bước cũ còn trích 400 ký tự +
  `art:…` (chúng đã được chuyển cho agent sau bằng tham chiếu). Agent chỉ nhận `ref` khi job có MCP (`agentic-cli` có
  vòng 2: mọi `agentic-cli` khi Hub có URL `/mcp`); không thì phong bì mang nguyên văn ⇒ không mất dữ kiện.
- Tool artifact chỉ hiện/gọi được khi có trong `payload.mcp.tools` của job (vòng 2); token chat chỉ đọc không có.
- Khoá 8 ký tự giải theo tiền tố TRONG tenant (RLS + `tenant_id =` tường minh); tiền tố mơ hồ ⇒ "không tìm thấy";
  không phân biệt "không có" với "của tenant khác". Tiền tố < 8 hex bị từ chối (không dò).
- Ước lượng token = byte UTF-8 / 4 (không tokenizer) — cùng thước cho trước/sau.
- Embedding: dùng `openAiEmbedder` của gói knowledge, chỉ khi `KNOWLEDGE_STRATEGY=embedding*` + key; lưu `real[]` trên
  chính hàng artifact (như `knowledge.chunk_embeddings`), artifact < 500 token không nhúng; lỗi nhúng ⇒ search rơi về FTS.
- Dedup: `ON CONFLICT (tenant_id, key)` chỉ gia hạn `expires_at` (giữ tóm tắt đầu tiên). Dọn hết hạn: index `expires_at`
  (job dọn chưa làm — Việc còn lại); đọc/tìm đã lọc `expires_at > now()`.
- int MCP test gọi nhà cung cấp tool với `McpContext` (tenant/user mà `authenticate` dựng từ token job) trên DB thật;
  đường token → ctx là mã có sẵn (H2a).
- Số đo (`handoff.scenario.test.ts`, lịch sử 24 lượt, researcher(partial) → analyst → writer → answer, LLM giả, tổng token
  prompt + system + history mọi job): **trước 30174 → sau 14844 (−50,8 %)**; writer vẫn tới được đủ 7/7 dữ kiện fixture
  (trong prompt hoặc qua `artifact-get` của khoá có trong prompt); Orchestrator cuối thấy nguyên văn bước mới nhất.

- Vòng 2 (điều phối 2026-11-03): (1) `artifact.sweeper.ts`: một tx `system` + `pg_try_advisory_xact_lock(hashtext('hub.artifacts.sweep'))`
  (Hub khác đang dọn ⇒ skipped), ≤ 10 câu DELETE × 1000 hàng `FOR UPDATE SKIP LOCKED` theo index `expires_at`; chạy mỗi
  10 phút từ `mountMcp` khi bật cờ. (2) `job-agent-runner #mcp` thêm `artifact-get`/`artifact-search` vào `payload.mcp.tools`
  của MỌI job `agentic-cli` khi bật cờ (không sửa `routing-runner.ts`/`app.runner.ts` — commit 1 đã chạm `app.runner.ts`, nay
  trả về nguyên bản; driver Orchestrator tự lấy kho artifact theo cờ trong `orchestratorDriver`). Tên tool dùng `-` vì khoá
  `payload.mcp.tools` theo `CATALOG_KEY_RE` (không có dấu chấm). Token job chỉ đọc artifact của tenant (RLS) + `run_id` của
  job. `canFetch` = `agentic-cli` ∧ `HUB_PUBLIC_INTERNAL_URL` có.
  (3) int đường thật token job → POST `/mcp` (`artifact.mcp-route.int.test.ts`).
- Vòng 3: dedup KHÔNG chuyển artifact giữa run — bảng nối `hub.artifact_runs (tenant_id, run_id, key)` (0084, RLS như
  `artifacts`, FK `(tenant_id, key)` ON DELETE CASCADE ⇒ dọn artifact xoá link). `put` có `runId` ⇒ thêm link (câu thứ 2,
  `on conflict do nothing`); token job đọc/tìm được artifact khi có link với run của job. `artifacts.run_id` = run tạo đầu.

- Rebase lên platform/gd0 (fast-sdk + otel): 3 commit gộp thành 1. Khi có `handoff`, lịch sử delegate đã nén nên KHÔNG gửi `historyTotal` (cửa sổ cache theo khối của fast-sdk chỉ áp khi lịch sử chưa nén); tắt cờ ⇒ y như fast-sdk.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED engine/agent-handoff.md
#### Yêu cầu: Kho artifact theo nội dung
Kết quả một bước (text/JSON) lưu một lần trong `hub.artifacts` của tenant, khoá sha256 nội dung, có TTL; cùng nội dung ghi lại không tạo bản mới.
- Kịch bản: khi tenant B đọc artifact của tenant A thì không thấy hàng nào [test: apps/hub-api/src/modules/artifacts/artifacts-rls.int.test.ts » chặn đọc chéo tenant bảng artifacts]
- Kịch bản: khi artifact hết hạn thì vòng dọn xoá theo lô, hai Hub dọn cùng lúc không xoá trùng [test: apps/hub-api/src/modules/artifacts/artifact.sweeper.int.test.ts » theo lô, an toàn khi hai Hub dọn cùng lúc]
- Kịch bản: khi ghi cùng nội dung hai lần thì chỉ có một artifact, khoá ngắn 8 ký tự [test: apps/hub-api/src/modules/artifacts/artifact.mcp.int.test.ts » ghi trùng nội dung dedup một hàng]
#### Yêu cầu: Bàn giao bằng tham chiếu
Orchestrator/bước sau nhận `{g,in:[art:…],sum,c,o,b}` thay vì nguyên văn; nội dung < 300 token vẫn dán thẳng; agent lấy phần cần bằng MCP `artifact-get(key, range)` / `artifact-search(query)`.
- Kịch bản: khi nội dung dưới 300 token thì dán thẳng, từ 300 token thì thành tham chiếu [test: apps/hub-api/src/modules/artifacts/artifact.rules.test.ts » dưới 300 token thì inline]
- Kịch bản: khi kết quả agent dài thì delegate sau (job có `artifact-get`) nhận tham chiếu; Orchestrator vẫn thấy `<steps>` nguyên văn (sửa ở lát fix114-handoff) [test: apps/hub-api/src/modules/orchestrator/orchestrator.handoff.test.ts » delegate: không bước trước giữ task]
- Kịch bản: khi job của tenant A gọi `artifact-get` khoá của tenant B thì nhận "không tìm thấy" [test: apps/hub-api/src/modules/artifacts/artifact.mcp.int.test.ts » job tenant A không đọc được artifact tenant B]
- Kịch bản: khi hai run ghi cùng nội dung thì cả hai đọc được, run thứ ba cùng tenant không link thì không [test: apps/hub-api/src/modules/artifacts/artifact.mcp.int.test.ts » hai run cùng nội dung đều đọc được, run thứ ba không link thì không; apps/hub-api/src/modules/artifacts/artifacts-rls.int.test.ts » chặn đọc/ghi chéo tenant bảng artifact_runs]
- Kịch bản: khi token job gọi POST /mcp thì chỉ đọc được artifact cùng tenant và cùng run, và chỉ khi `payload.mcp.tools` có tool artifact [test: apps/hub-api/src/modules/artifacts/artifact.mcp-route.int.test.ts » phạm vi token: tenant + run + payload.mcp.tools]
#### Yêu cầu: Nén lịch sử hội thoại dài
Quá N lượt: lượt cũ thành một mục tóm tắt kèm khoá artifact, N lượt cuối giữ nguyên văn.
- Kịch bản: khi lịch sử dài hơn N lượt thì giữ N lượt cuối nguyên văn và một mục tóm tắt [test: apps/hub-api/src/modules/artifacts/history.rules.test.ts » giữ N lượt cuối nguyên văn]
- Kịch bản: khi chạy kịch bản đa agent cố định thì token prompt giảm mà bên nhận vẫn đủ mọi dữ kiện [test: apps/hub-api/src/modules/artifacts/handoff.scenario.test.ts » kịch bản đa agent: giảm token và đủ dữ kiện]

## Việc còn lại
- Bước quy trình (process stage) tiêu thụ output bước trước qua phong bì: chưa nối (engine quy trình đóng băng).
