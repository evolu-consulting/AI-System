# ADR-0023 · Clean Architecture bốn lớp, lớp 1–2 chỉ dùng thư viện có sẵn

Trạng thái: **Accepted** · Ngày: 2026-10-17 (người dùng duyệt trong phiên, cùng CR-088) · Liên quan: ADR-0001 (stack), ADR-0007 (Hub TS / Runtime Python), CR-088…091

## Bối cảnh
Người dùng (2026-10-17) yêu cầu cả repo theo Clean Architecture; lớp 1 và 2 chỉ dùng thư viện có sẵn của ngôn ngữ; **cấm hẳn** `@ai/contracts`, `zod`, `pydantic` ở lớp 1–2 (kể cả `import type`). Intake Đầy đủ đã chạy; người dùng chấp nhận 14 mặc định (ghi ở CR-088…091).

Hiện trạng (đo 2026-10-17):
- Backend TS chia theo module (`routes → service → repo`, `rules` thuần — CONVENTIONS §2 cũ). 93 file `*.rules.ts`, **74** file trong đó import `@ai/contracts` (kiểu zod lọt vào luật nghiệp vụ). 66 file `*.service.ts`, **60** file gọi thẳng Drizzle/`@ai/db` (nghiệp vụ dính transaction/RLS). hub-api 25 module, admin-api 16 module.
- `apps/agent-runtime` (Python): 11 package (`agents`, `apply`, `autofix`, `contracts`, `db`, `events`, `providers`, `queue`, `runtimes`, `sandbox`, `sources`); chiều import theo tầng kỹ thuật (import-linter), pydantic dùng cả trong luật.
- Web (admin-web, chat-web, studio-web): feature-first; `lib/` của feature trộn helper thuần với kiểu contract.
- Test khoá: 162 file test (`tests/acceptance/**`, `e2e/**`) tham chiếu đường dẫn `apps/*/src`; 10 helper `tryLoad` nạp module theo đường dẫn và **trả `{}` lặng lẽ** khi file vắng ⇒ dời file làm test đỏ ở `expect` mà không báo vì sao.

Vấn đề: luật nghiệp vụ không test được nếu không dựng contract/DB; đổi contract kéo theo sửa luật; khó thay hạ tầng (Drizzle, Redis, Dify) mà không chạm nghiệp vụ.

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| A. Giữ như cũ, chỉ siết `*.rules.ts` | không tốn | không đạt yêu cầu người dùng |
| B. Chuyển cả repo một lần (big-bang) | đồng nhất ngay | 162 test khoá phải sửa cùng lúc; dừng mọi mốc; rủi ro hồi quy cao |
| **C. Bốn lớp + chuyển dần theo module (strangler)** | code mới đúng chuẩn ngay; code cũ chuyển khi task chạm tới; CI chỉ áp cho thư mục mới | hai kiểu cấu trúc cùng tồn tại một thời gian; mốc đầu chậm hơn |

## Quyết định — phương án C

### 1. Bốn lớp và quy tắc phụ thuộc
Phụ thuộc chỉ hướng **vào trong** (4 → 3 → 2 → 1). Lớp trong không biết lớp ngoài tồn tại.

| Lớp | Tên thư mục | Chứa | Được import |
|---|---|---|---|
| 1 Domain | `domain/` | kiểu nghiệp vụ tự khai, luật thuần (`*.rules.ts`), mã lỗi domain (`errors.ts`) | chỉ `domain/` + built-in |
| 2 Application | `application/` | use case (`*.usecase.ts`), cổng (`ports.ts`) | `domain/`, `application/` + built-in |
| 3 Adapters | `adapters/` | routes Hono mỏng, repo Drizzle cài port, mapper contract ↔ domain, presenter | lớp 1–2, `@ai/contracts`, Hono, Drizzle |
| 4 Frameworks & khung | `<m>.mount.ts`, `lib/`, `app.ts`, `server.ts`, `packages/db` | dựng phụ thuộc, nối adapter vào use case, db client, redis, lỗi HTTP | mọi thứ |

`packages/contracts` = lớp 3 (biên dùng chung); `packages/db` = lớp 4. **Không** lập package domain dùng chung ở v1 — mỗi module tự khai kiểu domain của mình.

### 2. "Chỉ thư viện có sẵn" ở lớp 1–2
- **TypeScript:** mọi built-in ECMAScript (`Map`, `Set`, `Intl`, `structuredClone`, `Array`, `Date` làm giá trị — `new Date(iso)`, phép so sánh). **Cấm** `node:*`, `bun:*`, mọi package npm (gồm `@ai/*`, `zod`, `drizzle-orm`, `hono`), kể cả `import type`. Giá trị **không tất định** (`Date.now()`, `new Date()` không tham số, `crypto.randomUUID()`, `Math.random()`) chỉ lấy qua port `Clock` / `IdGen`.
- **Python:** stdlib **trừ I/O** (`os`, `subprocess`, `socket`, I/O `asyncio`, I/O `pathlib`, `shutil`, `tempfile`, `logging`…; danh sách đầy đủ ở `apps/agent-runtime/scripts/check_layers.py`). Cấm `pydantic`, `asyncpg`, `redis`, `structlog`. Log qua port `Logger`. Kiểu domain: `dataclass(frozen=True)`, `typing.Literal`, `enum`.

### 3. Cấu trúc thư mục
**Backend TS** (`apps/*-api/src/modules/<m>/`):
```
<m>.mount.ts                  # lớp 4: dựng adapter, truyền vào use case, mount route
README.md
domain/      <x>.rules.ts · <x>.ts (kiểu) · errors.ts
application/ <x>.usecase.ts · ports.ts
adapters/    <m>.routes.ts · <x>.repo.ts · <m>.mapper.ts (+ .test.ts) · <x>.presenter.ts
```
Module lớn (vd `processes`) chia thư mục con theo nhóm **bên trong** từng lớp (`domain/runs/…`, `application/runs/…`). Lớp 1–2 của module A **không** import lớp 1–2 của module B — A khai port, lớp 4 nối port đó tới use case của B.

**Python** (`src/agent_runtime/<ctx>/`): `domain/`, `application/` (`*_usecase.py`, `ports.py`, `errors.py`), `adapters/` (`*_repo.py`, `*_mapper.py`), `mount.py` (lớp 4); `main.py`, `config.py`, `db/` = lớp 4; `contracts/` (pydantic sinh) = lớp 3.

**Web** (áp nhẹ): chỉ tách `features/<f>/domain/` thuần (built-in; cấm React, `@ai/contracts`, `zod`). `api.ts`, component, page, hook giữ như CONVENTIONS (coi là lớp 3–4).

### 4. Biên: mapper + test khớp kiểu
- Mỗi module có `adapters/<m>.mapper.ts`: parse bằng schema contract (zod) rồi **dựng kiểu domain**; chiều ra: domain → DTO contract.
- Test khớp kiểu ở lớp 3 (`adapters/<m>.mapper.test.ts`): `AssertEqual<Domain, z.infer<typeof Schema>>` (hoặc trên kiểu đã chuyển đổi khi domain cố ý khác, vd `Date` thay chuỗi ISO — ghi lý do một dòng). Contract đổi mà domain không đổi ⇒ `typecheck` đỏ.
- Python: `adapters/<ctx>_mapper.py` + test so tập trường dataclass ↔ model pydantic.

### 5. Lỗi
- Domain khai mã lỗi là **union chuỗi** trong `domain/errors.ts` (vd `type ProcessError = 'RUN_NOT_FOUND' | 'STAGE_LOCKED'`) và lớp lỗi built-in `DomainError` (kế thừa `Error`, mang `code`). Kết quả nghiệp vụ bình thường trả giá trị (vd `classifyJobError → 'transient' | 'business'`), không ném.
- Adapter map mã domain → mã contract + HTTP (`AppError(code, status)`) bằng bảng `Record<DomainCode, …>` trong mapper (thiếu mã ⇒ `typecheck` đỏ). Mã contract hiện có **không đổi**.

### 6. Cổng (port) chuẩn
| Port | Ý nghĩa | Adapter cài |
|---|---|---|
| `UnitOfWork` | chạy một use case trong một transaction theo scope tenant (hoặc `system` cho vòng nền, bắt buộc lọc `tenant_id` tường minh) | `withScope` (admin-api) / `withHubScope` (hub-api); Python: pool asyncpg + `SET LOCAL` |
| `Clock` | `now(): Date` | `systemClock`, đồng hồ giả test (`AppDeps.now`) |
| `IdGen` | `newId(): string` | `crypto.randomUUID` |
| `Notifier` | phát sự kiện **sau COMMIT** (NOTIFY, Redis Streams, SSE, DM hệ thống) | Redis/pg |
| `Logger` | log có ngữ cảnh | logger app / structlog |
| repo port | đọc/ghi theo nhu cầu use case | `*.repo.ts` Drizzle / SQL thuần |

`UnitOfWork` chạm RLS/cách ly tenant ⇒ **hard stop**: module mẫu (`hub-api/processes`) phải qua security review trước khi dùng làm khuôn.

### 7. Cưỡng chế
- `dependency-cruiser`: luật `ca-domain-builtin-only`, `ca-application-inward-only` (chỉ áp file trong `domain/`, `application/`; test bỏ qua).
- Python: giữ contract import-linter hiện có, thêm contract theo từng ctx đã chuyển; `scripts/check_layers.py` kiểm stdlib + chiều lớp cho `domain/`/`application/` (chạy trong `check`).
- Giá trị không tất định ở lớp 1–2: reviewer kiểm (chưa có luật máy).
- Code cũ chưa chuyển **không** bị CI chặn.

### 8. Chuyển dần (strangler)
- Code **mới** viết theo 4 lớp ngay. File cũ chỉ tách khi task **sửa logic** trong file đó (ngoại lệ Luật 4, CR-089); không big-bang.
- Thứ tự: `hub-api/processes` (mẫu, qua P-d) → `mcp`, `runs` → phần còn lại hub-api → admin-api → agent-runtime (`autofix`, `sources`, lõi thuần của `runtimes/cli` trước) → web.
- Dời file mà có test khoá: `qc` sửa đường dẫn trong helper `tryLoad`/import **cùng task** (một commit qc mỗi module), **không** để shim re-export. Helper `tryLoad` phải báo rõ khi module vắng (không trả `{}` lặng lẽ).
- Module chưa chuyển: một dòng `TECH-DEBT.md` (trỏ CR-089).

## Hệ quả
- Được: luật nghiệp vụ test được không cần DB/contract; đổi contract chỉ chạm mapper; thay hạ tầng không chạm domain; ranh giới tenant tập trung ở `UnitOfWork`.
- Mất: thêm file mapper + port mỗi module; hai kiểu cấu trúc song song tới khi chuyển xong; P-d1 chậm hơn (người dùng chấp nhận); qc tốn thêm commit sửa đường dẫn mỗi lần dời.
- ADR-0001 "contract zod là nguồn chung" giữ nguyên nhưng **chỉ ở lớp 3–4**.
- Chuẩn chi tiết: `docs/CONVENTIONS.md` §2, §5, §9, §10. Lộ trình: CR-089, ROADMAP mốc "CA-processes".
