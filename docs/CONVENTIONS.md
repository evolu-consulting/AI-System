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
