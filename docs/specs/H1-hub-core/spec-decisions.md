# H1-hub-core · Quyết định (chuyển từ spec §9, readiness lần 1)

### Trước Gate (đã chốt với người dùng)
- Hub TS + Agent Runtime Python (CR-028/ADR-0007), WSL2 (CR-029), subscription chỉ dev/test và profile 1 bước được phép (CR-019), mọi tin qua Orchestrator (CR-025), Orchestrator là một agent (CR-020).
- **Q1 (người dùng 2026-10-04):** chưa có API key → Orchestrator và agent đều chạy `agentic-cli` qua `claude-sub` (CLI).
- Phiên Hub không sửa Chat/Admin/test khoá C1. Cần dùng chung `access.rules.ts`, `jwt.ts`… của Admin → đề xuất chuyển sang `packages/*` (ghi TECH-DEBT), không sửa file Admin.
- **Readiness lần 1 (2026-10-04, [readiness.md](readiness.md)):** người dùng **chấp nhận toàn bộ mặc định #1–#33**. Câu 1 ("chuẩn bị WSL2 + đăng nhập `claude`, cho spike dùng quota thật?") = **"chưa"** ⇒ task W0 (người dùng chuẩn bị) chưa xong: spike PY-02 và smoke CLI thật `blocked`; PY-08 dùng SDK giả; AC-02 dời **I2** (cuối H1). Câu 2 (ADR-0008/0009 Proposed) trình ở Gate.

### Câu hỏi mở (mặc định đã dùng)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | Orchestrator chạy bằng gì khi dev chưa có API key? | `agentic-cli` qua `claude-sub` (H1-R17), chấp nhận chậm; test/CI dùng profile `fake-cli`. Profile API thêm ở H2. **Người dùng xác nhận** |
| Q2 | Test contract gọi `/auth/*` tại `AUTH_URL`; Hub thật không phát JWT | Chạy với `AUTH_URL`=admin-api thật (cùng khoá JWT). Nếu `/auth/*` lệch contract chat → "Tranh chấp test", việc của phiên Chat khi combine; Hub không sửa test khoá. User fixture (`lan, hoa, an, khoa`) tạo bằng script trong `tools/` gọi admin-api bằng `platform_admin` |
| Q3 | Cổng dev | hub-api `4000` (`HUB_PORT`); agent-runtime không mở cổng |
| Q4 | Vị trí contract | Chat: `@ai/contracts/chat` (chỉ import). Hub↔Runtime: `@ai/contracts/hub` (mới) |
| Q5 | Runtime (WSL2) gọi Postgres/Redis Docker trên Windows | `networkingMode=mirrored`, `localhost`. Dự phòng: host IP trong env |
| Q6 | Id SSE so với id Redis Stream | **Đã giải** (CR-030 sửa HUB-FR-42, ADR-0007 #5); TTL `sse:` = `RUN_EVENTS_RETENTION_S` (600 s) sau khi run kết thúc |
| Q7 | Cách ly tenant ở DB | **Chốt** (`plan.md` §3.4): lọc ở repo + RLS 5 bảng hội thoại (`hub_rw`); bảng Runtime không RLS, câu Hub lọc `tenant_id`; `usage_logs` không RLS |
| Q8 | Seed: user nào được grant, môi trường nào | Grant theo `tenant_key + username` trong yaml (thiếu user → bỏ qua + cảnh báo); seed chạy mọi môi trường, `fake-cli` chỉ nạp khi `APP_ENV` ∈ development/test |
| Q9 | Thư viện mới | ADR-0008 (Python), ADR-0009 (TS + codegen), Proposed — trình ở Gate |
| Q10 | `max_wait_s` khi hết slot · sandbox | 30 s, test đặt qua env · H1 chỉ hook WRK-BR-07 + `allowed_tools` (không Bash); sandbox gốc Claude Code là tuỳ chọn (CR-031) |

### Câu treo của plan / plan-runtime / test-plan — đã chấp nhận mặc định (readiness #33)
| # | Nội dung | Mặc định |
|---|---|---|
| plan Q-a | Cách phát `delta` | Hub đệm kết quả agent rồi cắt `delta` (P6); Runtime stream trực tiếp ở H2 (WRK-FR-03, CR-031) |
| plan Q-b | Số URL DB | Một URL DB mỗi role (`HUB_DATABASE_URL`, …) |
| RQ1 | Log stdout CLI vs "không log nội dung" | stderr đầy đủ; stdout chỉ khung message (loại, tên tool, token, lỗi), không nội dung (WRK-NFR-04, CR-031) |
| RQ2 | `APP_ENV` cho `fake-cli` | `development`, `test` |
| RQ3 | Mỗi job một process Python con | Chấp nhận (BR-02 + process group); xem lại nếu spike đo > 1,5 s |
| RQ4 | Tên unit systemd | `ai-worker.service` |
| RQ5 | `bun run test` trên Windows chạy Python | script gọi `wsl.exe … uv run …` khi win32; Linux gọi `uv` thẳng |
| RQ6, RQ7 | `input_tokens` gồm cache; `max_turns` | Đã chốt: có (+2 cột cache); Hub điền 30 / Orchestrator 3 |
| Q-T1…Q-T9 | Test Python khoá ở `apps/agent-runtime/tests/acceptance/`; stub chữ ký §6.4; `#fake:tool`; HOME tạm; biên 600 s; không test HUB-FR-31 ở H1; `HUB_CONFIG_POLL_S`/`AGENT_RT_CLEANUP_S`; echo chỉ `<message>`; AC-W06 → HUB-H1-AC-04 | Theo test-plan (bảng Q-T) |
| Readiness #1–#33 | Toàn bộ lỗ hổng | Chấp nhận mặc định đề xuất (xem [readiness.md](readiness.md)); #8 ⇒ W0/PY-02/AC-02 `blocked`, I2; #2 theo mock C1: hết hạn khi `now − finishedAt > retention` (thay Q-T5 "≥") |

### Lệch BA đã ghi CR (CR-031, sửa chữ)
Khoá claim toàn cục (không "theo provider") · HUB-FR-62 mặc định `llm` ↔ H1 `agentic-cli` · WRK-NFR-06 sandbox tuỳ chọn · WRK-FR-03 `delta` do Hub cắt ở H1 · WRK-NFR-04 log stdout chỉ khung · heartbeat 10 s · TTL `run:` 24 giờ, `sse:` 24 giờ khi chạy / 600 s sau khi kết thúc.

### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-04 · docs-architect · H1-R09, R10, R12, R13 và `fake-cli` thuộc agent-runtime: BA không nói; contract chat đòi id 1..n, nhiều instance cần chủ run, test cần CLI tất định.
- 2026-10-04 · backend-lead · `plan.md` §1: P1 migration Hub tách thư mục (test khoá Admin assert `{main: 9, dev: 3}`) · P4 JWT chép verify + test vector · P5 claim một advisory lock toàn cục (thay "theo provider" ở H1-R19: slot tenant đếm chung mọi provider) · P6 kết quả agent đệm rồi cắt `delta` · P7/P8 Hub cũng quét orphan và hết hạn `queued` quá `max_wait_s`.
- 2026-10-04 · backend-lead · `orphaned` = `failed` + `error_reason=orphaned`; thứ tự khoá `flows → runs → run_steps → messages → jobs` (`plan.md` §3.5); một URL DB/role (`HUB_DATABASE_URL`). (đã thay bởi plan §3.5, readiness #1)
- 2026-10-04 · điều phối · Gate H1 duyệt. Máy dev chưa có WSL2 Ubuntu (chỉ `docker-desktop`) ⇒ test Python của `apps/agent-runtime` chạy trong **container Linux** (`python:3.12-slim` + `uv`, mount repo, cùng mạng compose với Postgres/Redis), gọi qua script `bun run` — code vẫn chỉ nhắm Linux (CONVENTIONS §9). Chạy thật dài hạn vẫn là WSL2 (W0). Đơn giản, dễ đổi (Luật 2).
