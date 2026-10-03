# Conventions — chuẩn code và format

Nguồn duy nhất cho chuẩn code. Agent trỏ tới file này, không chép lại. Đổi chuẩn: sửa ở đây và ghi một dòng vào `PRODUCTION-NOTES.md`.
Trạng thái: **tạm duyệt 2026-10-01**.

## 1. Format & lint — chỉ đụng phần mình sửa

- Công cụ duy nhất: **Biome** (format + lint), cấu hình ở `biome.json` gốc repo.
- Khi làm: `bunx biome check --write --changed` (chỉ file khác nhánh `main`).
- Pre-commit: `lefthook` chạy Biome trên file đã stage. CI: `bunx biome ci --changed`.
- **Cấm** chạy format/lint/refactor trên toàn repo hoặc thư mục không thuộc task.
- Chỉ sửa lỗi lint trong file task có chạm tới. Lỗi ở file khác → ghi `docs/TECH-DEBT.md`, không sửa.
- Cần format lại một file lớn → commit riêng `style: …`, không trộn với thay đổi logic.

## 2. Cấu trúc: feature-first, colocation

Chia theo feature trước, trong feature mới chia lớp. Một thứ chỉ ra thư mục dùng chung khi **≥ 2 feature** dùng nó.

### Backend (`apps/*-api`, Hono)

```
src/
├─ app.ts · server.ts          # dựng app, mount route các module
├─ config/env.ts                # env đọc + validate bằng zod
├─ lib/                         # db client, logger, errors, middleware auth + tenant context
└─ modules/<module>/
   ├─ README.md                 # ≤ 30 dòng: FR phụ trách, điểm vào, phụ thuộc
   ├─ <module>.routes.ts        # parse bằng contract → gọi service → trả response. Không logic
   ├─ <module>.service.ts       # nghiệp vụ, transaction. Không biết HTTP
   ├─ <module>.repo.ts          # Drizzle query, luôn lọc tenant
   ├─ <module>.rules.ts         # luật BR dạng hàm thuần (QC viết test trước)
   ├─ <module>.errors.ts        # mã lỗi của module
   └─ <module>.test.ts
packages/contracts/src/<module>.ts   # zod request/response/lỗi — backend-lead sở hữu
packages/db/src/schema/<module>.ts   # Drizzle schema + migration
```

Chiều phụ thuộc: `routes → service → repo`; `rules` thuần, không import I/O. Module không import `repo` của module khác — đi qua `service` của module đó.

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
   ├─ api.ts                   # hook TanStack Query dựa trên contract — NƠI DUY NHẤT gọi API
   ├─ pages/<Name>Page.tsx     # chỉ ghép component
   ├─ components/<Name>.tsx    # trình bày, nhận props, không fetch
   ├─ lib/                     # helper thuần
   └─ *.test.tsx
```

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

Tên test: `"<mã> · mô tả"` (mã FR/NFR/AC) để `trace` nối test với yêu cầu (T-TRACE-2).

## 3. Đặt tên

| Thứ | Quy tắc | Ví dụ |
|---|---|---|
| Component, page | `PascalCase.tsx`, 1 component export mỗi file | `CommandEditorPage.tsx` |
| File khác | `kebab-case.ts` hoặc `<module>.<lớp>.ts` | `commands.service.ts` |
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

Thực thi: luật Biome · `bun run check:size` (đỏ khi > 400 dòng) · `dependency-cruiser` (đỏ khi import sai chiều: route→repo, component→fetch, module→repo module khác). Tất cả chạy trên file thay đổi.

## 5. Code

- TypeScript `strict`. Không `any` (dùng `unknown` + thu hẹp). Không `@ts-ignore` (nếu buộc phải: `@ts-expect-error` + lý do).
- Validate bằng zod **ở biên** (request, env, dữ liệu đọc từ jsonb). Bên trong tin kiểu.
- Lỗi: ném lỗi có mã (`AppError(code, status, details?)`); response lỗi `{error:{code,message,details?}}`.
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
| Chiều import | dependency-cruiser | `import-linter` (`lint-imports`) |
| Validate ở biên | zod | pydantic v2 |
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

Test: unit `test_*.py` đặt cạnh file code; test cần Postgres/Redis thật là `*_int_test.py` cạnh file, gắn marker `int` (`pytest -m int` = `bun run test:int`). Mỗi thư mục có `README.md` ≤ 30 dòng như §2.

### Giới hạn và luật code

- Cỡ: file ≤ 400 dòng, hàm ≤ 50 dòng, ≤ 4 tham số ngoài `self` (§4). Ruff: `PLR0913`, `PLR0915`, `C901`; chạy trong `check`.
- asyncio async/await; type hint đầy đủ; pydantic v2 cho dữ liệu qua biên.
- Lỗi: mã dùng chung với Hub (`ALL_PROVIDERS_EXHAUSTED`, `TIMEOUT`, `CANCELLED`, `UPSTREAM_ERROR`…) lấy từ `contracts/` sinh ra, không tự đặt chuỗi.
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
  && uv run pyright && uv run pytest && uv run lint-imports
```
Thêm `uv run pytest -m int` khi chạm DB/Redis.
