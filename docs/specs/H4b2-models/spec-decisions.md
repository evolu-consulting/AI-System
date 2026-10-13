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

