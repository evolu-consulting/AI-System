# AI System — luật làm việc cho Claude

Nền tảng AI multi-tenant: **Admin** (tenant, user, group, quyền, command, catalog workflow, quota), **Agent Hub** (điều phối agent, Studio), **Worker** (job, CLI subscription), **Chat App / Extension**. Chưa có code; thiết kế v0.4 đã xong.

## Bắt đầu mỗi phiên
1. Đọc `docs/STATE.md` (đang làm gì, việc kế tiếp).
2. Cần tìm gì → `docs/INDEX.md`, rồi mở **đúng một** thứ. Không đọc cả `docs/design/`.
3. Chuẩn code: `docs/CONVENTIONS.md`. Quy trình và đội agent: `docs/WORKFLOW.md`.

## Stack (chi tiết: `docs/adr/0001-stack.md`)
TypeScript strict · Bun + Turborepo · Rsbuild + React + Tailwind + shadcn/ui · Hono · Postgres + Drizzle (RLS) · zod · Redis · Biome · bun test + Playwright · Docker Compose.

## Lệnh (có sau M0)
`bun install` · `bun run dev` · `bun run typecheck` · `bun test` · `bun run test:int` (cần DB) · `bun run test:int:par [--workers=N] [đường dẫn…]` (int song song, DB riêng mỗi worker, DB test clone từ mẫu — dùng mặc định khi chạy ≥ 2 file int) · `bun run test:perf` (đo p95, không thuộc Lệnh xong) · `bun run e2e` (= `bunx playwright test`) · `bun run check:bundle` · `bun run keys:dev` · `bun run db:migrate` · `bun run mocks` · `bunx biome check --write --changed` · `bun run check:size` · `bun run trace <FR>` · `bun run test:lock:verify` · `docker compose up -d`

**Lệnh xong M0** (T17, máy sạch): `bun install --frozen-lockfile && docker compose up -d --wait && bun run db:migrate && bun run check && bun run typecheck && bun test && bun tests/acceptance/ADM-NFR-06/ac07.check.ts && bun run test:int && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check`

## Luật 0 — Intake: thông tin mới phải đối chiếu với spec (hỏi trước khi chạy)
Khi người dùng đưa **yêu cầu / thay đổi / ghi chú / file** (đầu phiên hay giữa phiên):
1. Không phải yêu cầu (câu hỏi, trò chuyện, xác nhận ngắn) → không làm gì.
2. Người dùng đang gửi nhiều phần ("còn nữa", "gửi tiếp") → chờ tới "xong".
3. **Hỏi một câu**: chạy Intake **Nhanh** (1–3 ý, tự đối chiếu trong phiên) / **Đầy đủ** (agent `intake-analyst`) / **Bỏ qua**. Không tự chạy. Đã Bỏ qua cho chủ đề đó thì không hỏi lại tới khi có dữ liệu mới.
4. Chạy theo skill `/intake`. Kết quả chốt → `docs-architect` cập nhật BA/spec + `docs/CHANGE-REQUESTS.md` (`CR-xxx`) → Luật 1 cho spec bị ảnh hưởng. Spec đã qua Gate → Gate lại.
Người dùng gõ `/intake` thì chạy luôn (đã là xác nhận).

## Luật 0b — Chế độ nhanh (người dùng chốt 2026-10-19, CR-095) — THẮNG Luật 1, 1b, 2b, 3, 4b khi mâu thuẫn
- **Lát nhỏ** (≤ ½ ngày), **một agent làm trọn** trên **worktree/nhánh riêng** của lát; merge tuần tự vào `platform/gd0`. Không readiness, không Gate, không qc viết trước, không review từng lát.
- **Giấy tờ:** chỉ `docs/specs/<lát>/tasks.md` (plan ngắn + quyết định + việc còn lại). Không spec/plan/readiness/review/ket-luan/gate riêng; STATE/ROADMAP cập nhật một lần cuối đợt. Mục `## Delta (so với docs/current)` của `tasks.md` theo khối `### ADDED|MODIFIED|REMOVED <file>` + `#### Yêu cầu` + `- Kịch bản:` (hoặc `Không thay đổi hành vi (lý do: …)`); `bun run openspec:check` kiểm và `slice:merge` từ chối khi đỏ (ADR-0032).
- **Test tối thiểu trong lát (người dùng chốt 2026-10-20, THẮNG Luật 3/4b/4c khi mâu thuẫn):** chỉ viết + chạy (a) unit cho logic thuần, (b) **một** int đường chính mỗi endpoint mới, (c) **một** test chặn đọc chéo tenant mỗi bảng mới. Logic chung cho mọi tenant ⇒ không test từng tenant/từng case lặp. Không chạy e2e, không chụp baseline, không chạy bộ khác, không chạy lại "cho chắc" trong lát; perf test chỉ cho đường nóng đã có ngưỡng. Viết file e2e được, **không chạy**. **e2e + `test:all` + UAT chạy MỘT lần ở cuối** khi đã làm hết feature. Lát phụ thuộc chạy ngay khi lát nó cần đã merge (không chờ cả đợt). Giao trước số migration + `when` journal cho mỗi lát chạy song song.
- **Review:** một lượt review + security trên diff gộp **cuối đợt**; lỗi gửi lại đúng agent đã làm lát (giữ ngữ cảnh), sửa song song.
- **Model:** Sonnet mặc định; Opus chỉ cho RLS/tenant, quyền, auth, tiền, chuyển dữ liệu khách; Haiku cho việc cơ học.
- **Báo cáo:** mỗi lát một dòng khi xong; quá 45 phút gửi trạng thái 3 dòng.
- **Kiến trúc:** AI System = lõi chung (đăng nhập, tenant, phòng ban, quyền, Agent Hub, MCP, RAG); mỗi app là một gói (schema + RLS riêng). Module đóng băng: `docs/platform/modules.md` — không sửa trừ khi lát yêu cầu.

## Luật 0c — Tiết kiệm token (người dùng chốt 2026-10-30, rút từ đợt CR-103) — xếp theo mức tiết kiệm
1. **Ít làm lại nhất:** test kiểm trạng thái thật (không chỉ "dòng có hiện"); mỗi worktree có "làn" e2e riêng tự động (cổng, DB test, Redis DB thuê toàn máy — `bun run test:e2e:par` / `run-playwright.ts` tự lấy, không đặt env tay; `bun run e2e:lanes [--prune]`, `bun run e2e:reap`; xem WORKFLOW "e2e theo làn"); agent tự tắt mọi server mình bật (`Stop-Process` theo PID của worktree mình) trước khi báo xong.
2. **Model theo rủi ro** (Luật 0b) — chia cụ thể:
   - **Phiên chính (điều phối):** chỉ phân tích, chia lát, ra quyết định, hỏi người dùng, merge, deploy. KHÔNG tự chạy lại test/e2e, đọc log dài, dọn server/worktree, chụp ảnh — giao Haiku rồi đọc tóm tắt.
   - **Opus (agent):** RLS/tenant, quyền, auth/secrets, tiền, migration dữ liệu khách, review + security cuối đợt, thiết kế ranh giới module/contract mà nhiều lát dựa vào, và **mọi thứ đổi trạng thái run/máy trạng thái** (launch/settle/kick/join/skip/retry/timer, kể cả phần chạy của một loại node mới), đồng thời/khoá/hàng đợi/idempotency, đường nóng có ngưỡng perf. Bài học CR-103: node `set`/`if` giao Sonnet ⇒ 1 lỗi Cao + 3 TB đều ở phần chạy; phần Opus không lỗi. **Lát lẫn hai loại ⇒ tách:** Opus làm phần chạy + int trạng thái, Sonnet làm contract/editor/canvas/e2e.
   - **Giao Opus cho gọn** (không ôm việc không cần suy nghĩ): (a) trước khi gọi Opus, `Explore` Haiku gom sẵn danh sách file/hàm/điểm chạm + bối cảnh, đưa vào brief — Opus không tự grep rộng; (b) brief Opus chỉ phần khó (logic trạng thái/quyền/khoá + int test của chính phần đó), giới hạn file được sửa; (c) phần còn lại của lát (UI, contract hiển thị, e2e, `tasks.md`/Delta, relock, chạy lại bộ test rộng) giao Sonnet/Haiku sau khi Opus xong; (d) mức suy nghĩ của agent (người dùng chốt 2026-10-30: Opus 5.5 medium đủ mạnh): Opus luôn `effort: medium` (cả thiết kế/review bảo mật); chỉ nâng `high` khi một lượt medium đã làm sai/bế tắc trên đúng việc đó; Sonnet mặc định; Haiku mặc định (rẻ sẵn, không hạ `low` để tránh làm sai phải chạy lại). **Việc "hơi khó"** (khó hơn code thường nhưng không chạm trạng thái run/quyền — vd thuật toán layout, hạ tầng test có khoá, chẩn đoán lỗi nhiều bước): nhiều code/đầu ra ⇒ **Sonnet `effort: high`**; phán đoán ngắn, đầu ra ít (soát diff nhỏ tìm lỗi logic, chọn 1 trong 2 thiết kế, phân loại lỗi test mới/cũ) ⇒ **Opus `effort: low`**; Sonnet high sai lần 2 trên cùng việc ⇒ Opus medium.
   - **Sonnet (agent, mặc định):** code + test + sửa lỗi của một lát (BE/FE/UI/e2e mới), gộp `docs/current` cuối đợt.
   - **Quét tài liệu/code:** tìm "ở đâu, có gì" (file, chỗ dùng, danh sách) ⇒ agent `Explore` model **Haiku**, chỉ trả kết luận; đối chiếu spec↔code, tìm nguyên nhân lỗi ("có đúng không, vì sao") ⇒ **Sonnet**; quét để review bảo mật/quyền ⇒ **Opus**. Phiên chính chỉ tự đọc khi đã biết đúng 1–3 file, không grep rộng.
   - **Haiku (agent):** chạy lại bộ test/e2e đã có và tóm tắt pass/fail + nguyên nhân sơ bộ; relock test (`test:lock:write/verify`); dọn worktree, server mồ côi, DB test; cập nhật STATE/CODEMAP/INDEX; chụp ảnh màn hình bằng script có sẵn; `openspec:pending/archive`; smoke prod bằng script có sẵn.
3. **Tái dùng ngữ cảnh:** việc tiếp/sửa lỗi của **cùng lát hoặc cùng vùng code** ⇒ `SendMessage` cho agent đã làm (ngữ cảnh còn cache) — thắng câu "không SendMessage giao việc mới" của Luật 3; vùng khác ⇒ agent mới kèm bàn giao.
4. **Brief hẹp, báo cáo ngắn:** brief đủ 6 mục (Luật 3), chỉ đường file cụ thể; báo cáo ≤ 10 dòng; phiên chính không đọc transcript agent, chỉ đọc đuôi log (`-Tail`, `Select-String`).
5. **Prompt cache:** giữ `CLAUDE.md`/tài liệu chung ổn định trong đợt (sửa gom cuối đợt); Claude Code tự cache, không cần cấu hình.
6. **Đọc ít:** tra `docs/INDEX.md`/CODEMAP trước, mở đúng file; code theo Clean Architecture + file nhỏ (Luật 4) để agent không phải đọc rộng.

## Luật 1 — Cửa sẵn sàng (BẮT BUỘC; hỏi người dùng xác nhận trước khi chạy)
Trước khi viết code cho một feature hoặc thay đổi không tầm thường — kể cả khi người dùng chỉ nói "implement", "code", "làm", "build", "tiếp tục", "chạy task":
1. Xác định spec (`docs/specs/<ID>/`; chưa có spec thì mục BA/UI tương ứng trong `docs/design/`).
2. Chạy agent **spec-readiness**. Người dùng đã bảo làm (implement/code/làm tiếp/run…) = đã xác nhận, **không hỏi lại**; chỉ hỏi khi không rõ người dùng có muốn code hay không. Agent chưa hiện trong danh sách → dùng subagent general-purpose đọc nguyên văn `.claude/agents/spec-readiness.md` và đóng đúng vai. (Áp dụng cách này cho mọi agent trong `.claude/agents/`.)
3. **READY** → theo `docs/WORKFLOW.md`. **NOT READY** → không code; gom lỗ hổng Chặn/Cao kèm mặc định đề xuất, hỏi người dùng **một lượt**; ghi câu trả lời vào spec rồi chạy lại.
4. Spec/design/tasks đổi sau lần READY gần nhất → chạy lại. Ghi mỗi lần chạy vào `docs/specs/<ID>/readiness.md`.

Bỏ qua Luật 1 chỉ khi: sửa chính tả/câu chữ, cấu hình nhỏ, hoặc người dùng nói rõ "bỏ qua kiểm tra".

## Luật 1b — Hai làn theo rủi ro (người dùng chốt 2026-10-19, áp từ đợt 2 CR-094)
- **Làn đầy đủ** (Luật 1 + Gate + qc test trước + review/security 2 vòng) **chỉ** cho lát/phần chạm: RLS/tenant, quyền, auth/secrets, tiền (sổ thanh toán, giá), migration dữ liệu khách thật, đường nóng có ngưỡng perf.
- **Làn nhanh** cho lát màn hình / rủi ro thường (UI, mapper, báo cáo, nhãn): **một** agent viết plan ngắn (≤ 1 trang, trong `tasks.md` của lát) + code + test cùng task (unit/int/e2e theo Luật 4b, Luật 4c vẫn áp) → **một** vòng review. Không readiness riêng, không Gate, không qc viết trước (qc chỉ ghi lock khi có test mới dưới `tests/**`/`e2e/**`).
- Lát lẫn hai loại ⇒ tách phần rủi ro cao ra làn đầy đủ, phần còn lại làn nhanh. Phân làn ghi ở `tasks.md` (cột Làn); phân vân ⇒ làn đầy đủ.
- **Một agent làm trọn một lát** (người dùng chốt 2026-10-19, thay cách băm nhiều agent nhỏ): agent viết spec+plan ngắn (≤ 1 trang mỗi file) + BE + FE + test + tự chạy cổng của lát, rồi **một** reviewer. Lát rủi ro cao: thêm security review và readiness **tối đa 1 vòng** (lỗ hổng Cao có mặc định ⇒ áp luôn). Test của lát do chính agent viết; qc chỉ ghi lock và đọc nhanh (Luật 3 test trước chỉ còn áp cho phần tenant/quyền/tiền/migration bên trong lát — agent viết test đó **trước** code của phần đó).

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
- `backend-lead` sở hữu contract; `frontend-lead` không tự đổi contract; **test trước code theo rủi ro** (người dùng 2026-10-18): task rủi ro **cao** (RLS/tenant, quyền, khoá/transaction, đường nóng có ngưỡng perf, contract) ⇒ `qc` viết test **trước** code; task **thường** ⇒ agent code viết code + test cùng task (file test mới, không sửa file đã khoá), `qc` đọc nhanh diff test sau đó (Haiku/Sonnet) rồi ghi lock — không có vòng qc riêng trước code; `reviewer` và `spec-readiness` chỉ đọc; `docs-architect` giữ docs. `qc-uat` (Sonnet, Haiku khi chỉ chạy lại script) chạy UAT trình duyệt thật sau review: dựng stack, lái nhiều user, chụp evidence, báo lỗi; không sửa code/test khoá.
- **Model theo rủi ro nghiệp vụ, kỷ luật token** (`docs/WORKFLOW.md` "Chính sách model", "Kỷ luật token"): mỗi lần gọi agent = một task, task kế gọi agent mới kèm bàn giao (không `SendMessage` giao việc mới); task rủi ro **cao** (RLS/tenant, quyền, auth/secrets/2FA, quota, audit, khoá/transaction/NOTIFY) dùng Opus, task thường truyền `model: sonnet`; việc cơ học (chạy lại script/test, relock, sửa đường dẫn, format, cập nhật STATE/CODEMAP) truyền `model: haiku` — Opus chỉ cho rủi ro cao hoặc phán đoán khó (`WORKFLOW.md` "Nguyên tắc việc đơn giản"). **Mọi brief giao agent có đủ 6 mục: phạm vi (làm/không làm), xong khi (lệnh, chạy một lần), được phép đỏ (phụ thuộc task sau, chập chờn đã biết), điểm dừng, giới hạn thời gian, khuôn báo cáo** — để agent không làm việc vô ích; task lớn chia trước Sonnet/Opus/Haiku (`WORKFLOW.md` "Điều phối nhanh"). Hết mốc: đo token → `/handoff` → `/clear`.
- **Khoá test:** sau Gate, `tests/acceptance/**` và `e2e/**` chỉ `qc` được sửa (`tests/.lock`). Agent code tin test sai → ghi "Tranh chấp test", không sửa test.

## Luật 4 — Chuẩn và phạm vi sửa
- Theo `docs/CONVENTIONS.md`: feature-first, file ≤ 400 dòng, hàm ≤ 50 dòng, component ≤ 200 dòng.
- Format/lint **chỉ file thay đổi**. Không refactor ngoài phạm vi task; thấy nợ → `docs/TECH-DEBT.md`.
- Ngoại lệ (CR-089, ADR-0023): khi task sửa logic trong một module chưa theo Clean Architecture, được tách phần chạm tới sang `domain/`/`application/`/`adapters/` trong cùng task; qc sửa đường dẫn test khoá trong cùng task.

## Luật 4b — Mọi thay đổi code có test chạy lại được (CR-092)
- Tính năng mới hoặc sửa code (kể cả sửa lỗi nhỏ ngoài mốc) **phải kèm test** trong cùng task/commit: unit (luật thuần) + int (API/DB/RLS) cho phần đổi. Không có test → chưa xong.
- Thay đổi chạm **UI hoặc luồng người dùng** (gồm API mà màn hình dùng) **phải thêm hoặc sửa e2e** Playwright; cấu hình e2e mới đặt dưới `e2e/**/playwright*.config.ts` để `test:all` tự nhận.
- Sửa lỗi: viết test tái hiện lỗi (đỏ) trước, rồi sửa cho xanh.
- Bộ hồi quy chạy lại bằng **một lệnh** `bun run test:all` (cần stack local: `scripts/dev-db.ps1 -Wait`); báo xong một mốc/nhánh phải ghi kết quả lệnh này. Test của mốc đã Gate vẫn theo khoá test (Luật 3).

## Luật 4c — Hiệu năng là yêu cầu, không phải tối ưu sau (người dùng yêu cầu 2026-10-18, CR-093)
- **Chậm mà không phải chờ AI = lỗi của mình.** Đường nóng (API, vòng nền, xử lý lô) phải nhanh và đúng cùng lúc; không đổi tính đúng đắn lấy tốc độ, không đổi tốc độ lấy "an toàn" mà không nói rõ.
- **Thiết kế theo tập:** không truy vấn/transaction từng hàng trong vòng lặp; mỗi lô số câu SQL cố định (không phụ thuộc số hàng), lọc `= any(array)` qua index, khoá `FOR UPDATE SKIP LOCKED` khi nhiều instance; một pipeline Redis mỗi lô; không gọi mạng/đăng tin trong vòng lặp hàng.
- **Kế hoạch truy vấn không phụ thuộc thống kê bảng** (sau chèn hàng loạt thống kê cũ): tránh join `unnest` để lọc bảng lớn; câu SQL văn bản cố định (dữ liệu lô qua một tham số JSON) để mỗi kết nối chỉ chuẩn bị một lần.
- **Có số đo:** đường nóng mới/sửa phải có ngưỡng đo được (vd lô 100 p95 ≤ 50 ms, tổng 10.000 hàng) + test `*.perf.int.test.ts`; test đếm số câu SQL mỗi lô khi là vòng lô. Báo số thật (trước → sau), không làm tròn; chưa đạt thì nói chưa đạt và vì sao.
- **Không chờ hết giờ, không ngủ chờ** (người dùng 2026-10-18): code và test KHÔNG `sleep`/`setTimeout` để đợi trạng thái, không poll tới khi hết timeout. Code: chờ bằng tín hiệu (promise trả về, sự kiện, NOTIFY/stream, `await` lời gọi), vòng nền chỉ ngủ giữa các lượt khi không còn việc. Test: đồng hồ giả (`d.now`) + gọi `*Once` trực tiếp + `await` kết quả; cần chờ việc bất đồng bộ thật thì chờ tín hiệu xong (handle trả promise, hook), không chờ mốc giờ. Thiếu tính năng/điều kiện tiền đề ⇒ fail NGAY với lý do rõ. Timeout chỉ là lưới an toàn cho lỗi treo, không phải cơ chế chờ.
- **Test cũng phải nhanh:** int nhiều file chạy bằng `bun run test:int:par` (P-a + K1: 174 s tuần tự → 51 s); chỉ chạy test của phần đang sửa khi làm; bộ đầy đủ khi đóng task/mốc. Không chạy lại cả bộ để "chắc ăn"; thấy test chậm thì đo (file chậm nhất, reset/migrate DB, tuần tự) rồi sửa hạ tầng test.

## Luật 5 — Truy vết
- Mã yêu cầu (`ADM-FR-xx`, `HUB-FR-xx`, `WRK-FR-xx`, AC) có trong: frontmatter spec, comment đầu module, tên test, commit `[ADM-FR-xx]`.
- Xong task: tick `tasks.md`, cập nhật `docs/STATE.md`. Đổi cấu trúc → `docs-architect` cập nhật CODEMAP/TRACE.
- Một session: làm và commit trực tiếp trên `main` (người dùng yêu cầu 2026-10-01). Nhiều session cùng một mốc: Bước 0 trên `main`, rồi mỗi session một worktree + nhánh `feat/<mốc>-<feature>`, merge lần lượt qua cổng merge (`docs/WORKFLOW.md` "Làm song song nhiều session", CR-059). Không push trừ khi được yêu cầu.
