# Workflow — quy trình AI-SDLC của dự án

Mỗi mốc (milestone) chạy đúng một vòng dưới đây. Người dùng chỉ duyệt **một lần mỗi mốc** (Gate). Sau Gate, đội agent làm hết, không hỏi lại (xem Luật 2 trong `CLAUDE.md`).

## Đội agent (`.claude/agents/`)

| Agent | Sở hữu | Được sửa | Không được sửa |
|---|---|---|---|
| `docs-architect` | Cấu trúc repo & docs, INDEX, CODEMAP, TRACE, STATE, ROADMAP, tách BA thành spec | `docs/**` (trừ `docs/design/**` chỉ sửa khi được giao), `CLAUDE.md`, README module | Code, test |
| `intake-analyst` | Đối chiếu thông tin mới với spec/design (Luật 0), phân loại + ảnh hưởng + câu hỏi | — (chỉ đọc) | — |
| `spec-readiness` | Cửa READY / NOT READY | — (chỉ đọc) | — |
| `backend-lead` | Contract, DB, RLS, migration, hiệu năng server, ADR backend, code backend | `apps/*-api/**`, `packages/contracts/**`, `packages/db/**`, `docs/specs/*/plan.md` phần backend, `docs/adr/**` | `tests/acceptance/**`, `e2e/**`, `apps/*-web/**` |
| `frontend-lead` | Lấp chỗ trống UI/UX (trạng thái, câu chữ VI/EN, màn thiếu), hiệu năng web, ADR frontend, code frontend | `apps/*-web/**`, `packages/ui/**`, `packages/i18n/**`, phần frontend của `plan.md`, `docs/adr/**` | `packages/contracts/**` (đề xuất qua backend-lead), `tests/acceptance/**`, `e2e/**` |
| `qc` | Test plan theo FR/AC, acceptance + e2e, test luật BR, fixture/seed test, báo cáo độ phủ | `tests/**`, `e2e/**`, `docs/specs/*/test-plan.md`, `tests/.lock` | Code sản phẩm |
| `reviewer` | Review theo rubric (đúng spec, bảo mật, dữ liệu, hiệu năng, test, chuẩn, FE, truy vết) | — (chỉ đọc) | — |

### Chính sách model — chọn theo rủi ro nghiệp vụ

Model chọn theo **việc**, không theo agent. Dòng `model:` trong file agent là mặc định an toàn (agent làm chủ yếu việc rủi ro cao thì mặc định Opus). Điều phối đổi bằng tham số `model` khi gọi agent; tham số này thắng frontmatter. Không dùng biến `CLAUDE_CODE_SUBAGENT_MODEL` (ép mọi agent một model).

**Rủi ro cao** = task chạm ít nhất một thứ: RLS / cách ly tenant · phân quyền (grants, ma trận, kiểm tra quyền, role) · auth, secrets, 2FA, token · quota, chi phí, usage · audit / khôi phục · transaction nhiều bảng, khoá hàng, thứ tự khoá, NOTIFY · migration đổi/xoá dữ liệu có sẵn. Còn lại là **thường** (CRUD theo contract đã chốt, list/phân trang, seed, màn hình theo artboard, i18n, docs). Cột `Rủi ro` trong `tasks.md` do backend-lead điền ở PLAN; task chưa có cột → điều phối xét theo danh sách trên, phân vân thì coi là cao.

| Agent · việc | Model | Lý do nghiệp vụ |
|---|---|---|
| `spec-readiness` | Opus | Cửa chặn chính; bỏ sót ở đây sai dây chuyền |
| `intake-analyst` (Đầy đủ) | Opus | Bắt mâu thuẫn ngầm giữa yêu cầu mới và BA (mức Nhanh do điều phối tự làm) |
| `reviewer` | Opus | Lưới an toàn cuối cho bảo mật, tenant, đồng thời |
| `backend-lead` PLAN | Opus (mặc định) | Contract, schema, RLS, luật BR thành if/else — QC và FE dựa vào |
| `backend-lead` BUILD task **cao** | Opus (mặc định) | Lỗi nặng nhất từng gặp (deadlock M1, M2) thuộc nhóm này |
| `backend-lead` BUILD task **thường** | **Sonnet** — truyền `model: sonnet` | Code theo contract đã chốt |
| `qc` WRITE luật BR quyền/quota/tenant, phân xử Tranh chấp test | Opus — truyền `model: opus` | Test là định nghĩa "đúng"; test sai khoá luôn code sai |
| `qc` WRITE thường, LOCK, VERIFY | Sonnet (mặc định) | Theo spec + template, chạy lệnh |
| `frontend-lead` PLAN có màn mới / lấp chỗ trống UX lớn | Opus — truyền `model: opus` | Quyết định UX ảnh hưởng người dùng cuối |
| `frontend-lead` PLAN/BUILD thường | Sonnet (mặc định) | Lỗi FE lịch sử là chuẩn code, không phải nghiệp vụ |
| `docs-architect` Việc 1, 3 | Sonnet (mặc định) | Cần hiểu BA để nhóm FR |
| `docs-architect` Việc 2 (đồng bộ CODEMAP/TRACE/STATE) | Haiku — truyền `model: haiku` | Việc cơ học; câu chữ kém thì quay lại Sonnet |
| Phiên chính (điều phối) | Opus | Chỉ điều phối — không tự đọc/viết tài liệu lớn, giao agent |
**Nguyên tắc việc đơn giản → Sonnet / Haiku (người dùng 2026-10-18):** Opus chỉ cho việc **rủi ro cao** (danh sách trên) hoặc cần phán đoán khó (readiness đầy đủ, review bảo mật, PLAN). Mọi việc khác giao model nhanh hơn:
| Việc | Model |
|---|---|
| Cơ học, không cần hiểu nghiệp vụ: chạy lại script/test và báo số, `test:lock:write`/`verify`, sửa đường dẫn import sau khi dời file, đổi tên, format/lint, kiểm trần kích thước, đếm/grep, cập nhật STATE/CODEMAP/TRACE, tick `tasks.md`, dọn DB/tag | **Haiku** — `model: haiku` |
| Đơn giản nhưng cần hiểu code: dời file không đổi hành vi có test khoá phủ, qc sửa test theo bảng đã chốt, CRUD/FE theo contract, docs theo mặc định đã chốt, readiness chỉ diff nhỏ, sửa lỗi Thấp/Trung không chạm tenant/khoá | **Sonnet** — `model: sonnet` |
| Rủi ro cao (tenant/RLS, quyền, auth/secret, khoá/transaction, quota/audit, migration đổi dữ liệu) hoặc phán đoán khó | Opus |
Haiku làm hỏng (sai, thiếu, câu chữ kém) ⇒ giao lại Sonnet, không giao lại Haiku. Brief cho Haiku/Sonnet phải trích sẵn đủ thông tin (bảng việc, đường dẫn, lệnh) — không bảo tự đọc spec/plan.

### Kỷ luật token (bắt buộc cho điều phối và mọi agent)

Chi phí chủ yếu do context dài bị đọc lại mỗi lượt (M0–M3: ~69% chi phí; có lần chạy 347 lượt, context 775K). Vì vậy:

1. **Một lần gọi agent = một task** (hoặc nhóm task nhỏ cùng file, ≤ ~80 lượt). Xong → agent trả **Bàn giao ≤ 20 dòng** (đã làm, file, lệnh + kết quả, việc dở, bẫy). Task kế → gọi agent **mới** kèm bàn giao, **không** dùng `SendMessage` để giao việc mới cho agent đã chạy lâu. `SendMessage` chỉ để trả lời câu hỏi của agent đang làm dở.
2. Agent thấy context lớn (≳ 150K) hoặc đã ~80 lượt → dừng ở điểm sạch (đã commit), trả bàn giao.
3. **Đọc tài liệu theo mục**: `grep -n "^#" <file>` để tìm mục, rồi đọc đúng khoảng dòng (≤ ~80 dòng/lần). Không đọc cả file spec/plan/test-plan > 20KB; không `cat` nhiều file một lệnh; không đọc lại file đã đọc trong cùng lần chạy. Output bị lưu ra file (quá dài) → `grep`/`tail` file đó, không Read cả file. Ngoại lệ: `spec-readiness` vẫn đọc hết thư mục spec (luật strict của nó), nhưng tài liệu được trỏ thì chỉ đọc đúng mục.
4. **Lệnh ít output**: test chỉ in lỗi + tổng (`bun test … 2>&1 | tail -40`, `bunx playwright test --reporter=line … | tail -40`, typecheck/biome/depcruise `| tail -30`). Chỉ xem đầy đủ khi cần sửa một ca đỏ cụ thể.
5. **Tài liệu mốc gọn theo NỘI DUNG, giữ chất lượng và tính đúng (người dùng 2026-10-18, áp dụng từ P-d2):** `spec.md` ≤ 12 KB · `plan.md` ≤ 18 KB · `plan-frontend.md` ≤ 15 KB · `test-plan.md` ≤ 18 KB, dạng bảng. **Bắt buộc có** (thiếu = readiness Chặn/Cao như cũ, không vì trần mà bỏ): bảng phạm vi làm/không làm · contract (trường, kiểu, mã lỗi + HTTP) · DDL/index/RLS/FK · thứ tự khoá + transaction · **Thiết kế hiệu năng** (ngưỡng, số câu SQL/lô, index, khoá — mục K) · bảng AC/test (mã ca · dữ liệu · kỳ vọng) · quyết định. **Không viết**: văn xuôi diễn giải lại, chép BA/contract (trỏ mục), cùng một quyết định ở nhiều nơi (quyết định chỉ ở `spec-decisions.md`, nơi khác trỏ mã D-xx), phụ lục viết đè (`*-addendum.md`) — sửa thẳng file gốc; vượt trần vì nội dung bắt buộc thì tách phụ lục **theo chủ đề** (vd `plan-db.md`), không phải phụ lục sửa đổi. **Readiness tối đa 2 vòng**: vòng 1 đủ, vòng 2 chỉ diff; mục Chặn/Cao vẫn PHẢI đóng (có mặc định thì docs-architect áp ngay trong cùng lượt, không mở vòng mới; còn câu hỏi thật thì hỏi người dùng một lượt). Mốc cũ (P-d1) giữ trần cũ 25/30/25/30 KB. Kiểm `wc -c` trước khi trình readiness (1 KB = 1024 byte).
6. **Cột `Đọc` trong `tasks.md`**: mỗi task ghi đúng các mục cần đọc (vd `plan §5.2`, `spec §3 GroupDto`, `test-plan §4 hàng R07–R10`). Agent BUILD chỉ đọc các mục đó + bàn giao; điều phối truyền bàn giao, không bảo agent "đọc spec".
7. Phiên chính: hết mỗi mốc (hoặc sau Gate / sau BUILD) → `/handoff` rồi `/clear`; đầu phiên mới hook tự chèn `STATE.md`.
8. **Điều phối nhanh (người dùng 2026-10-18):**
   - **Không chạy bộ test đầy đủ khi có agent đang BUILD** — lượt đầy đủ (`test:int:par` toàn bộ, `test:all`) chỉ khi đóng task/lát/mốc, một lượt, máy rảnh. Trong lúc build chỉ chạy test của phần đang sửa.
   - **Brief trích sẵn**: điều phối dán vào lời giao việc đúng đoạn cần (chữ ký hàm, bảng file đích, hàng test-plan, quyết định liên quan) thay vì bảo agent tự đọc cả spec/plan; agent chỉ mở thêm file code cần sửa.
   - **Model theo rủi ro, thiên về nhanh**: task thường (FE, docs, dời file không đổi hành vi có test khoá phủ, qc sửa đường dẫn/khoá, readiness chỉ diff) dùng `model: sonnet`; Opus chỉ cho task chạm cách ly tenant/RLS, khoá/transaction, quyền, auth/secret.
   - **Brief phải chặn việc vô ích ngay từ đầu (nguyên tắc sống còn, người dùng 2026-10-18)** — mọi lời giao việc có đủ 6 mục, thiếu mục nào điều phối không được gửi:
     1. **Phạm vi**: làm gì / KHÔNG làm gì (task sau làm gì thì nêu tên để agent không lấn sang).
     2. **Xong khi**: lệnh kiểm cụ thể, mỗi lệnh chạy một lần; không chạy lại cả bộ.
     3. **Được phép đỏ**: danh sách ca/file sẽ còn đỏ vì phụ thuộc task sau (vd "cần vòng hẹn giờ T8"), ca chập chờn đã biết (TECH-DEBT #192…) — agent liệt kê, KHÔNG đuổi theo.
     4. **Điểm dừng**: test đỏ không do code mình sửa (đỏ sẵn/chập chờn/môi trường) ⇒ chạy lại riêng **một** lần, vẫn vậy thì ghi vào báo cáo và đi tiếp; vướng quá 2 lần thử cùng một lỗi ⇒ dừng, commit phần đúng, báo "Blocked" kèm lỗi.
     5. **Giới hạn thời gian** theo cỡ việc (Haiku ≤ 5 phút, Sonnet ≤ 15 phút, Opus ≤ 30 phút); hết giờ ⇒ commit phần đúng + báo việc dở.
     6. **Báo cáo**: khuôn ngắn (≤ 20 dòng): file, test trước → sau, ca còn đỏ + lý do, quyết định, tranh chấp.
     Task lớn (nhiều lớp, nhiều luồng) ⇒ điều phối **chia trước** theo model: luật thuần có test khoá (Sonnet) ∥ phần khoá/transaction/tenant (Opus) ∥ việc cơ học (Haiku), không giao một agent Opus ôm cả.
   - **Song song khi file không giao nhau**; mỗi agent stage đúng file của mình theo đường dẫn; `tests/.lock` ghi lại ở commit cuối của đợt.

### Đo token mỗi mốc

Cuối mốc điều phối chạy và chép bảng tóm tắt vào `docs/STATE.md` mục "Token":
`python "%USERPROFILE%\.claude\scripts\token-report.py" D:\AI\ai-system --since <ngày bắt đầu mốc> --runs 15`
Kèm **một dòng chỉ số chất lượng** mỗi mốc trong `STATE.md` mục "Token": `$ tổng · $/task · lần readiness · tranh chấp test (test sai / code sai) · review Blocker/Major vòng 1 / vòng 2 · commit sửa lại` — để so mốc sau với mốc trước.
Mục tiêu: chi phí đọc lại cache < 40% · không lần chạy agent nào context > 200K hoặc > 80 lượt. Trong phiên: `/usage` (token, chi phí, cache), `/context` (cái gì chiếm context).

Phiên chính (Claude) là **điều phối**: gọi agent theo thứ tự, gom kết quả, giữ `tasks.md` và `docs/STATE.md`, trình Gate cho người dùng.

## Thông tin mới giữa chừng

Mọi yêu cầu/thay đổi mới (đầu phiên hay giữa phiên) đi qua **Intake** trước (Luật 0 trong `CLAUDE.md`, skill `/intake`): hỏi người dùng → intake-analyst → người dùng chốt → docs-architect cập nhật + `CHANGE-REQUESTS.md` → spec-readiness. Spec đã qua Gate bị ảnh hưởng → Gate lại.

## Hai làn (CLAUDE.md Luật 1b, người dùng 2026-10-19)

Vòng dưới đây là **làn đầy đủ** — chỉ cho RLS/tenant, quyền, auth/secrets, tiền, migration dữ liệu khách thật, đường nóng có ngưỡng perf. **Làn nhanh** (màn hình, mapper, báo cáo, rủi ro thường):
```
1. một agent (frontend-lead/backend-lead, Sonnet)  plan ngắn trong tasks.md + code + test cùng task (Luật 4b, 4c)
2. reviewer (Sonnet)                               một vòng; Blocker/Major ⇒ cùng agent sửa, reviewer chỉ đọc diff sửa
3. qc (Haiku)                                      ghi tests/.lock nếu có test mới dưới tests/** hoặc e2e/**
```
Lát lẫn hai loại ⇒ tách. Phân vân ⇒ làn đầy đủ. Cổng đóng (`done:*`, `test:all`) vẫn chạy cho cả hai làn.

**Từ đợt 2 CR-094 (2026-10-19): một agent làm trọn một lát.**
```
1. một agent (Opus nếu lát rủi ro cao, Sonnet nếu thường)
   spec + plan ngắn → [rủi ro cao: test tenant/quyền/tiền/migration viết TRƯỚC code phần đó] → BE + FE + test → tự chạy cổng lát
2. [rủi ro cao] spec-readiness tối đa 1 vòng trước khi code (Cao có mặc định ⇒ áp luôn, không vòng 2)
3. reviewer một vòng (+ security review nếu rủi ro cao); Blocker/Major ⇒ cùng agent sửa, reviewer chỉ đọc diff sửa
4. qc (Haiku) ghi tests/.lock khi có test mới dưới tests/** hoặc e2e/**
```
Nhiều lát song song: mỗi agent commit qua `GIT_INDEX_FILE` tạm chỉ chứa file của mình, không `git reset`/`git stash` index chung, không `bun install` ở worktree khác.

**Cổng lát và cổng đợt (TS1, 2026-10-19).** Cổng LÁT = `bun run test:affected [--base=<commit trước lát>]`: đồ thị import (`lib/import-graph.ts`) → bao đóng ngược của file đổi so với `base` (mặc định merge-base với `main`, hoặc chỉ thay đổi chưa commit khi đang ở `main`) → chỉ chạy unit, int (`test:int:par`) và cấu hình e2e dính tới diff, cùng `check` + `lock` + `typecheck` (turbo `...[base]`); `--dry-run` chỉ in kế hoạch, `--e2e=wide` thêm mọi cấu hình nối tới mã backend đổi. Cổng ĐỢT = `bun run test:all` (mọi bước; int/e2e chạy song song, DB/Redis/cổng riêng mỗi việc): chạy khi đóng mốc/đợt, không thay bằng `test:affected`. Cấu hình e2e mới đặt dưới `e2e/**/playwright*.config.ts` và khai DB/Redis trong `META` của `test-e2e-par.rules.ts` (không khai ⇒ nhận DB riêng, không Redis).

## Vòng một mốc

```
1. docs-architect   tách BA/UI thành docs/specs/<ID>/ (spec.md từ template) cho mốc
2. song song:
   backend-lead     contract (zod) + DB + ngân sách hiệu năng + ADR nếu cần    → plan.md (BE)
   frontend-lead    lấp chỗ trống UI, câu chữ, role/nhãn cho e2e + ADR nếu cần   → plan.md (FE)
3. qc               test-plan.md (mọi task) + viết test TRƯỚC code chỉ cho task rủi ro cao (đỏ là đúng; xem "Test trước theo rủi ro")
4. spec-readiness   READY? — không: điều phối gom câu hỏi hỏi người dùng MỘT lượt, quay lại 1–3
5. ★ GATE           người dùng duyệt gói: spec · contract · UI · ADR · test-plan · tasks
6. qc               ghi tests/.lock (checksum test đã duyệt)
7. song song, mỗi agent một git worktree:
   backend-lead ∥ frontend-lead   task cao: code tới khi test của QC xanh + unit test của mình
                                  task thường: code + test (unit/int/e2e theo Luật 4b) cùng task → qc đọc nhanh diff test, ghi lock
   (mốc lớn / nhiều session: Bước 0 + nhánh theo feature, xem "Làm song song nhiều session")
8. qc               chạy toàn bộ, báo độ phủ theo FR; test sai → mục Tranh chấp
9. reviewer         review; Blocker/Major → trả agent code sửa (tối đa 2 vòng/task)
10. docs-architect  cập nhật CODEMAP, TRACE, STATE, README module → báo cáo cuối cho người dùng
11. điều phối       đo token (mục "Đo token mỗi mốc") → ghi STATE.md → /handoff, /clear
```
Bước 4 lần 2 trở đi: spec-readiness chỉ kiểm **phần đã đổi** (`git diff` thư mục spec từ lần trước) + lỗ hổng còn mở trong `readiness.md`, không đọc lại toàn bộ.
Bước 9 sửa review: commit sửa phải chạy lại `lock-order`/`concurrency` int test (nếu chạm khoá/transaction), `check:fn` và `depcruise --all` cho file đổi; reviewer vòng 2 chỉ đọc diff của các commit sửa + mục lỗi vòng 1.
Bước 7–9: mỗi task một lần gọi agent, model theo cột `Rủi ro` (mục "Chính sách model").
**Kiểm lớp (ADR-0023, CR-088/089):** mỗi task BE/FE có file trong `domain/`/`application/` chạy `bun run depcruise` cho file đổi (luật `ca-*`); task Python chạy `uv run lint-imports && uv run python scripts/check_layers.py`. Reviewer kiểm thêm: lớp 1–2 không có giá trị không tất định ngoài port `Clock`/`IdGen`, mapper có test khớp kiểu, file cũ chỉ tách phần chạm tới (`CONVENTIONS.md` §10). **Module mẫu Clean Architecture** (`hub-api/processes`, CR-090): port `UnitOfWork` (tx/RLS/scope `system`) phải qua **security review** riêng trước khi module khác dùng làm khuôn — hard stop cách ly tenant.

**Hiệu năng ở mọi cổng (Luật 4c, người dùng 2026-10-18):** bước 2 plan BE có mục "Thiết kế hiệu năng" (số câu SQL/lô, index, khoá, kế hoạch không phụ thuộc thống kê, ngưỡng); bước 3 qc viết `*.perf.int.test.ts` + test đếm câu SQL cho đường nóng, test trước code phải **fail ngay** (điều kiện tiền đề), không chờ timeout; bước 4 spec-readiness coi thiếu mục K hiệu năng là **Cao** (chưa READY); bước 7 task chạm code cũ ở đường nóng đo trước rồi sửa, báo số trước → sau; bước 9 reviewer chặn truy vấn từng hàng / sleep / poll (Blocker) và thiếu số đo perf (Major). Khi làm chỉ chạy test liên quan; int nhiều file dùng `bun run test:int:par`; bộ đầy đủ khi đóng task/mốc.

## Làm song song nhiều session (CR-059)

Một session làm một mốc → giữ cách cũ: commit thẳng `main` (Luật 5). Mốc lớn chia cho **nhiều session** (vd P-a) → làm theo mục này. Mục tiêu: `main` luôn xanh, mỗi session sửa phần riêng, merge đúng mà không cần nhớ lịch sử chat.

**Vai:** session chính = **điều phối + tích hợp** (giữ bảng task, merge, sửa `STATE.md`/`CHANGE-REQUESTS.md`); tối đa **3 session làm việc**. Nhiều hơn tốn token phối hợp hơn thời gian tiết kiệm.

### 1. Chia việc
- **Bước 0 — khung chung (một session; nhánh `feat/<mốc>-step0` hoặc thẳng `main`; merge vào `main` trước khi tạo nhánh feature):** giữ mỏng (kiểu, bảng, stub, cờ — không logic nghiệp vụ); có thể tách 0a contract + mock (FE bắt đầu ngay) / 0b DB + khung. Gồm: contract (zod) + mã lỗi + mock/fixture · bảng DB + migration + RLS · khung module theo feature (file/thư mục riêng cho từng feature) · mục nav, route rỗng · file i18n riêng theo feature (`<feature>` namespace, không dồn vào file chung) · cờ bật/tắt feature · sửa sẵn các **điểm nóng dùng chung** (vd hàm lõi nhiều feature cùng gọi). Sau Bước 0: đổi contract/DB chỉ qua backend-lead (như cũ), báo session chính.
- **Ranh giới dữ liệu:** bảng/cột/API/event mà ≥ 2 feature dùng → Bước 0 (kể cả cột chỉ một feature dùng nhưng nằm trên bảng chung). Bảng/cột/index chỉ một feature dùng → feature tự thêm trong nhánh, **chỉ thêm** (bảng mới, cột null/default). Đổi tên/kiểu/xoá cột dùng chung → qua backend-lead, báo các session rebase.
- **Feature = lát dọc** (vd PF1 "chạy + cổng kiểm"), có nhóm AC + test riêng. Một session làm trọn một feature qua các app, **chỉ sửa file của feature mình** (cột `File` trong `tasks.md`). Task cần sửa file của feature khác / file Bước 0 → dừng, báo session chính (chưa tách đủ).
- `tasks.md` có cột **Feature/nhánh**; session ghi tiến độ vào `tasks.md` của feature, không sửa `STATE.md`.

### 2. Nhánh và worktree
- Mỗi session **một git worktree + một nhánh** `feat/<mốc>-<feature>` (vd `feat/pa-pf2-ask`), tạo từ `main` sau Bước 0: `git worktree add ../ai-system-pf2 -b feat/pa-pf2-ask`. Không dùng chung thư mục, không đổi nhánh qua lại trong một thư mục.
- **Nhánh sống ngắn** (một feature, vài ngày). Mỗi lần `main` có merge mới → các nhánh đang mở **rebase ngay**.
- Feature chưa xong vẫn được merge sớm nếu nằm sau **cờ bật/tắt** (mặc định tắt).
- Bật cho mọi worktree: `git config merge.conflictStyle zdiff3` (git ≥ 2.35; máy này git 2.34 → `diff3`) và `git config rerere.enabled true`.

### 3. Cổng merge vào `main` (session chính, lần lượt từng nhánh)
1. Chủ nhánh **rebase lên `main` mới nhất** và tự gỡ conflict.
2. Chạy **toàn bộ** (không chỉ test của feature): `bun run test:all` (= `check` · `typecheck` · `bun test` · `test:int` · `test:lock:verify` · pytest agent-runtime · mọi cấu hình e2e dưới `e2e/**`; CR-092). Kết quả phải là của **bản đã ghép** (`main` + nhánh). Nhánh có thay đổi code mà không kèm test (unit + int; e2e nếu chạm UI/luồng người dùng) → không merge (CLAUDE.md Luật 4b).
3. `reviewer` đọc diff của nhánh, đối chiếu spec.
4. Xanh → merge (`--no-ff`, commit merge ghi feature + mã yêu cầu) → báo các session khác rebase. Một lần chỉ merge một nhánh.
5. Lỡ làm `main` đỏ → **revert ngay commit merge** đó, nhánh sửa rồi xin merge lại. Không để `main` đỏ chờ sửa.
- Đủ nhánh của một feature → qc / qc-uat chạy e2e feature trên `main` (tích hợp theo feature), ghi kết quả vào `tasks.md`.

### 4. Gỡ conflict
- **Ai viết nhánh thì người đó gỡ** (biết ý đồ). Người tích hợp không đoán; gặp conflict lớn → trả lại chủ nhánh.
- Hiểu ý bên kia qua: commit có mã `[FR]` → spec · `tasks.md` + ghi chú bàn giao của nhánh đã merge · khối `zdiff3`/`diff3` (bản gốc / main / mình). Vẫn không chắc → hỏi session viết nhánh kia (SendMessage).
- Theo loại file: file sinh tự động (`routeTree.gen.ts`…) → không gỡ tay, sinh lại · lockfile → lấy bản `main` rồi `bun install` · migration trùng số → đánh lại số nhánh mình / sinh lại · i18n, danh sách đăng ký (nav, route, export) → giữ cả hai · **logic thật** → ghép giữ ý cả hai, rồi test cả hai feature phải xanh.
- **Conflict ngữ nghĩa** (git không báo, ghép xong test feature trước đỏ): nhánh đến sau sửa. Code sai → sửa code. Hai spec loại trừ nhau / test quá chặt → **Tranh chấp test** (không tự sửa test của feature khác), qc + người dùng quyết, sửa spec (có thể CR) trước.
- Không format/đổi tên hàng loạt trong nhánh feature — làm nhánh riêng, merge riêng.

### 5. Ghi chú bàn giao khi xin merge (cuối `tasks.md` của feature)
Nhánh · task đã xong · file đã sửa ngoài cột `File` (nếu có, kèm lý do) · giả định về contract · "Quyết định trong lúc làm" · việc còn lại · lệnh test đã chạy + kết quả.

## Luật khoá test

- **Test trước theo rủi ro (người dùng 2026-10-18):** cột `Rủi ro` của `tasks.md` quyết. **Cao** = RLS/tenant, quyền, auth/secrets, khoá/transaction/NOTIFY, đường nóng có ngưỡng perf, contract ⇒ qc viết test trước code, khoá ở Gate. **Thường** (UI, mapper, nhãn/i18n, sửa nhỏ, tách file) ⇒ agent code viết test cùng task vào file test **mới** (không sửa file đã khoá; cần sửa ⇒ Tranh chấp test), qc (Haiku/Sonnet) đọc nhanh diff test — kiểm bám spec/AC, không test theo lỗi của code, đỏ được khi bỏ code — rồi `test:lock:write`. Lý do giữ test trước ở task cao: người viết code tự viết test dễ khớp luôn lỗi của mình.
- **Trước khi khoá — "đỏ đúng lý do"** (M3: 8 tranh chấp, 7 là test sai, chủ yếu lỗi dựng dữ liệu): qc chạy mọi file test mới trên code hiện tại (DB test riêng của qc). Mỗi ca đỏ phải đỏ ở `expect`/404/route chưa có — **không** được đỏ ở phần dựng dữ liệu (`PostgresError`, `TypeError` trong fixture/`beforeAll`, seed). Ca dựng dữ liệu lỗi → sửa trước khi `test:lock:write`. Ghi kết quả (số ca đỏ đúng lý do / tổng) vào `test-plan.md`.
- Sau Gate, `tests/acceptance/**` và `e2e/**` bị khoá bằng `tests/.lock` (sha256 từng file). Chỉ `qc` được cập nhật lock.
- `bun run test:lock:verify` chạy trong CI và trước khi báo xong; checksum lệch → đỏ.
- backend-lead / frontend-lead **không bao giờ** sửa, xoá, `skip` test bị khoá để cho xanh.
- **Dời file khi chuyển bốn lớp (CR-089):** task dời file mà test khoá trỏ tới ⇒ `qc` sửa đường dẫn `tryLoad`/import + cập nhật lock **cùng task** (một commit qc mỗi lần dời); không shim re-export. Helper `tryLoad` phải báo rõ khi module vắng, không trả `{}` lặng lẽ (`CONVENTIONS.md` §10).

## Tranh chấp test

Agent code tin một test sai → **không sửa test**, ghi vào mục "Tranh chấp test" của `spec.md`: test nào, vì sao sai, trích BA. `qc` quyết dựa trên BA:
- Test sai → qc sửa test + lock, ghi lý do.
- Test đúng → agent code sửa code.
- BA mơ hồ → hard stop, gom vào báo cáo cuối.

## Gói duyệt (Gate)

Một file `docs/specs/<milestone>-gate.md` do điều phối tạo, gồm: danh sách spec + link · contract thay đổi · UI mới / artboard mới · ADR mới (Proposed) · test-plan tóm tắt (số test theo FR) · rủi ro · câu hỏi đã được trả lời. Người dùng trả lời "duyệt" hoặc sửa từng dòng. **Tự duyệt** (Luật 2b `CLAUDE.md`) khi READY và không còn câu hỏi mới / ADR thư viện mới / hard stop — vẫn ghi file gate để truy vết. Duyệt xong: ADR chuyển Accepted, spec chuyển `approved`.

## Đề xuất công nghệ

- Stack nền đã chốt trong `docs/adr/0001-stack.md`. Agent chỉ đề xuất khi cần thêm thư viện hoặc đổi cách làm.
- Mỗi đề xuất = 1 ADR (`docs/adr/NNNN-<slug>.md`, trạng thái Proposed) có: bối cảnh, lựa chọn so sánh, số đo hiệu năng/chi phí liên quan, quyết định đề xuất. Duyệt cùng Gate, không hỏi riêng.
- "Tối ưu" phải là con số trong spec (ngân sách mặc định: `CONVENTIONS.md` §6).
