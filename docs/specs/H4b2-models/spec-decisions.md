---
spec: H4b2-models
part: phụ lục spec §9 (tách để spec ≤ 25 KB)
owner: backend-lead
---

# H4b-2 · Câu hỏi mới của backend-lead (PLAN 2026-10-13) — đầy đủ

Mỗi câu: bối cảnh từ code thật · mặc định đề xuất · phương án khác.

| # | Câu hỏi | Bằng chứng trong code | Mặc định đề xuất | Phương án khác |
|---|---|---|---|---|
| Q4 | AC-H04 / HUB-FR-31: "anthropic trả 429 ⇒ trả lời từ openai" (thử bước kế **giữa chừng**) | `runner.rules.ts buildJobPayload` chỉ dùng `steps[0]` (H1-R18); `job-agent-runner.ts` kiểm `blockedReason` của bước 0 rồi `ALL_PROVIDERS_EXHAUSTED`; Runtime gắn provider theo key cố định (`config.py DEV_ONLY_PROVIDERS`, `claude/provider.py KEY`); provider `api` chưa chạy (spec §1 "chờ H2d"); `providers.enabled` hiện **không** được dùng khi giao job | **Dự phòng lúc giao job** trong Hub (`pickStep`, plan §2.3): bỏ bước có provider tắt (vô điều kiện, spec §2 "chỉ tắt thì tự dự phòng bước kế") hoặc đang chặn (`cooldown` ⇒ trigger `quota`; `logged_out`/`error` ⇒ `error`) **khi `on` của bước đó chứa trigger**; còn lại như cũ. Payload job không đổi contract (`profile_steps` = 1 bước được chọn, `step_index 0`); `jobs.provider_key` + `run_steps.provider_key` ghi provider được chọn (trace). AC-H04 nguyên văn dời **H2d**; qc viết AC dự phòng lúc giao (dữ liệu: profile 2 bước `fake-cli` → `claude-sub`, `provider_state` ghi tay; kiểm `jobs.provider_key`, không cần Runtime chạy) | (b) Thử lại giữa chừng ở Hub: khi `job.failed` có reason ∈ `on` và chưa phát delta ⇒ enqueue job bước kế. Cần thêm Runtime phục vụ provider theo vendor (Python) ⇒ +2–3 task cao, đụng luồng run/NOTIFY |
| Q5 | Provider `subscription` tạo ở Studio với key Runtime không phục vụ | Runtime chỉ có `claude-sub`, `fake-cli`; job tới key lạ nằm `queued` tới hết hạn (lỗi hiện cho user, HUB-BR-04) | Cho tạo (HUB-FR-66). `state = null` ⇒ FE "Chưa có Worker kiểm"; Sheet ghi "key phải khớp provider đã cài ở Worker (runbook)" | Chặn tạo `subscription` ở Studio (chỉ seed) — trái HUB-FR-66 |
| Q6 | Lộ `secret_id`/`last_error` ở danh sách | Test khoá `tests/acceptance/H4a/role-read.int.test.ts` A17 cấm chuỗi `secret_id`, `last_error` trong `GET /providers` (H4a-R13) | List giữ R13 (`has_secret`). `GET /providers/:id` trả `secret {id,name}` + `state.last_error` (đã qua `redactKey`). AC-H4b2-01 kiểm qua chi tiết | Mở R13 ở list ⇒ qc phải sửa test khoá H4a |
| Q7 | "Kiểm tra key" với key đang gõ (chưa lưu) | Kho H4b-1 chỉ ghi qua `/secrets`; không đường nào khác nhận giá trị key | Chỉ kiểm key **đã lưu** (provider đã lưu, secret đã có) — FE: lưu rồi kiểm | Thêm `POST /providers/check-draft {vendor, base_url, value}` — thêm một đường nhận secret thô, phải kiểm log/redact riêng |
| Q8 | Đổi `key`/`kind`/`vendor` provider, `key` profile | `jobs.provider_key` FK theo key; `model_profiles.steps` jsonb tham chiếu key; seed upsert theo key; `cli_sessions` khoá theo key | Bất biến, chốt bằng GRANT cột (spec §4 #2–#3). Đổi = tạo mới, chuyển profile, tắt cũ | Cho đổi + cập nhật dây chuyền steps/jobs — rủi ro mất lịch sử |

Quan sát ngoài phạm vi (không sửa, ghi TECH-DEBT khi BUILD): `hub.room_post_agent_message` (0016) kiểm `agent_entitlements` **không** lọc `revoked_at` ⇒ run đã chạy trước khi thu hồi vẫn đăng được tin vào phòng — khớp "run đang chạy vẫn xong" (UI §9), run mới bị chặn ở kiểm quyền HUB-FR-77.

## Đối chiếu FE (chuyển từ spec §3)
C1 — list giữ R13 (Q6): `has_secret` + `slots_in_use`, `secret`/`last_error` ở chi tiết · C2 — mã `KEY_TAKEN` (sẵn có), `details.profiles: [{id, key}]` (profile không có tên) · C3 — hình dạng `ProviderCheckResult` ở trên · C4 — nhận, thêm `active_step` (FE nên dùng thay tự tính, cùng luật giao job) · C5–C7 — nhận path; drawer gộp grants vào GET ô.


## Index (chuyển từ spec §4)
| Truy vấn | Index |
|---|---|
| Profile dùng provider `k`: `steps @> jsonb_build_array(jsonb_build_object('provider_key', k))` | quét `model_profiles` (≤ 200 hàng) |
| Provider có lịch sử: `exists(select 1 from hub.jobs where provider_key = k)` | `jobs_provider_key_idx` |
| `slots_in_use`: `count(*) … where status='running' group by provider_key` | partial `jobs_heartbeat_running_idx` (`WHERE status='running'`) |
| Agent dùng profile: `agents where profile_id = p` | quét `agents` (≤ 200) |
| Ma trận: entitlement chưa thu hồi + `count(*) group by agent_id, tenant_id, subject_type` của `agent_grants` | PK `agent_entitlements` · `agent_grants_uq (agent_id, tenant_id, …)` |

## Trong lúc làm — FE T6 (Quyền agent)
- 2026-10-13: key riêng `access.empty`/`access.forbidden` (không dùng `state.*` chung với Models); thêm `access.matrix.corner`, `access.drawer.none`, `access.drawer.subject.*`. Nút "Chi tiết …" chỉ ở ô đã cấp; bộ lọc là `<select>` native theo key. Cấp/thu hồi thành công ⇒ invalidate ma trận + `me` (số grant lấy lại từ server).

## Trong lúc làm — FE T5b (Kiểm tra key + Runbook)
- 2026-10-13: UI chặn request check ở 15 s (server 10 s) ⇒ `check.timeout`; lỗi request khác 404/READONLY/NOT_CONFIGURED (mạng, 5xx) hiện trong hộp `role=alert` (`login.err.*`), không toast. "Chi tiết" = `HTTP {http_status}` + `message` + `{latency_ms} ms`, chỉ khi ok/error và có HTTP/message. `unsupported` ẩn [Kiểm tra lại]. Thêm key `models.check.{desc,runningSub,httpError,network,secretUnreadable,requested}`, `models.guide.{step3Hint,copyAria,copyFail,cmd2.*}`; lệnh hãng ở i18n. Runbook không có nút X (đã có [Đóng] ở footer). Đóng hộp bị chặn khi đang chạy (cả Esc).

## Trong lúc làm — BE B3 (API provider)
- 2026-10-13: path param không uuid ⇒ 400 qua `studio/studio-params.ts` (`parseUuidParam` + middleware `uuidParams` gắn `/providers/:id/*`) ⇒ `POST /providers/abc/check` cũng 400 trước khi B4 mount route (A08b). H4a `parseIdParam` (404) giữ nguyên.
- 2026-10-13: lỗi riêng qua `models/models.errors.ts` (`modelError`, mẫu `secrets.errors.ts`) — không sửa `lib/errors.ts`/`HubErrorCode`.
- 2026-10-13: thứ tự chặn PUT/PATCH/DELETE: 404 → `PROVIDER_READONLY` → `VERSION_CONFLICT` → (PUT) hình dạng theo `kind` DB → secret ref; DELETE tiếp `PROVIDER_IN_USE` → `PROVIDER_HAS_HISTORY` (23503 ⇒ cùng mã). POST: hình dạng kiểm **trước** transaction (400 không khoá config).
- 2026-10-13: audit `before/after` = 4 trường sửa được (`base_url, secret_id, max_concurrency, enabled`), cả `create` (key ở `entity_name`); `summary.fields` = trường đổi. PATCH enabled cùng giá trị ⇒ không đổi ⇒ 200, không bump/audit (như PUT không đổi).
- 2026-10-13: PUT kiểm secret ref mỗi lần `secret_id ≠ null` (kể cả không đổi) — FK RESTRICT nên chỉ lệch khi kind sai; đơn giản hơn so sánh.
- 2026-10-13: `env.dev` = `appEnv ∈ {development, test}`, vắng ⇒ không dev (fail-closed như `kh.mount`).
- 2026-10-13: `GET /providers/:id` `state.last_error` qua `redactKey(…, "")` rồi cắt 500 (Q6).

## Trong lúc làm — BE B4 (Kiểm tra key / Kiểm tra lại)
- 2026-10-13: mốc `t0` subscription = `now()` của DB (đọc dạng epoch ms trong transaction xoá mốc probe), so với `last_probe_at` do Runtime ghi bằng giờ DB ⇒ không lệch đồng hồ host/container. Hạn 10 s + `latency_ms` đo bằng đồng hồ đơn điệu của tiến trình; `checked_at` = `t0 + đã chờ`.
- 2026-10-13: vòng chờ = `sleep(500)` rồi đọc (xoá mốc commit trước lần `sleep` đầu); hết 10 s ⇒ `requested`, `latency_ms` = ms đã chờ.
- 2026-10-13: `NOT_CONFIGURED` chỉ ở nhánh api (khi `useSecret` báo `key_missing`, dùng lại `secretsNotConfigured()`); subscription không cần khoá Hub nên vẫn chạy. `secret_id` null ở hàng api (không thể theo hình dạng) ⇒ `secret_unreadable`.
- 2026-10-13: 2xx ⇒ huỷ thân không đọc; lỗi ⇒ đọc ≤ 64 KB (`readLimited`), đọc thân lỗi hỏng ⇒ thân rỗng (giữ `http_status`). Request `GET`, key chỉ ở header; `fetch` lỗi ⇒ `hitOfFetchError` (không log `e`).
- 2026-10-13: audit `check`: `after = {status, error_code, http_status}`, `summary = {kind}`, `hubConfigVersion null`, transaction riêng ngắn; `username` export từ `studio-write.ts` để dùng lại. Log `provider.check` (info) chỉ `{provider_key, status, error_code, http_status, latency_ms}`.
- 2026-10-13: `H4aDeps.log` mở rộng `Pick<Logger,"warn"|"info">`; reader secret riêng cho check (`new HubSecretReader`, cùng khoá), không dùng lại instance của K1.

## Trong lúc làm — BE B5 (API model profile)
- 2026-10-13: thứ tự chặn — POST: `KEY_TAKEN` → bước (`stepsProblem`); PUT: 404 → `VERSION_CONFLICT` → bước → giống hệt ⇒ 200 không bump/audit; DELETE: 404 → `VERSION_CONFLICT` → `PROFILE_IN_USE{agents}`. Bước trùng ⇒ `VALIDATION_ERROR` path `["steps", i]`.
- 2026-10-13: 23503 lúc DELETE (chốt cuối) ⇒ `PROFILE_IN_USE` **không** `details` (transaction đã hỏng, không đọc lại được agents); thực tế không xảy ra vì mọi ghi agent đều khoá `config_meta` trước.
- 2026-10-13: list `GET /model-profiles` dùng chung `profileItems` (`profiles.service.ts`) — bỏ `readModelProfiles` của `studio-read.repo.ts`. `now` của `active_step` = giờ tiến trình Hub (như giao job); `ProfilesService` nhận `now?` để test.
- 2026-10-13: steps lưu/trả/audit qua `normSteps` (thứ tự trường contract, jsonb đổi thứ tự khoá); "giống hệt" = so chuỗi JSON đã chuẩn hoá (đổi thứ tự `on` ⇒ khác). Audit `before/after = {steps}`, `summary = {steps: số bước}`.
- 2026-10-13: seed `upsertProviders`/`upsertProfiles` thêm `version = version + 1` trong nhánh `do update … where is distinct from` ⇒ lần đầu INSERT giữ default 1 (D20), chạy lại không đổi ⇒ giữ nguyên. PRODUCTION-NOTES "seed vs Studio" để B8 (theo tasks).

## Trong lúc làm — BE B7 (API Quyền agent)
- 2026-10-13: ghi PUT/DELETE gọi nguyên `AgentSettingsService.putEntitlement` (D2) ⇒ thứ tự chặn kế thừa: tenant vắng 404 → khoá config → agent ngoài catalog của T (kể cả Orchestrator riêng tenant khác) 400 `INVALID_REFERENCE{agent_id}` → `AGENT_IS_DEFAULT` (chỉ DELETE). `affected_grants` đếm ở transaction đọc riêng sau commit (plan §3.5).
- 2026-10-13: ma trận đếm **mọi** grant của cặp (kể cả grant mồ côi do group/user đã xoá) ⇒ `grant_count` = `affected_grants` = `count(*)` của `agent_grants`. Drawer cũng hiện grant mồ côi, tên subject vắng ⇒ dùng `subject_id` (khác `/agent-grants` bỏ mồ côi — Studio là bảng đối soát).
- 2026-10-13: `agents` ma trận = mọi agent (cả đang tắt) sắp `key`; `only_tenant_id` chỉ khi `is_orchestrator` và không có hàng `orchestrator_settings` chung; `cells` lọc theo agents × tenants đã trả (khi `truncated`). Tenant gồm cả `active = false`.
- 2026-10-13: `granted_by` của ô = null khi người cấp vắng ở `admin.users`; `granted_at` trả cả khi đã thu hồi (mốc cấp gần nhất), null khi chưa từng có hàng. Subject `user` tên = `display_name ?? username`; `group` = `name.vi`; `tenant` = `admin.tenants.name`.
- 2026-10-13: đọc `hub_config_version` qua `readHubVersion` (`studio-read.repo`) — không import repo chéo module `agent-settings`.

## Trong lúc làm — BE B6 (giao job theo `pickStep`)
- 2026-10-13: chọn bước tách hàm thuần `job/job-step.rules.ts` (`chooseJobStep`, `stepProviderKeys`) thay vì `job-payload.ts` (`job-agent-runner.ts` 388 dòng < 400). `ok` ⇒ trả profile chỉ còn bước đã chọn, `buildJobPayload` giữ nguyên (CR-054 `agent.model ?? step.model` sẵn có) ⇒ payload không đổi contract.
- 2026-10-13: `enabled` lấy từ ảnh cấu hình (`snapshot.providers`, cùng ảnh của run — HUB-BR-06); provider vắng khỏi ảnh ⇒ coi như tắt. `provider_state` đọc trực tiếp một câu `provider_key = ANY` (PK).
- 2026-10-13: thứ tự trong `run`: profile vắng ⇒ `INTERNAL_ERROR invalid_payload` (như cũ) → `pickStep` (`ok:false` ⇒ `ALL_PROVIDERS_EXHAUSTED` reason của pick) → dựng payload (null ⇒ `invalid_payload`). Khác cũ duy nhất: agent runtime ≠ `agentic-cli` **và** provider chặn ⇒ nay `ALL_PROVIDERS_EXHAUSTED` thay vì `INTERNAL_ERROR` (không có ca thực tế). `message` nội bộ = `no usable profile step: <reason>` (không ra client, P11).
- 2026-10-13: `job.fallback` mức `info`, trường `{run_id, skipped:[{index, why, provider_key}], to}`; agent có model riêng không bao giờ log (skipped luôn rỗng). `job-follow` (hết hạn `queued`) vẫn đọc state của provider đã chọn — không đổi.
- 2026-10-13 (review vòng 1 #2): `EntitlementsService.matrix` dùng 5 câu SQL (> 4 của spec §6) — ngoại lệ chấp nhận: cả 5 trong một transaction REPEATABLE READ read only, mỗi câu theo index/≤ 201 hàng; gộp `hub_config_version` vào câu tenants làm câu phức tạp hơn mà không giảm round-trip đáng kể.
- 2026-10-13 (review #6): Orchestrator riêng của ≥ 2 tenant chỉ trả tenant đầu (`only_tenant_id`, `order by tenant_id nulls first limit 1`) trong ma trận; chưa có ca thực tế (mỗi Orchestrator riêng một tenant). Đổi contract thành mảng ở mốc sau (TECH-DEBT #164).
- 2026-10-13 (review #8): bỏ qua, không đổi.
- 2026-10-13 (int sau Docker): `pollProbe` dừng khi quá 10 s theo đồng hồ **hoặc** đủ 20 vòng `sleep(500)` (10 s danh nghĩa) — plan §3.2 "sleep tiêm được (test không chờ thật)"; chỉ đồng hồ thì C12 chờ thật 10 s, vượt timeout client 10 s.
- 2026-10-13 (int sau Docker): log `provider.check` dùng trường `provider` thay `provider_key` (plan §3.2): logger Hub che mọi trường khớp `/key/` (`SENSITIVE_KEY`) ⇒ giá trị thành `[redacted]`, C14 đỏ. Giá trị là mã provider, không phải secret.
- 2026-10-13 (review #3): xoá profile gặp FK 23503 (agent mới gắn giữa chừng) ⇒ chạy trong savepoint, đọc lại `agentsUsing`; còn ⇒ `PROFILE_IN_USE{agents}`, rỗng ⇒ `VERSION_CONFLICT` (kèm bản hiện tại).
- 2026-10-13 (review vòng 2 #1): thêm `profiles.service.remove.test.ts` (tx giả, không DB) phủ nhánh savepoint 23503: còn agent ⇒ `PROFILE_IN_USE{agents}`, rỗng ⇒ `VERSION_CONFLICT{current, updated_at}`, lỗi khác ⇒ ném nguyên.
- 2026-10-13 (review vòng 2 #3): `readActiveEntitlements`/`readGrantCounts` nhận `limit` và chỉ đọc cặp thuộc `limit` agent × `limit` tenant đầu theo `key` (subquery, cùng tập ma trận hiển thị) ⇒ ≤ 200² hàng, kết quả hiển thị không đổi, không đổi contract; lọc server theo tham số vẫn ở TECH-DEBT #163.
- 2026-10-13 (review vòng 2 #2): ghi TECH-DEBT #166 về `base_url` provider (SSRF khi "Kiểm tra key").

## Tranh chấp test (backend-lead, int sau Docker 2026-10-13) — chờ qc
- **TC-1 · A08b (`providers.int`) + P08 (`profiles.int`)**: `noWrite(() => pa(x, m, p, {}), …)` gửi body `{}` cho cả `GET` ⇒ `fetch` của Bun ném `TypeError: fetch() request with GET/HEAD/OPTIONS method cannot have body` trước khi tới Hub (lỗi ở fixture, không phải hành vi server). Đề xuất: GET truyền `undefined` (`m === "GET" ? undefined : {}`). Server: `uuidParams("id")` mount cho `/providers/:id` và `/:id/*` (mọi method) ⇒ 400 `VALIDATION_ERROR`; các ca PUT/PATCH/DELETE/check phía sau chưa chạy được vì vòng lặp dừng ở GET.
- **TC-2 · E07 (`entitlements.int`)**: `DELETE AGT.orch × acme` kỳ vọng 409 `AGENT_IS_DEFAULT`, nhận 400 `INVALID_REFERENCE{agent_id}`. Fixture H3b cho acme Orchestrator riêng `orchAcme` ⇒ Orchestrator chung `AGT.orch` nằm ngoài catalog của acme (spec-decisions B7: thứ tự kế thừa `putEntitlement` — ngoài catalog 400 trước `AGENT_IS_DEFAULT`); và acme không có hàng `tenant_agent_defaults` ⇒ `blocksDisable` = false, không có agent nào là "mặc định". Đổi hành vi `putEntitlement` (CR-054, dùng chung) = đổi contract đã duyệt ⇒ không sửa. Đề xuất qc: trong ca, ghi `tenant_agent_defaults(acme, default_agent_id = AGT.hoadon)` rồi `DELETE hoadon × acme` ⇒ 409, xoá hàng ở `finally`.

**Phán quyết qc 2026-10-13:** TC-1 test sai, đã sửa (GET không body). TC-2 test sai dữ liệu, đã sửa theo đề xuất (mặc định acme = hoadon, DELETE hoadon × acme ⇒ 409); ý AC giữ nguyên, contract/code không đổi. 3 file xanh 25/25, 14/14, 11/11.

## Dọn Minor UAT H4b-2 (frontend-lead, 2026-10-13)
- Item list provider không có cờ `readonly` (chỉ ở detail) ⇒ ẩn Sửa/Xoá bằng `isReadonlyVendor(vendor)` (`dify`, khớp hub-api `isReadonlyProvider`), thay bằng chữ "Do hệ thống quản lý". Kiểm tra key vẫn hiện.
- Provider API chưa có state ⇒ "Chưa kiểm tra" (`status.noneApi`); subscription giữ "Chưa có Worker kiểm".
- `FieldFrame` (features/secrets) thêm prop tuỳ chọn `aside` để đặt link "Tạo secret" cùng hàng nhãn; không đổi hành vi nơi khác.
- Link "Hướng dẫn đăng nhập" ở Sheet sửa subscription: đóng Sheet rồi mở Runbook (`onGuide` qua ProvidersPanel → ProviderSheet → ProviderForm → ProviderFields); chỉ hiện ở chế độ sửa.
- Runbook: banner đỏ (`bg-danger-bg`) chứa badge mã trạng thái + câu "Hết phiên…"; SheetDescription chuyển sr-only để không lặp. Bước 3 nối thêm câu "Kết quả hiện như hộp "Kết quả kiểm tra"".
- Ma trận Quyền agent: nhãn nhìn thấy "Agent"/"Tenant" (aria-hidden), giữ `aria-label` "Lọc theo agent/tenant" cho tên truy cập (e2e khoá).
- e2e `h4b2` 34/34 xanh, không có Tranh chấp test.
