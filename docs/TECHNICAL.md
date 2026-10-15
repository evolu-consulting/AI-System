# TECHNICAL — Tổng quan kỹ thuật toàn hệ thống

Bức tranh "cái gì · vì sao · nối với nhau thế nào". Chi tiết nằm ở tài liệu được link; **code thắng** khi lệch (các chỗ lệch đã biết: cuối file). Không thay CODEMAP/ADR.

**Mục lục:** 1 Hệ thống là gì · 2 Thành phần & topology · 3 Stack · 4 Xác thực & phân quyền · 5 Cách ly tenant · 6 Dữ liệu · 7 Thực thi agent · 8 Tích hợp ngoài · 9 Secret & mã hoá · 10 Vận hành · 11 Con trỏ tài liệu · 12 Lệch đã biết

## 1. Hệ thống là gì

Nền tảng AI **multi-tenant**: tenant = công ty/khách hàng; công ty vận hành là tenant `platform`. Dữ liệu cách ly theo `tenant_id` (+ `user_id`); truy cập sai tenant trả 404.

| Khối | Làm gì | Mã |
|---|---|---|
| **Admin** | Tenant, user/đăng nhập (phát JWT), group, feature + quyền, command, catalog workflow dùng chung, secret của workflow, quota, audit | `apps/admin-api`, `apps/admin-web` |
| **Agent Hub** | Cấu hình agent, Orchestrator, routing `/lệnh` · `@agent` · `!quy trình`, hội thoại/phòng, SSE, MCP, process engine, Studio | `apps/hub-api`, `apps/studio-web` |
| **Worker / Agent Runtime** | Chạy agent CLI (Claude), job Dify async, sandbox tự-sửa mã | `apps/agent-runtime` (Python) |
| **Chat App / Extension** | Client người dùng cuối; không giữ key, không gọi Dify/model trực tiếp | `apps/chat-web` |

Vai trò: `platform_admin` · `tenant_admin` · `member`. Thiết kế gốc: [design/architecture.md](design/architecture.md) §1, §3.

## 2. Thành phần & topology

| Tiến trình | Chạy bằng | Cổng/entry |
|---|---|---|
| admin-api | Bun | `:3001` · `apps/admin-api/src/server.ts` (`/auth`, `/admin`) |
| hub-api | Bun | `:4000` (`HUB_PORT`) · `apps/hub-api/src/server.ts`; phục vụ Studio ở `/studio` |
| agent-runtime | Python, systemd (Linux/WSL2) | không cổng · `python -m agent_runtime` · `apps/agent-runtime/deploy/ai-worker.service` |
| admin-web / chat-web / studio-web | build tĩnh `dist/` | reverse proxy phục vụ; studio-web do Hub mount (`HUB_STUDIO_DIST`) |
| Postgres 16, Redis 7 | docker/managed | `:5432`, `:6379` |

```
 admin-web ─/auth,/admin─▶ admin-api ──────────────┐ ghi schema admin
 chat-web ──/auth────────▶ admin-api               ▼
 chat-web ──REST+SSE────▶ hub-api ◀──/internal/test-run (Bearer HUB_INTERNAL_TOKEN)── admin-api
 studio-web (/studio/api) ┘   │  ▲ đọc admin.* (chỉ đọc) ; ghi schema hub
                              │  └───────────── Postgres 16 ◀── agent-runtime (SQL thuần, role agent_runtime)
        hub.jobs + NOTIFY ────┼─────────────────────────────────▶ agent-runtime ── claude CLI (cục bộ)
        Redis Streams (sự kiện run, SSE) ◀──────────────────────── agent-runtime ── Dify (workflow.async)
        hub-api ◀── /mcp, /internal/jobs/:id/* (Bearer token job) ── agent-runtime
        hub-api ──▶ Dify (command sync) · KnowledgeHub · GitHub API · FileBox
```

Điểm cốt lõi: **Hub ↔ Runtime không gọi trực tiếp lệnh** — Hub tạo `hub.jobs` (Postgres, `SKIP LOCKED`, `NOTIFY job_enqueued`), Runtime phát sự kiện qua Redis Streams; chiều ngược lại Runtime gọi Hub qua `/mcp` và `/internal/*` bằng **token job** (ADR-0007). Admin báo Hub đổi cấu hình bằng `NOTIFY config_changed` + poll `config_version` dự phòng.

## 3. Stack công nghệ

TypeScript strict · Bun + Turborepo · Rsbuild + React + Tailwind + shadcn/ui (TanStack Router/Query, react-hook-form + zod) · Hono · Postgres 16 + Drizzle (RLS) · zod · Redis 7 · Biome · `bun test` + Playwright · Docker Compose. Chi tiết: [adr/0001-stack.md](adr/0001-stack.md).

**Vì sao Agent Runtime là Python** ([ADR-0007](adr/0007-hub-ts-agent-runtime-python.md)): agent/CLI mới (Claude Agent SDK, Codex, Gemini) thêm bằng class Python mà không đụng Hub; Hub giữ TS để dùng lại luật quyền, giải mã secret, JWT, contract zod. Contract Hub↔Runtime: zod → JSON Schema → pydantic, CI kiểm khớp (xem [ADR-0009](adr/0009-hub-redis-client-contract-codegen.md)). Thư viện Python: [ADR-0008](adr/0008-agent-runtime-python-libs.md) (asyncpg, redis-py, claude-agent-sdk, structlog…), HTTP/SSE client `httpx2`: [ADR-0010](adr/0010-agent-runtime-httpx2.md). Runtime dùng `uv`, ruff, pyright, pytest.

## 4. Xác thực & phân quyền

- Đăng nhập: mã công ty + username + password (argon2id) tại admin-api `/auth`. Access token TTL 900 s, refresh xoay vòng; 2FA TOTP tuỳ chọn.
- **JWT ký bằng khoá bất đối xứng:** admin-api ký (cần `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY`), hub-api **chỉ verify bằng `JWT_PUBLIC_KEY`**. Claims: `sub`, `tid`, `role`, `sid`; không chứa danh sách quyền — Hub tự tính quyền từ schema `admin` (`apps/*/src/lib/jwt.ts`). Thuật toán thực tế trong code là **EdDSA (Ed25519)** — xem §12.
- Quyền 2 tầng: **entitlement** (`platform_admin` cấp feature/agent cho tenant) + **access/grant** (`tenant_admin` cấp cho group/user). Agent grant do Hub sở hữu (`/agent-grants`), UI nằm ở Admin.
- `/studio/api` chỉ `platform_admin`. `/internal/test-run` dùng **`HUB_INTERNAL_TOKEN`** (≥ 32 ký tự, chung admin-api + hub-api, chỉ server-side). `/mcp` và `/internal/jobs/:id/*` dùng **token job** (Runtime sinh lúc claim, Hub chỉ lưu băm sha256).

## 5. Cách ly tenant (bảo mật cốt lõi)

- **RLS Postgres** trên bảng có `tenant_id`; policy đọc biến phiên `app.scope` (`platform`/`tenant`/`user`/`system`), `app.tenant_id` (Hub thêm `app.user_id`), đặt bằng `set_config(..., true)` **transaction-local** (`packages/db/src/scope.ts`, `hub-scope.ts`) nên không rò sang request khác trong pool.
- **Role ứng dụng `NOBYPASSRLS`:** `admin_api`, `hub_api`, `agent_runtime` (cùng nhóm quyền `admin_rw`, `hub_ro`, `hub_rw`). Service **không bao giờ chạy bằng role owner**: owner (superuser/owner bảng) bỏ qua RLS, chỉ dùng cho migrate/seed. Production phải đặt mật khẩu 3 role sau migrate.
- Hub đọc `admin.*` qua grant `hub_ro` (chỉ đọc); secret Dify chỉ qua hàm `SECURITY DEFINER` (`hub.workflow_secret`).
- `audit_log` (admin và hub) **append-only** — role ứng dụng không UPDATE/DELETE.
- Ngoại lệ đã chấp nhận: KnowledgeHub dùng chung, không cách ly theo tenant (CR-073, [PRODUCTION-NOTES](PRODUCTION-NOTES.md)).

## 6. Mô hình dữ liệu mức cao

Một Postgres, hai schema; migration Drizzle: `packages/db/migrations/` (admin, `0000`–`0010`) và `packages/db/migrations-hub/` (`0000`–`0033`; thêm `migrations-hub-dev/` chỉ dev). Schema TS: `packages/db/src/schema/`. Hub ghi `hub.*`, đọc `admin.*`; Admin đọc `hub.*` chọn lọc (vd `usage_logs`, `agent_grants`).

| Schema | Bảng trụ (không đầy đủ) |
|---|---|
| `admin.*` | `tenants`, `users` (+ TOTP), `groups`/thành viên, `features` + entitlement + grant, `commands`, `workflows` (catalog dùng chung), `secrets`, `tenant_quotas`, `config_meta` (`config_version`), `audit_log` |
| `hub.*` — hội thoại | `conversations`, `flows`, `messages`, `rooms`/`room_messages`, `attachments`, `runs`, `run_steps`, `tool_confirmations` |
| `hub.*` — cấu hình agent | `agents`, `agent_types`, `agent_workflows`, `agent_grants`, `agent_teams`, `providers`, `model_profiles`, `orchestrator_settings`, `tenant_agent_defaults`, `secrets` (khoá `HUB_SECRETS_KEY`) |
| `hub.*` — thực thi | `jobs` (hàng đợi), `cli_sessions`, `provider_state` (probe), `usage_logs`, `config_meta`, `audit_log` |
| `hub.*` — process/nguồn/tự-sửa | `process_defs`, `process_runs`, `stage_runs`, `review_tasks`, `sources`, `autofix_results`, `autofix_applies`, `kh_connections`, `kh_jobs`, `kh_writes` |

Điểm vào chi tiết: [CODEMAP.md](CODEMAP.md), `packages/db/README.md`.

## 7. Mô hình thực thi agent

Hub quyết định **ai chạy gì** (Router → command / Orchestrator / `@agent` / quy trình), rồi tuỳ loại:

| Loại | Chạy ở | Cơ chế |
|---|---|---|
| Command `/lệnh` sync | Hub | Hub → Dify streaming → `delta` SSE |
| Workflow async (`workflow.async`) | Runtime (`runtimes/dify`) | Job → Runtime gọi Dify SSE, retry; app-key lấy qua `/internal/jobs/:id/dify-credential` |
| Agent `agentic-cli` (provider `claude-sub`) | Runtime (`providers/claude`, `runtimes/cli`) | Claude Agent SDK Python **spawn `claude` CLI cục bộ** |
| `fake-cli` | Runtime | chỉ dev/test, gọi `/mcp` thật |

Vòng đời job: Hub INSERT `hub.jobs` + NOTIFY → Runtime claim (`SKIP LOCKED`, lease/heartbeat, sweeper orphan) → job host con chạy provider → sự kiện (`delta`, `step`, `usage`, `final`) qua Redis Streams → Hub chuyển thành SSE cho client (`Last-Event-ID`).

**Vì sao `claude` phải chạy CỤC BỘ trên máy Worker:** CLI dùng thư mục **workspace trên chính filesystem** (`AGENT_RT_WORK_DIR/<job_id>/`: snapshot nguồn chỉ-đọc, `out/`, file đính kèm), tool Read/Grep/Bash thao tác trực tiếp lên đó, và dùng **đăng nhập subscription (`~/.claude`) của user `worker`** trên máy đó. Không có chế độ "trỏ CLI từ xa" — muốn thêm sức chạy thì thêm máy Worker. Probe định kỳ ghi `hub.provider_state` (đăng nhập/quota); hết quota ⇒ không claim tới giờ reset. Hook `PreToolUse` giới hạn đường dẫn (WRK-BR-07); process con không cầm secret (WRK-BR-02). Chi tiết: [providers/claude/README](../apps/agent-runtime/src/agent_runtime/providers/claude/README.md).

**Sandbox tự-sửa (P-c)** ([ADR-0011](adr/0011-write-exec-sandbox.md)): agent cần ghi file + chạy lệnh nên chạy trong **container mỗi job** — production Podman rootless trong WSL2, dev Docker CLI; `RUNTIME_SANDBOX=podman|docker|fake|off` (mặc định `off`). Mã: `agent_runtime/autofix`, `apply`, `sandbox-image/`. Kết quả = diff/log + (stage "Áp") nhánh/PR.

## 8. Tích hợp ngoài

| Dịch vụ | Cơ chế | Chi tiết |
|---|---|---|
| Claude CLI subscription | Runtime spawn cục bộ, tài khoản riêng, `AGENT_RT_CLI_PATH`/`CLAUDE_CONFIG_DIR` | §7, deploy §9 |
| Dify | Sync từ Hub; async từ Runtime; agent chỉ gọi tool Dify qua `/mcp` (Hub tách `user=<tenant>:<user_id>`) | `modules/dify`, `modules/mcp` |
| GitHub | Stage "Áp" mở PR: Hub egress chỉ `HUB_GITHUB_API_URL`; Runtime push bằng PAT Hub giao một lần (`source-credential`) | PRODUCTION-NOTES 2026-10-15, spec P-c2 |
| KnowledgeHub (RAG ngoài) | Hub làm proxy: tool `kh_query` qua `/mcp`; khoá `kh_api_key` ở `hub.secrets`; allowlist `HUB_KH_ALLOWED_ORIGINS`; KH cần embedder đa ngữ (bge-m3) và TLS qua proxy | [ADR-0012](adr/0012-knowledgehub-external-rag.md), spec K1 |
| FileBox | Driver Storage `filebox` cho đính kèm (v1: một key, một org); mặc định `HUB_ATTACH_DRIVER=local` | [ADR-0015](adr/0015-filebox-external-file-storage.md) |
| SMTP | Cảnh báo quota, đặt lại mật khẩu (`SMTP_URL`; vắng = tắt) | admin-api |

## 9. Secret & mã hoá

| Khoá | Dùng bởi | Bảo vệ gì |
|---|---|---|
| `SECRET_MASTER_KEY` (base64 32 byte) | admin-api + hub-api | `admin.secrets` (app-key Dify…) và secret TOTP; AES-256-GCM |
| `HUB_SECRETS_KEY` (base64 32 byte, **khác** master) | chỉ hub-api | `hub.secrets`: provider key, source credential, khoá KH; trùng/thiếu ⇒ Hub không khởi động |
| `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY`/`JWT_KID` | admin ký; hub verify | token đăng nhập |
| `HUB_INTERNAL_TOKEN` | admin ↔ hub | `/internal/test-run` |

Secret chỉ ghi, không bao giờ trả về client. **Mất khoá = mất toàn bộ secret tương ứng** (phải nhập lại); **chưa có xoay khoá** (cột `key_version` chừa sẵn). Sao lưu khoá ngoài repo.

## 10. Vận hành & quan sát

- **Audit:** `admin.audit_log`, `hub.audit_log` append-only, ghi cùng transaction nghiệp vụ; có khôi phục bản trước (tạo dòng mới).
- **Quota/chi phí:** `hub.usage_logs` (token, `cost_usd`, `billable_usd`); Admin đọc để hiện quota, cảnh báo 80%/100% qua mail/banner.
- **Process engine:** bật bằng `HUB_PROCESS_ENGINE=on` (mặc định code là `off`; `.env.example` đặt `on`); vòng nền `sweepOnce` (3 s) bắt buộc chạy ở production, thiếu thì stage "Áp"/`interrupted` không tiến.
- **Hub nền:** lease run, sweeper đính kèm hết hạn, orphan-sweep; NOTIFY `hub_config_changed`.
- **Bẫy production:** [PRODUCTION-NOTES.md](PRODUCTION-NOTES.md) (TLS cho `/internal` `/mcp`; Hub không quét virus; `HUB_ATTACH_DIR` cần sao lưu/chung volume; PEM một dòng chỉ dotenv của Bun mở `\n` — không dùng `EnvironmentFile=` cho 2 service Bun).
- **Deploy:** [guides/deploy.md](guides/deploy.md) · mẫu env [.env.production.example](../.env.production.example). Thứ tự: migrate bằng owner → đặt mật khẩu 3 role → seed admin → build web (`PUBLIC_*` nhúng lúc build) → chạy service → reverse proxy + HTTPS.

## 11. Con trỏ tài liệu

| Cần | Mở |
|---|---|
| Tìm tài liệu | [INDEX.md](INDEX.md) |
| Module → file | [CODEMAP.md](CODEMAP.md) |
| FR → spec → code → test | [TRACE.md](TRACE.md) |
| Lộ trình/mốc | [ROADMAP.md](ROADMAP.md), [STATE.md](STATE.md) |
| Quyết định kiến trúc | [adr/](adr/) (0001 stack, 0007 Hub TS/Runtime Python, 0011 sandbox, 0012 KH, 0015 FileBox) |
| Thiết kế gốc | [design/architecture.md](design/architecture.md) |
| Spec từng feature | `docs/specs/<ID>/` |
| Chuẩn code / quy trình | [CONVENTIONS.md](CONVENTIONS.md), [WORKFLOW.md](WORKFLOW.md) |
| Deploy | [guides/deploy.md](guides/deploy.md) |

## 12. Lệch đã biết giữa tài liệu và code

| Chỗ | Tài liệu nói | Code | Xử lý ở đây |
|---|---|---|---|
| Thuật toán JWT | `.env.production.example` và `guides/deploy.md` §4: "RS256", sinh khoá RSA | `apps/*/src/lib/jwt.ts`: `EdDSA`, PEM Ed25519; ADR-0001 cũng ghi EdDSA | Theo code (EdDSA). Khoá RSA theo hướng dẫn deploy sẽ không nạp được — cần sửa deploy docs (xem `bun run keys:dev` để biết cách sinh khoá đúng) |
| Xác thực KH | PRODUCTION-NOTES (K1) nói OIDC client credentials `kh-ns-<ns>` | ADR-0012 §1 (CR-073): API gốc KH + header `X-KH-Key`, secret `kh_api_key` | Theo ADR-0012 (mới hơn) |
| Hàng đợi Worker | ADR-0001 nói BullMQ | ADR-0007: hàng đợi Postgres `hub.jobs` | Theo ADR-0007 |
