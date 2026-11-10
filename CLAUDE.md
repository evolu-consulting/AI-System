# Evolu Platform — luật cho Claude và mọi agent

Nền tảng AI multi-tenant: lõi chung (đăng nhập, tenant, quyền, Agent Hub, MCP, RAG) + các app là gói riêng (Sổ Hợp Tác, Community…). Nhánh làm việc: `platform/gd0`.

**Đọc trước:** `docs/STATE.md` → cần tìm gì thì `docs/INDEX.md`, mở đúng một file. Bản đồ dây chuyền: `docs/platform/dev-flow.md`. Cách làm chi tiết: `docs/WORKFLOW.md`. Chuẩn code: `docs/CONVENTIONS.md`. Lý do và lịch sử từng luật: `docs/RULES-DETAIL.md` (không nạp mỗi phiên; mâu thuẫn thì file này thắng).

**Stack:** TypeScript strict · Bun + Turborepo · Rsbuild + React + Tailwind + shadcn/ui · Hono · Postgres + Drizzle (RLS) · zod · Redis · Biome · bun test + Playwright · Docker Compose.

**Lệnh hay dùng:** `bun run slice:new|slice:merge|slice:rm <lát>` · `bun run test:affected` · `powershell -File deploy/evotest/run-tests.ps1 -Step int|e2e -Filter "<đường dẫn cách nhau dấu cách>" [-Dirty]` · `bun run openspec:check|pending|archive` · `bun run spec:find "<câu>"` · `bun run proto:build <thư mục CR>` · `bun run res:check [--server]` · `bun run check:env-contract` · `bun run verify:predeploy|verify:prod` · `bun run release:log`.

## 0. Thứ tự ưu tiên (một bảng duy nhất, không có ngoại lệ khác)
1. **An toàn** — mục 2 (điểm dừng cứng).
2. **Nhất quán và dễ hiểu** — mục 1.
3. **Đúng** — spec, test, quyền.
4. **Nhanh** — thời gian tới lúc người dùng dùng được.
5. **Rẻ** — token.

Hai luật mâu thuẫn ⇒ luật ở bậc trên thắng. Cùng bậc ⇒ chọn cách dễ đổi lại hơn.

## 1. Luật gốc
- **G1. Một nguồn sự thật.** Mỗi khái niệm lưu một chỗ. Thay nguồn ⇒ cùng thay đổi phải backfill, chuyển mọi chỗ đọc, gỡ cái cũ.
- **G2. Một khái niệm = một tên, một màn hình, một control.** App mới theo đúng khuôn (manifest, shell, token màu).
- **G3. Người dùng thật hiểu được.** Nhãn theo nghiệp vụ, không lộ từ kỹ thuật. Màn hình nói trạng thái, lý do, ai làm bước kế. Không có thao tác ẩn bắt buộc. Ít chữ.
- **G4. "Xong" = e2e hành trình thật xanh + đã soát UI góc người dùng.** Thiếu một trong hai ⇒ nói "chưa xong".

## 2. Điểm dừng cứng — phải có người dùng đồng ý, từng lần
- Deploy prod (`sohoptac2`). Push ra ngoài remote `github`. Merge vào `main`.
- In, ghi, commit secret hay mật khẩu. Đọc `.env` prod có hiện giá trị.
- Việc có thể mất dữ liệu; xoá worktree, nhánh, stash.
- Đổi phạm vi hoặc contract đã chốt. Thêm thư viện, dịch vụ trả tiền.
- Sửa hay test code DLC của Rowan (`docs/platform/dlc-integration.md`).
- Bị hệ thống quyền từ chối ⇒ dừng, báo người dùng. **Không tìm đường vòng, không nhờ agent khác làm hộ.**

Ngoài danh sách này: đủ thông tin thì làm, không hỏi "tiếp tục không?". Việc đã chốt không hỏi lại.

## 3. Dây chuyền — 7 giai đoạn
| # | Giai đoạn | Luật |
|---|---|---|
| 1 | **Nhận** | Yêu cầu mới ⇒ Intake (`/intake`): tách ý, tra `spec:find`, phân loại, hỏi **một lượt** kèm mặc định. Câu hỏi thường, xác nhận ngắn ⇒ không Intake. "Đã có"/"Mâu thuẫn" phải kèm trích nguyên văn + `file:dòng`. |
| 2 | **Chốt** | Ghi `CR-xxx`. CR có màn hình hoặc luồng mới ⇒ **nên** làm bản mẫu bấm được (`/prototype`, ≤ 15 phút) cho người dùng xem trước khi code. Chưa chốt ⇒ không code. |
| 3 | **Chia** | Bản đồ file trước, rồi chia lát. Lát ≤ 20 phút (lát Opus ≤ 40). Lát chung file ⇒ nối tiếp. Giao trước số migration. |
| 4 | **Làm** | Mỗi lát một worktree, một agent làm trọn. `tasks.md` có Delta; mỗi Kịch bản có `[test: …]`. Lỗi nhỏ (≤ 30 dòng, một vùng, không migration, không quyền) ⇒ sửa thẳng trên `platform/gd0`; nếu đổi hành vi nhìn thấy được thì vẫn ghi Delta. |
| 5 | **Kiểm** | Soát Opus cho diff chạm dữ liệu khách / RLS / quyền / trạng thái run / migration — **không bỏ qua, kể cả sửa thẳng**. e2e hành trình **một lần** cuối đợt, do điều phối chạy. Soát UI góc CEO/sale. |
| 6 | **Phát hành** | Staging: deploy ⇒ chạy smoke (`deploy/stg-test/e2e-smoke.ps1`) ⇒ `release:log`. Prod: mục 2 + `verify:predeploy` + backup + `verify:prod`. |
| 7 | **Đóng** | Gộp Delta vào `docs/current`, `openspec:archive`, cập nhật `STATE.md`. Xoá worktree đã gộp (hỏi người dùng). |

## 4. Nhanh và đúng — bắt lỗi ở tầng rẻ nhất
- **N1. Tầng bắt lỗi.** Logic ⇒ unit (giây). Quyền, RLS, SQL ⇒ int (chục giây). Luồng nhiều vai ⇒ e2e (phút). Cấu hình môi trường ⇒ `check:env-contract` + smoke staging. Lỗi lọt xuống tầng đắt hơn ⇒ thêm test ở tầng rẻ, cùng lần sửa.
- **N2. Test quyền luôn có ca "người được giao, không phải người tạo dữ liệu".** e2e hành trình: mỗi bước do đúng vai làm, khác người tạo.
- **N3. Trong lát chỉ chạy:** unit + int của file sửa; `tsc` một lần cuối, chỉ gói đổi. Không e2e, không chạy lại "cho chắc". Tối đa 3 lượt test mỗi lát.
- **N4. Chạy lại chỉ phần đỏ.** Chỉ báo đỏ mới (ngoài `tests/known-red.json`).
- **N5. Không ngủ chờ.** Code, test, agent đều không `sleep`/poll. Chờ evotest bằng lệnh tiền cảnh.
- **N6. Test nặng lên evotest**, chia slot song song. Local tối đa 2 Playwright.
- **N7. Hiệu năng là yêu cầu.** SQL theo tập, số câu cố định mỗi lô. Đường nóng có ngưỡng và test perf. Báo số thật.
- **N8. Sửa lỗi:** viết test đỏ tái hiện trước, rồi sửa.

## 5. Agent
- **A1. Tối đa 4 agent code cùng lúc.** Việc độc lập ⇒ chạy song song. Không thêm việc vào agent đang chạy.
- **A2. Model theo việc:**

| Việc | Model |
|---|---|
| Dọn, relock, chạy script, tìm "ở đâu" | Haiku |
| Code + test một lát, UI, e2e, docs | Sonnet |
| Migration đơn giản, perf SQL, chẩn đoán nhiều bước | Sonnet `high` |
| Soát diff rủi ro, chọn một trong hai thiết kế | Opus `low` |
| Tự viết lõi trạng thái run / khoá / đồng thời; review + security cuối CR | Opus `medium` |

- **A3. Brief đủ 7 mục:** phạm vi (làm / không làm) · file + hàm cần sửa · xong khi (lệnh, chạy một lần) · được phép đỏ · giới hạn thời gian · perf · khuôn báo cáo. Trỏ file, không chép nội dung.
- **A4. Báo cáo ≤ 6 dòng:** commit · test (lệnh → kết quả) · việc dở · bẫy · thời gian (code / chờ / sửa).
- **A5. Cấm với mọi agent:** `--no-verify`, `LEFTHOOK=0`, tiến trình tách rời, ghi ngoài worktree của mình, `git checkout -- .`, `git stash`/`reset` index chung, kill rộng (chỉ dừng PID mình bật), tự chạy e2e toàn job, sửa test đã khoá (trừ qc), dừng giữa lát để hỏi.
- **A6. Agent ≤ 60 lần gọi công cụ mỗi lát.** Tìm và đọc bằng Grep/Read. Quá giờ ⇒ commit phần xanh, ghi "Việc còn lại", dừng.
- **A7. Việc tiếp cùng vùng ⇒ gửi lại agent cũ** (khi nó đã báo xong). Vùng khác ⇒ agent mới.
- **A8. Điều phối:** chỉ chia việc, quyết, gộp, deploy. Gộp ngay khi lát báo xong. Trước khi gộp: `git reset -q` ở checkout chính, xem `git status`. Chỉ báo người dùng khi có kết quả hoặc cần quyết. Báo cáo của agent là lời khai, không phải bằng chứng — việc rủi ro thì đọc diff.
- **A9. Agent nói với agent qua file, không qua lời kể.** Gửi đường dẫn + `file:dòng` + commit; không chép nội dung file, log, diff vào tin nhắn. Kết quả bàn giao = commit + `tasks.md` + báo cáo A4.
- **A10. Giữ phần đầu ngữ cảnh ổn định để ăn cache:** không sửa `CLAUDE.md` và tài liệu chung giữa đợt (gom cuối đợt). Việc cần cả cuộc trao đổi ⇒ `fork`; việc tự đứng được ⇒ agent mới với brief A3.
- **A11. Một việc một chủ.** Đã giao thì điều phối không làm trùng, không đọc transcript của agent; chỉ đọc báo cáo và diff.
- **A12. Agent thấy sai ngoài phạm vi ⇒ ghi một dòng vào báo cáo**, không tự sửa, không nhắn agent khác.
- **A13. Trả lời người dùng:** tiếng Việt đơn giản, ngắn, kết quả trước. Nói rõ cái gì chưa kiểm.

## 6. Code và ghi vết
- Feature-first, Clean Architecture; file ≤ 400 dòng, hàm ≤ 50, component ≤ 200. Import qua `modules/<m>/public.ts`.
- Format, lint chỉ file thay đổi. Không refactor ngoài phạm vi; nợ ghi `docs/TECH-DEBT.md`.
- Mọi thay đổi code có test trong cùng commit. Đổi UI hoặc luồng ⇒ có e2e (viết trong lát, chạy cuối đợt).
- Commit có mã `[CR-xxx]` hoặc mã yêu cầu. Xong lát: tick `tasks.md`.
- Tự quyết giữa chừng ⇒ một dòng ở "Quyết định trong lúc làm". Tra theo thứ tự: spec → `docs/current` → ADR → CONVENTIONS → code hiện có → cách đơn giản nhất.
