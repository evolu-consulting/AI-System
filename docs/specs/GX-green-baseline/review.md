---
id: GX-green-baseline
---

# Review · GX green baseline (làn nhanh, một reviewer)

Phạm vi: `3a2f95b0`, `e77881b3`, `ac9bf251`, `46d173ee` (nhánh `platform/gd0`) + `tasks.md`, `gate.md`, TECH-DEBT. Chỉ đọc; chạy test mục tiêu, không chạy `test:all`.

## Verdict: APPROVED

0 Critical · 0 High · 0 Medium · 3 Low · 2 Info.

## 1. Sửa test khoá: chỉ thiết lập/kiểu, không đổi điều test khẳng định (kết quả: ĐẠT)

Đã `git show` từng file và đối chiếu với `tests/.lock`.

| File | Diff | Kết luận |
|---|---|---|
| N2/pack-outcome (1) | `expect(live)` → `expect([...live])`, vẫn `.toEqual([])` | chỉ kiểu (RowList → mảng), cùng giá trị so sánh |
| N2/pack-tool (3 chỗ) | `expect(await items(x))` → `expect([...(await items(x))])`, vẫn `.toEqual([])` | như trên |
| N2/reject (1) | `expect(open)` → `expect([...open])` | như trên |
| H2c/send A47 | thêm 1 dòng `rt.agent(await rt.next(...), {status:"done"…})` trước `s.terminal`; assertion `run.finished` giữ | thiết lập: phục vụ job agent thứ hai do H2c-R15 (có ở commit 99360274) |
| H2c/upload A05 | thêm 2 `waitFor` (hàng ≥ 1 và hết `.part`) trước kiểm; assertion `size > 1024` = 0 giữ nguyên | chờ tín hiệu xong, không sleep; kiểm còn CHẶT hơn (đợi ghi muộn xong rồi mới khẳng định 0 hàng) |
| X2b/context R08 | thêm import + `waitAgentMsg(...)` sau `answer(...)` lần 1 | chờ tin xuất hiện; không đổi assertion ngữ cảnh |
| e2e/combine, e2e/x1 `playwright.config.ts` | `?? randomBytes` → `|| randomBytes` | cấu hình, không có assertion |

`tests/.lock`: đúng 8 hàng đổi (6 file test + 2 config combine/x1), hash mới khớp; `bun run test:lock:verify` = OK (980 file). Không file nào khác dưới `tests/**`/`e2e/**` bị đổi trong 4 commit (`git diff --name-only` 38f98eff..HEAD). `playwright.config.ts` gốc và `apps/studio-web/rsbuild.config.ts` không nằm trong lock.

Chạy lại: N2 (cả thư mục) + H2c/send + H2c/upload + X2b/context qua `test:int:par` = 67 pass / 0 fail, 8 s.

## 2. Các điểm cần xác nhận

- **`??` → `||` (xác nhận):** chỉ chạm `apps/studio-web/rsbuild.config.ts` (proxy dev/preview, chỉ đọc `ADMIN_API_URL`/`HUB_URL`) và 2 config Playwright (`HUB_INTERNAL_TOKEN`). Không có đường production. Giá trị rỗng ⇒ mặc định `localhost` (dev) hoặc token ngẫu nhiên 48 ký tự (an toàn hơn token rỗng). Cũng không có `??` → `||` ở mã sản phẩm trong 4 commit. `env: { PUBLIC_HUB_URL: "", PUBLIC_STUDIO_URL: "" }` ở `playwright.config.ts` gốc chỉ cho webServer build của e2e, nhằm ca "vắng Hub" tất định.
- **Múi giờ giữ TZ-R02 (xác nhận):** chạy trên Bun 1.4.3: `isSupportedTimeZone("Asia/Saigon")` = false, `"Asia/Ho_Chi_Minh"` = true, `"Foo/Bar"` = false, `"asia/ho_chi_minh"` = false (phân biệt hoa/thường). `Asia/Saigon` không nằm trong `MODERN_IANA_NAMES`, nên chỉ hợp lệ khi runtime tự liệt kê, đúng TZ-R02. `bun test packages/contracts tests/acceptance/P-d` = 747 pass (gồm timezone-rules, AC-A14). Bảng tên hiện hành chỉ 8 mục, mỗi mục còn phải qua `Intl.DateTimeFormat`.
- **4 file DB sang `INT_SERIAL` (không che lỗi thật):** các file vẫn chạy (tuần tự sau shard), không skip/retry/nới timeout; lý do đo được (N1/migrate 210 s → vài giây khi riêng) là tranh chấp Postgres/checkpoint, và hai file trong số đó (`migrate-lock`, `test-db-template`) tự kiểm khoá/migrate đồng thời trong chính file. Gate còn ghi `migrate-lock afterAll` quá 30 s một lượt ngay sau 6 worker (xanh khi riêng) nên không bị che. Xem L3.
- **kh/agents ports (#226) theo ADR-0023 / CONVENTIONS §10:** `kh.writes.port.ts` (module kh, phục vụ processes) và `agents.port.ts` (module studio, phục vụ kh) là cổng của module sở hữu, chỉ chuyển tiếp chữ ký (không thêm logic); `step-persist.ts`, `view-knowledge.ts`, `kh.agent.service.ts` đổi import sang cổng. `depcruise` trên hub-api: 0 vi phạm (897 module). Cổng nằm trong lớp 3/4 + mã cũ chưa chuyển, không đưa import chéo vào lớp 1–2.
- **Glob.scan (#225):** `findE2eConfigs` quét hai mẫu riêng, thật ra tìm thấy 18 cấu hình (gốc + 17 dưới `e2e/`), đúng mọi `playwright*.config.ts` dưới `e2e/` và gốc. Hai file còn lại trên đĩa là `docs/specs/P-d-durable/evidence/**/playwright.uat.config.ts` (bằng chứng UAT, ngoài `e2e/` theo thiết kế). Số "20" trong `gate.md` là sai, xem L1.
- **Không làm yếu cho xanh:** `git diff -U0` 4 commit không thêm `.skip`/`todo`, `sleep`, `setTimeout`, retry; không nới timeout. Test mới của `waitFor` dùng ngưỡng an toàn 10 s, không phải cơ chế chờ. Ca không sửa được (R48/R49/R-K01, TZ-R02, 4 e2e Workflows, CHAT-AC-35, UC-02, CHAT-AC-57, P1-48e) được ghi "Tranh chấp test" chứ không sửa.
- **Tách file PD-A03 (run-state/tool-stage/review-escalations):** file mới 50–143 dòng, `check:size` OK, depcruise OK, 146 unit `processes` pass, int N2/H2c/X2b pass; re-export giữ import cũ.

## 3. Phát hiện

| # | Mức | Mô tả | Đề xuất |
|---|---|---|---|
| L1 | Low | `gate.md` dòng 5 viết "20 cấu hình e2e", bảng liệt kê và thực tế là 18 (5/23 bước = 25 bước − 2 bị chặn) | sửa thành 18 |
| L2 | Low | `test-all.discover.test.ts` chỉ `toContain` 3 đường dẫn; nếu quét sót một nửa cấu hình thì test vẫn xanh (đúng loại lỗi #225) | so với danh sách tự liệt kê bằng `readdir` đệ quy hoặc khẳng định đủ 18 |
| L3 | Low | `needsClose` giờ bỏ `Connection: close` cho thân có `Content-Length`; chỉ đo trên Bun 1.4.3, trong khi `packageManager` ghim `bun@1.3.14` (tác giả ghi 1.3.14 không đóng theo header, tức đổi này không làm khác đi ở 1.3.14, nhưng chưa đo) | ghi vào TECH-DEBT: đo 413/415 với thân dư trên 1.3.14 trước khi nâng/đổi ghim; `migrate-lock afterAll` còn đỏ một lượt do checkpoint cũng nên có dòng nợ |
| I1 | Info | Mục tiêu "nền xanh" chưa đạt: 5/23 bước đỏ (3 unit, 1 int, 1 P-a, 2 chat, 4 e2e gốc), 2 bước bị chặn (docker/uv). Gate/tasks nói rõ, không giấu; #232 mở | người dùng/qc quyết các Tranh chấp trước HD3 |
| I2 | Info | Cổng `*.port.ts` chỉ chuyển tiếp hàm (trùng chữ ký); chấp nhận được ở mã cũ, nên chuyển sang `ports.ts` khi hai module được chuyển lớp (Luật 4 ngoại lệ) | không cần làm ngay |

TECH-DEBT: đóng #148 #176 #200 #225–#228 #231, mở #232, giữ #230; nội dung khớp `tasks.md`/`gate.md`.
