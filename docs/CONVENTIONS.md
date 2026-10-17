# Conventions — chuẩn code và format

Nguồn duy nhất cho chuẩn code. Agent trỏ tới file này, không chép lại. Đổi chuẩn: sửa ở đây và ghi một dòng vào `PRODUCTION-NOTES.md`.
Trạng thái: **tạm duyệt 2026-10-01**; sửa 2026-10-17 theo ADR-0023 (bốn lớp, CR-088…091: §2, §3, §4, §5, §9, §10).

## 1. Format & lint — chỉ đụng phần mình sửa

- Công cụ duy nhất: **Biome** (format + lint), cấu hình ở `biome.json` gốc repo.
- Khi làm: `bunx biome check --write --changed` (chỉ file khác nhánh `main`).
- Pre-commit: `lefthook` chạy Biome trên file đã stage. CI: `bunx biome ci --changed`.
- **Cấm** chạy format/lint/refactor trên toàn repo hoặc thư mục không thuộc task.
- Chỉ sửa lỗi lint trong file task có chạm tới. Lỗi ở file khác → ghi `docs/TECH-DEBT.md`, không sửa.
- Cần format lại một file lớn → commit riêng `style: …`, không trộn với thay đổi logic.

## 2. Cấu trúc: feature-first, Clean Architecture bốn lớp ([ADR-0023](adr/0023-clean-architecture.md), CR-088)

Chia theo feature/module trước, trong module chia **bốn lớp**. Một thứ chỉ ra thư mục dùng chung khi **≥ 2 feature** dùng nó. Code cũ chưa chuyển giữ cấu trúc `routes → service → repo` cũ tới khi task chạm tới (§10).

| Lớp | Thư mục / file | Được import |
|---|---|---|
| 1 Domain | `domain/` — kiểu tự khai, `*.rules.ts` thuần, `errors.ts` | chỉ `domain/` + **built-in** |
| 2 Application | `application/` — `*.usecase.ts`, `ports.ts` | `domain/`, `application/` + **built-in** |
| 3 Adapters | `adapters/` — `*.routes.ts` (Hono mỏng), `*.repo.ts` (Drizzle cài port), `<m>.mapper.ts`, `*.presenter.ts` | lớp 1–2, `@ai/contracts`, Hono, Drizzle |
| 4 Khung | `<m>.mount.ts`, `lib/`, `app.ts`, `server.ts`, `config/`, `packages/db` | mọi thứ |

**Built-in** ở lớp 1–2 (TS): mọi built-in ECMAScript (`Map`, `Set`, `Intl`, `structuredClone`, `Date` làm giá trị). **Cấm** `node:*`, `bun:*`, mọi package npm — gồm `@ai/contracts`, `@ai/db`, `zod`, kể cả `import type`. `Date.now()`, `new Date()` không tham số, `crypto.randomUUID()`, `Math.random()` chỉ qua port `Clock`/`IdGen`. API web không thuộc ECMAScript (`TextEncoder`, `fetch`, `URL`…) cũng không dùng — adapter tính rồi truyền vào.

### Backend (`apps/*-api`, Hono)

```
src/
├─ app.ts · server.ts · config/env.ts   # lớp 4
├─ lib/                                  # lớp 4: db client, redis, logger, AppError/HTTP, middleware auth + tenant
└─ modules/<m>/
   ├─ README.md                 # ≤ 30 dòng: FR phụ trách, điểm vào, phụ thuộc
   ├─ <m>.mount.ts              # lớp 4: dựng adapter, truyền port vào use case, mount route
   ├─ domain/                   # <x>.ts (kiểu) · <x>.rules.ts (QC viết test trước) · errors.ts
   ├─ application/              # <x>.usecase.ts · ports.ts (repo port, UnitOfWork, Clock, IdGen, Notifier, Logger)
   └─ adapters/                 # <m>.routes.ts · <x>.repo.ts · <m>.mapper.ts (+ .test.ts) · <x>.presenter.ts
packages/contracts/src/<m>.ts   # lớp 3: zod request/response/lỗi — backend-lead sở hữu
packages/db/src/schema/<m>.ts   # lớp 4: Drizzle schema + migration
```

- Module lớn (vd `processes`) chia thư mục con theo nhóm **bên trong** từng lớp: `domain/runs/…`, `application/timers/…`.
- Chiều phụ thuộc: `routes → use case → port ← repo`; use case không biết HTTP, Drizzle, Redis. Route ≤ 30 dòng: parse bằng mapper → gọi use case → presenter → response.
- Lớp 1–2 của module A **không** import lớp 1–2 của module B: A khai port, `<m>.mount.ts` nối port tới use case của B. Module không import `repo` của module khác (như cũ).
- Port chuẩn: `UnitOfWork` (một use case = một tx theo scope tenant, hoặc `system` cho vòng nền — khi đó mọi truy vấn lọc `tenant_id` tường minh; cài bằng `withScope`/`withHubScope`), `Clock`, `IdGen`, `Notifier` (phát sự kiện **sau COMMIT**), `Logger`. `UnitOfWork` chạm RLS ⇒ security review khi đổi.
- Không có package domain dùng chung ở v1: hằng nghiệp vụ domain cần (vd trần, backoff) khai lại trong `domain/` và mapper test khẳng định bằng hằng contract.

### Frontend (`apps/*-web`, React + Rsbuild)

```
src/
├─ app/                        # router, providers, app shell
├─ routes/                     # file route mỏng: chỉ import page
├─ components/ui/              # shadcn sinh ra — không sửa logic
├─ components/shared/          # dùng ≥ 2 feature: DataTable, StatusBadge, QuotaBar…
├─ lib/                        # http client, auth, format số/ngày
└─ features/<feature>/
   ├─ README.md
   ├─ domain/                  # luật/kiểu thuần (CR-091): chỉ built-in — cấm React, @ai/contracts, zod
   ├─ api.ts                   # hook TanStack Query dựa trên contract — NƠI DUY NHẤT gọi API
   ├─ pages/<Name>Page.tsx     # chỉ ghép component
   ├─ components/<Name>.tsx    # trình bày, nhận props, không fetch
   ├─ lib/                     # helper gắn UI/contract (map contract → kiểu domain đặt ở đây hoặc api.ts)
   └─ *.test.tsx
```

Web **áp nhẹ** (CR-091): chỉ tách `features/<f>/domain/`; `api.ts`, component, page, hook coi là lớp 3–4, giữ như trên. Chuyển logic thuần sang `domain/` khi task sửa logic đó (§10).

### Test

```
tests/acceptance/<FR-ID>/*.test.ts   # QC — bị khoá (xem WORKFLOW.md)
e2e/<feature>.spec.ts                 # QC — Playwright, bị khoá
<cạnh file code>/*.test.ts            # unit test của FE/BE
```

E2E chọn phần tử theo **role + nhãn nguyên văn** trong spec (`getByRole('button', { name: 'Lưu' })`), không theo class/CSS. Chỉ dùng `data-testid` khi không có role/nhãn phù hợp và phải ghi trong spec.

### Đuôi file test và tooling

| Đuôi / vị trí | Ý nghĩa | Chạy bằng |
|---|---|---|
| `*.test.ts(x)` | unit/acceptance, không cần hạ tầng | `bun test` |
| `*.int.test.ts` | cần Postgres/Redis thật (docker compose) | `bun run test:int` (đo hiệu năng `*.perf.int.test.ts`: `bun run test:perf`, không thuộc Lệnh xong) |
| `*.check.ts` | script kiểm tra độc lập, exit code 0/≠0 | `bun <file>` (vd `ac07.check.ts`) |
| `tools/*` | workspace công cụ dev (`mocks`, `scripts`), không deploy | `bun run <script>` |
| `tsconfig.tests.json` (gốc) | typecheck `tests/**` và `e2e/**`, chạy trong `bun run typecheck` | `tsc -p` |

**Bẫy đã gặp (M3, bắt buộc):**
- postgres.js 3.x: tham số `${obj}::jsonb` vào DB thành **chuỗi** JSON → dùng `sql.json(obj)`; mảng JS cho `::boolean[]`/`::int[]` → `sql.array(values, <oid>)`; tham số trong `jsonb_build_object(…)`/hàm đa kiểu phải ép kiểu (`${x}::text`).
- Fixture không giữ trạng thái chung giữa các ca: tham số ghi đè chỉ áp cho lần gọi (`x.perms ?? base`), không gán lại biến module.
- Listener/NOTIFY: tìm thông điệp từ mốc `from` của ca hiện tại, không tìm trên cả mảng (giá trị `v` có thể lặp sau khi reset).
- E2E sau thao tác lưu: chờ phản hồi mạng (`page.waitForResponse`) hoặc trạng thái UI do lưu xong gây ra, không chờ "dialog không có" (đúng ngay từ đầu).
- Dữ liệu test phải hợp contract ở mọi trường khác trường đang kiểm (vd không lặp cặp trong batch khi đang kiểm `NOT_ENTITLED`).
- Int test trên DB tag riêng: dùng `.env.test-<tag>.local` sinh **sau** P-b RV3 (đổi cả `HUB_TEST_`/`AGENT_RT_TEST_DATABASE_URL` sang DB tag); file cũ còn trỏ `ai_system_h1_test` chung ⇒ chạy lại `bun run db:test:create <tag>` trước.

Tên test: `"<mã> · mô tả"` (mã FR/NFR/AC) để `trace` nối test với yêu cầu (T-TRACE-2).

## 3. Đặt tên

| Thứ | Quy tắc | Ví dụ |
|---|---|---|
| Component, page | `PascalCase.tsx`, 1 component export mỗi file | `CommandEditorPage.tsx` |
| File khác | `kebab-case.ts` hoặc `<module>.<lớp>.ts` | `commands.service.ts` |
| Hậu tố theo lớp (CR-088) | lớp 1 `*.rules.ts`, `errors.ts` · lớp 2 `*.usecase.ts`, `ports.ts` · lớp 3 `*.routes.ts`, `*.repo.ts`, `*.mapper.ts`, `*.presenter.ts` · lớp 4 `<m>.mount.ts` | `retry.rules.ts`, `fire-timer.usecase.ts` |
| Kiểu domain | `PascalCase`, **không** hậu tố `Schema`/`Input` (đó là contract) | `StageRun`, `RetryDecision` |
| Mã lỗi domain | union chuỗi `SCREAMING_SNAKE` trong `domain/errors.ts` | `type ProcessError = "STAGE_LOCKED" \| …` |
| Hàm, biến | `camelCase`, động từ cho hàm | `canUseCommand()` |
| Kiểu, schema zod | `PascalCase` + hậu tố | `CommandCreateInput`, `CommandSchema` |
| Hằng | `SCREAMING_SNAKE` | `MAX_LOGIN_ATTEMPTS` |
| Mã lỗi | `SCREAMING_SNAKE`, khớp spec | `VERSION_CONFLICT` |
| Bảng/cột DB | `snake_case`, bảng số nhiều | `feature_grants.granted_at` |
| i18n key | `<feature>.<khu>.<tên>` | `commands.editor.save` |

## 4. Giới hạn

| Đối tượng | Giới hạn | Vượt thì |
|---|---|---|
| File code | nên ≤ 250 dòng, **tối đa 400** (miễn: file sinh tự động, `components/ui`; test tối đa 600) | tách theo trách nhiệm |
| Hàm | ≤ 50 dòng, ≤ 4 tham số (hơn → object), cognitive complexity ≤ 15 | tách hàm con |
| React component | ≤ 200 dòng, JSX lồng ≤ 4 cấp | tách component con |
| Route handler | ≤ 30 dòng | đẩy xuống service |
| Thư mục feature/module | ≤ 10 file ngang hàng | thư mục con |
| Diff mỗi task | ≈ ≤ 400 dòng thay đổi (không tính test, migration sinh ra) | chia task |

File chạm tới đã vượt giới hạn từ trước: chỉ tách khi phần đang sửa nằm trong đoạn đó; nếu không → `TECH-DEBT.md`.

Thực thi: luật Biome · `bun run check:size` (đỏ khi > 400 dòng) · `dependency-cruiser` (đỏ khi import sai chiều: route→repo, component→fetch, module→repo module khác; **`ca-domain-builtin-only`**: file trong `domain/` import ngoài `domain/`; **`ca-application-inward-only`**: file trong `application/` import ngoài `domain/`/`application/` — ADR-0023). Tất cả chạy trên file thay đổi. Luật lớp chỉ áp thư mục `domain/`, `application/` ⇒ code cũ chưa chuyển không bị chặn. Giá trị không tất định ở lớp 1–2 chưa có luật máy — reviewer kiểm.

## 5. Code

- TypeScript `strict`. Không `any` (dùng `unknown` + thu hẹp). Không `@ts-ignore` (nếu buộc phải: `@ts-expect-error` + lý do).
- Validate bằng zod **ở biên** (request, env, dữ liệu đọc từ jsonb) — chỉ ở lớp 3–4. Bên trong tin kiểu.
- **Mapper** (`adapters/<m>.mapper.ts`): parse bằng schema contract rồi **dựng kiểu domain**; chiều ra domain → DTO contract. Kèm `adapters/<m>.mapper.test.ts` khẳng định khớp kiểu: `const _t: AssertEqual<Domain, z.infer<typeof Schema>> = true` (domain cố ý khác, vd `Date` thay chuỗi ISO ⇒ so trên kiểu đã chuyển đổi, ghi lý do một dòng) và hằng domain = hằng contract. Contract đổi ⇒ `typecheck`/test đỏ ở mapper, không lan vào domain.
- Lỗi domain: mã là union chuỗi trong `domain/errors.ts` + lớp `DomainError` (kế thừa `Error`, mang `code`); kết quả nghiệp vụ bình thường trả giá trị, không ném. Adapter map mã domain → mã contract + HTTP bằng bảng `Record<DomainCode, {code, status}>` trong mapper (thiếu mã ⇒ `typecheck` đỏ), rồi ném `AppError(code, status, details?)` (lớp 4 `lib/`). Response lỗi `{error:{code,message,details?}}`; mã contract hiện có không đổi.
- Không log secret, token, mật khẩu, nội dung file. Log có `request_id`, `tenant_id`, `module`.
- Không dead code, không code comment-out. TODO phải có mã: `// TODO(ADM-FR-54): …`.
- Comment giải thích **vì sao**, không kể lại code. Đầu mỗi module/feature: một dòng mã FR phụ trách.

## 6. Hiệu năng (mặc định, spec có thể siết thêm)

| Chỉ số | Ngân sách |
|---|---|
| API CRUD p95 | < 300 ms với 5.000 bản ghi/bảng |
| Mọi list | có `limit` (mặc định 50, tối đa 200) |
| Query mới lọc/sort | có index tương ứng |
| JS ban đầu của app web | < 250 KB gzip; route tách chunk |
| LCP trang danh sách | < 2 s trên máy dev |
| Bảng > 200 dòng hiển thị | virtualize |

## 7. Git

- Branch `feat/<SPEC-ID>-<slug>`; commit `feat(<module>): <việc> [ADM-FR-xx]`; mỗi task một commit.
- Không commit lên `main`, không push, không đổi lịch sử trừ khi được yêu cầu.

## 8. Migration DB

- Từ M2: không sửa migration đã commit; mọi thay đổi là migration mới (kể cả siết policy RLS). Ngoại lệ M1 (`0002_admin_rls.sql` sửa ở `ceb5693`): xem `packages/db/README.md`.

## 9. Python — Agent Runtime (`apps/agent-runtime`)

Theo [ADR-0007](adr/0007-hub-ts-agent-runtime-python.md). Chỉ áp cho `apps/agent-runtime`; phần còn lại của repo vẫn TS (§1–8). Mã chạy trong WSL2 Ubuntu (CR-029, WRK-NFR-06): **chỉ nhắm Linux, không viết nhánh Windows**.

### Đối chiếu TS ↔ Python

| Việc | TS (§1–6) | Python |
|---|---|---|
| Runtime / package | Bun, `bun.lock` | Python 3.12+, `uv` (`uv.lock`, `uv sync --frozen`) |
| Format + lint | Biome | `ruff format` + `ruff check`, chỉ file thay đổi (như §1) |
| Kiểu | `tsc` strict | `pyright` strict, cấm `Any` ngầm |
| Test | `bun test` | `pytest` + `pytest-asyncio` |
| Chiều import | dependency-cruiser | `import-linter` (`lint-imports`) + `scripts/check_layers.py` (lớp 1–2) |
| Validate ở biên | zod (lớp 3–4) | pydantic v2 (lớp 3–4) |
| Lớp 1–2 chỉ dùng | built-in ECMAScript | stdlib **trừ I/O** (§9 "Bốn lớp") |
| Log | logger có `request_id` | `structlog`/logging JSON có `job_id`, `run_id`, `tenant_id` (WRK-NFR-04); cấm `print` |
| Tên | camelCase / kebab-case | `snake_case` module + hàm, `PascalCase` class, hằng `UPPER_SNAKE` |

Turborepo gọi qua scripts trong `apps/agent-runtime/package.json` (`check`, `typecheck`, `test`, `test:int`) nên `bun run check|typecheck|test` ở gốc vẫn chạy cả Python.

### Cấu trúc (`src/agent_runtime/`)

| Thư mục | Nội dung |
|---|---|
| `queue/` | claim job `FOR UPDATE SKIP LOCKED`, heartbeat, nghe cancel (`NOTIFY job_cancel`) |
| `events/` | ghi sự kiện run vào Redis Streams (`XADD run:<run_id>`) |
| `runtimes/{cli,llm,python}/` | ba loại runtime |
| `providers/` | claude (Agent SDK Python), codex, gemini |
| `sandbox/` | hook chặn đường dẫn (WRK-BR-07), process group |
| `agents/` | agent nội bộ: mỗi agent một module, đăng ký vào registry → manifest `hub.agent_types` |
| `contracts/` | pydantic **sinh** từ JSON Schema xuất từ zod; header "generated", không sửa tay |
| `db/` | SQL thuần cho bảng `hub` (không ORM, không migration; migration vẫn ở `packages/db` Drizzle, §8) |
| `config.py` · `main.py` | env (pydantic-settings) · điểm vào |

### Bốn lớp trong Python (ADR-0023, CR-088)

Mỗi ctx đã chuyển (`src/agent_runtime/<ctx>/`): `domain/` (dataclass `frozen=True`, `typing.Literal`, `enum`, `*_rules.py`, `errors.py`) · `application/` (`*_usecase.py`, `ports.py` — `typing.Protocol`) · `adapters/` (`*_repo.py` asyncpg/SQL thuần, `*_mapper.py` pydantic ↔ dataclass + test so tập trường, client provider/Redis) · `mount.py` (lớp 4, dựng phụ thuộc). `main.py`, `config.py`, `db/` (pool) = lớp 4; `contracts/` (pydantic sinh) = lớp 3.
- Lớp 1–2: stdlib trừ I/O — cấm `os`, `subprocess`, `socket`, `asyncio` (I/O), `pathlib` (I/O), `shutil`, `tempfile`, `logging`… (danh sách: `scripts/check_layers.py`); cấm `pydantic`, `asyncpg`, `redis`, `structlog`, `claude_agent_sdk`. Log qua port `Logger`; giờ/id qua `Clock`/`IdGen`. `async def` + `typing.Protocol` được dùng (không I/O).
- Cưỡng chế: giữ contract import-linter hiện có; thêm một contract `layers` cho mỗi ctx khi chuyển (`<ctx>.adapters` → `<ctx>.application` → `<ctx>.domain`); `uv run python scripts/check_layers.py` chạy trong `check`.
- Ctx chưa chuyển giữ cấu trúc bảng dưới tới khi task chạm tới (§10).

Test: unit `test_*.py` đặt cạnh file code; test cần Postgres/Redis thật là `*_int_test.py` cạnh file, gắn marker `int` (`pytest -m int` = `bun run test:int`). Mỗi thư mục có `README.md` ≤ 30 dòng như §2.

### Giới hạn và luật code

- Cỡ: file ≤ 400 dòng, hàm ≤ 50 dòng, ≤ 4 tham số ngoài `self` (§4). Ruff: `PLR0913`, `PLR0915`, `C901`; chạy trong `check`.
- asyncio async/await; type hint đầy đủ; pydantic v2 cho dữ liệu qua biên (lớp 3–4).
- Lỗi: mã gửi ra Hub (`ALL_PROVIDERS_EXHAUSTED`, `TIMEOUT`, `CANCELLED`, `UPSTREAM_ERROR`…) lấy từ `contracts/` sinh ra, không tự đặt chuỗi ở lớp 3–4. Lớp 1–2 khai mã domain bằng `Literal` trong `domain/errors.py`; adapter map sang mã contract (thiếu mã ⇒ test mapper đỏ).
- Không log secret, nội dung file.
- Subprocess: luôn `start_new_session=True` (process group riêng, huỷ = SIGTERM group, 3 giây sau SIGKILL), `env` tường minh (không kế thừa `os.environ`), cấm `shell=True`. Agent nội bộ chạy process con không mang secret (WRK-FR-26).
- Mã yêu cầu ở docstring đầu module (`"""WRK-FR-01 · HUB-FR-89 · …"""`); test đặt tên chứa mã (`test_wrk_fr_05_cancel_kills_group`). TODO: `# TODO(WRK-FR-xx): …`.
- **Chưa có:** `bun run trace` và `check:size` chưa quét `.py`; mở rộng ở task đầu H1.

### Thư viện

Đã duyệt (ADR-0007): uv, ruff, pyright, pytest, pydantic. Dự kiến (asyncpg, redis-py, claude-agent-sdk, structlog, pytest-asyncio, import-linter) là **đề xuất trong ADR của plan H1**, chưa duyệt. Thư viện mới cần ADR như TS.

### Lệnh xong task Python

```
cd apps/agent-runtime
uv run ruff check --diff <file đổi> && uv run ruff format --check <file đổi> \
  && uv run pyright && uv run pytest && uv run lint-imports && uv run python scripts/check_layers.py
```
Thêm `uv run pytest -m int` khi chạm DB/Redis.

## 10. Chuyển dần sang bốn lớp (CR-089, ADR-0023)

- Code **mới** viết theo §2 ngay. Code cũ **không** big-bang: task **sửa logic** trong một file cũ ⇒ tách phần chạm tới (hàm bị sửa và thứ nó cần) sang `domain/`/`application/`/`adapters/` trong cùng task (ngoại lệ Luật 4 `CLAUDE.md`). Chỉ thêm lời gọi tới code mới ⇒ không bắt buộc tách. Commit tách riêng `refactor(<m>): tách <x> sang lớp [CR-089]`, không đổi hành vi, trước commit đổi logic.
- Thứ tự module: `hub-api/processes` (mẫu, qua P-d; phần còn lại = mốc CA-processes) → `mcp`, `runs` → phần còn lại hub-api → admin-api → agent-runtime (`autofix`, `sources`, lõi thuần `runtimes/cli` trước) → web (§2 Frontend).
- Module chưa chuyển: một dòng `TECH-DEBT.md` (gom theo app). Chuyển xong cả module ⇒ xoá khỏi dòng đó, cập nhật `CODEMAP.md`.
- **Test khoá khi dời file:** `qc` sửa đường dẫn trong helper `tryLoad`/import của test khoá **cùng task dời** (một commit qc cho mỗi lần dời, cập nhật `tests/.lock`). **Không** để shim re-export ở đường dẫn cũ.
- **Luật `tryLoad` (qc):** helper nạp module theo đường dẫn phải **báo rõ** khi file vắng (ném/`expect` với thông điệp "module vắng: <đường dẫn>"), không trả `{}` lặng lẽ. Áp khi qc chạm helper đó lần đầu (mẫu: `tests/acceptance/P-a/_support/modules.ts`).
