# AI System — luật làm việc cho Claude

Nền tảng AI multi-tenant: **Admin** (tenant, user, group, quyền, command, catalog workflow, quota), **Agent Hub** (điều phối agent, Studio), **Worker** (job, CLI subscription), **Chat App / Extension**. Chưa có code; thiết kế v0.4 đã xong.

## Bắt đầu mỗi phiên
1. Đọc `docs/STATE.md` (đang làm gì, việc kế tiếp).
2. Cần tìm gì → `docs/INDEX.md`, rồi mở **đúng một** thứ. Không đọc cả `docs/design/`.
3. Chuẩn code: `docs/CONVENTIONS.md`. Quy trình và đội agent: `docs/WORKFLOW.md`.

## Stack (chi tiết: `docs/adr/0001-stack.md`)
TypeScript strict · Bun + Turborepo · Rsbuild + React + Tailwind + shadcn/ui · Hono · Postgres + Drizzle (RLS) · zod · Redis · Biome · bun test + Playwright · Docker Compose.

## Lệnh (có sau M0)
`bun install` · `bun run dev` · `bun run typecheck` · `bun test` · `bun run test:int` (cần DB) · `bun run test:perf` (đo p95, không thuộc Lệnh xong) · `bun run e2e` (= `bunx playwright test`) · `bun run check:bundle` · `bun run keys:dev` · `bun run db:migrate` · `bun run mocks` · `bunx biome check --write --changed` · `bun run check:size` · `bun run trace <FR>` · `bun run test:lock:verify` · `docker compose up -d`

**Lệnh xong M0** (T17, máy sạch): `bun install --frozen-lockfile && docker compose up -d --wait && bun run db:migrate && bun run check && bun run typecheck && bun test && bun tests/acceptance/ADM-NFR-06/ac07.check.ts && bun run test:int && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check`

## Luật 0 — Intake: thông tin mới phải đối chiếu với spec (hỏi trước khi chạy)
Khi người dùng đưa **yêu cầu / thay đổi / ghi chú / file** (đầu phiên hay giữa phiên):
1. Không phải yêu cầu (câu hỏi, trò chuyện, xác nhận ngắn) → không làm gì.
2. Người dùng đang gửi nhiều phần ("còn nữa", "gửi tiếp") → chờ tới "xong".
3. **Hỏi một câu**: chạy Intake **Nhanh** (1–3 ý, tự đối chiếu trong phiên) / **Đầy đủ** (agent `intake-analyst`) / **Bỏ qua**. Không tự chạy. Đã Bỏ qua cho chủ đề đó thì không hỏi lại tới khi có dữ liệu mới.
4. Chạy theo skill `/intake`. Kết quả chốt → `docs-architect` cập nhật BA/spec + `docs/CHANGE-REQUESTS.md` (`CR-xxx`) → Luật 1 cho spec bị ảnh hưởng. Spec đã qua Gate → Gate lại.
Người dùng gõ `/intake` thì chạy luôn (đã là xác nhận).

## Luật 1 — Cửa sẵn sàng (BẮT BUỘC; hỏi người dùng xác nhận trước khi chạy)
Trước khi viết code cho một feature hoặc thay đổi không tầm thường — kể cả khi người dùng chỉ nói "implement", "code", "làm", "build", "tiếp tục", "chạy task":
1. Xác định spec (`docs/specs/<ID>/`; chưa có spec thì mục BA/UI tương ứng trong `docs/design/`).
2. Chạy agent **spec-readiness**. Người dùng đã bảo làm (implement/code/làm tiếp/run…) = đã xác nhận, **không hỏi lại**; chỉ hỏi khi không rõ người dùng có muốn code hay không. Agent chưa hiện trong danh sách → dùng subagent general-purpose đọc nguyên văn `.claude/agents/spec-readiness.md` và đóng đúng vai. (Áp dụng cách này cho mọi agent trong `.claude/agents/`.)
3. **READY** → theo `docs/WORKFLOW.md`. **NOT READY** → không code; gom lỗ hổng Chặn/Cao kèm mặc định đề xuất, hỏi người dùng **một lượt**; ghi câu trả lời vào spec rồi chạy lại.
4. Spec/design/tasks đổi sau lần READY gần nhất → chạy lại. Ghi mỗi lần chạy vào `docs/specs/<ID>/readiness.md`.

Bỏ qua Luật 1 chỉ khi: sửa chính tả/câu chữ, cấu hình nhỏ, hoặc người dùng nói rõ "bỏ qua kiểm tra".

## Luật 2 — Sau Gate thì tự làm hết, không hỏi lại
Gặp chỗ mơ hồ, tra theo thứ tự và dừng ở nguồn đầu tiên có câu trả lời:
spec → BA/UI (`docs/design/`) → ADR → `CONVENTIONS.md` → code hiện có (bắt chước) → phương án đơn giản nhất, dễ đổi nhất.
Mỗi lần tự quyết: một dòng trong mục "Quyết định trong lúc làm" của spec.

**Hard stop** (task `blocked`, làm tiếp task khác, gom vào báo cáo cuối): ảnh hưởng bảo mật / cách ly tenant · có thể mất dữ liệu · phải đổi contract hoặc phạm vi đã duyệt · cần dịch vụ trả tiền, secret thật, push, deploy.

## Luật 2b — Đủ context thì chạy, không hỏi xác nhận
- Không hỏi "bắt đầu mốc tiếp không?", "chạy bước X không?", "tiếp tục không?". Xong một mốc → chạy luôn vòng của mốc kế (ROADMAP) trên nhánh hiện tại.
- **Tự duyệt Gate** khi spec-readiness READY và mọi lỗ hổng Chặn/Cao đều đã có câu trả lời trong spec/BA/readiness đã được người dùng chấp nhận; ghi `docs/specs/<mốc>-gate.md` với dòng "Tự duyệt theo Luật 2b". Chỉ trình Gate cho người dùng khi còn câu hỏi **mới** chưa có mặc định được chấp nhận, khi có ADR thêm thư viện/dịch vụ mới, hoặc khi có hard stop (Luật 2).
- Vẫn hỏi: Intake (Luật 0, tránh chạy khi chỉ trò chuyện), hard stop, merge vào `main`, push, deploy.

## Luật 3 — Đội agent và phân quyền (chi tiết: `docs/WORKFLOW.md`)
- Phiên chính = điều phối: gọi agent đúng thứ tự, gom kết quả, giữ `tasks.md` + `docs/STATE.md`, trình Gate **một lần mỗi mốc**.
- `backend-lead` sở hữu contract; `frontend-lead` không tự đổi contract; `qc` viết test **trước** code; `reviewer` và `spec-readiness` chỉ đọc; `docs-architect` giữ docs.
- **Model theo rủi ro nghiệp vụ, kỷ luật token** (`docs/WORKFLOW.md` "Chính sách model", "Kỷ luật token"): mỗi lần gọi agent = một task, task kế gọi agent mới kèm bàn giao (không `SendMessage` giao việc mới); task rủi ro **cao** (RLS/tenant, quyền, auth/secrets/2FA, quota, audit, khoá/transaction/NOTIFY) dùng Opus, task thường truyền `model: sonnet`. Hết mốc: đo token → `/handoff` → `/clear`.
- **Khoá test:** sau Gate, `tests/acceptance/**` và `e2e/**` chỉ `qc` được sửa (`tests/.lock`). Agent code tin test sai → ghi "Tranh chấp test", không sửa test.

## Luật 4 — Chuẩn và phạm vi sửa
- Theo `docs/CONVENTIONS.md`: feature-first, file ≤ 400 dòng, hàm ≤ 50 dòng, component ≤ 200 dòng.
- Format/lint **chỉ file thay đổi**. Không refactor ngoài phạm vi task; thấy nợ → `docs/TECH-DEBT.md`.

## Luật 5 — Truy vết
- Mã yêu cầu (`ADM-FR-xx`, `HUB-FR-xx`, `WRK-FR-xx`, AC) có trong: frontmatter spec, comment đầu module, tên test, commit `[ADM-FR-xx]`.
- Xong task: tick `tasks.md`, cập nhật `docs/STATE.md`. Đổi cấu trúc → `docs-architect` cập nhật CODEMAP/TRACE.
- Làm và commit trực tiếp trên `main` (người dùng yêu cầu 2026-10-01). Không push trừ khi được yêu cầu.
