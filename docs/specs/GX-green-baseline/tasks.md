---
id: GX-green-baseline
---

# Tasks · GX green baseline

Làn: **nhanh** (một agent, một reviewer; Luật 1b). Người dùng duyệt 2026-10-19: dọn nợ #225–#231 để `bun run test:all` chạy đủ MỌI bước (kể cả e2e) và xanh trước HD3. Phạm vi: hạ tầng test, vài lỗi sản phẩm nhỏ, tách file theo trần lớp. Không đổi hành vi nghiệp vụ trừ #227 và hai lỗi Bun 1.4 (Range, `Connection: close`).

## Plan ngắn
1. Đo trước: `bun test`, `test:int:par`, `typecheck`, `depcruise`, `check:size`, e2e từng cấu hình.
2. Mỗi đỏ: tìm nguyên nhân gốc → sửa sản phẩm / hạ tầng; sửa test chỉ khi test sai vì lý do không đổi điều nó kiểm (kiểu, thiếu tín hiệu chờ, thiết lập lỗi thời); đổi điều test khoá kiểm ⇒ "Tranh chấp test", không sửa.
3. Không sleep/retry che chập chờn; không nới timeout. Chạy `test:all` một lần sạch (không chạy gì khác song song) để lấy số.

| # | Task | Trạng thái |
|---|---|---|
| T1 | #225 `Glob.scan` brace + `**` trả 0 trên Windows ⇒ quét hai mẫu riêng (`test-all.discover.ts` + test); bước e2e đi qua `run-playwright.ts` (Node thật) | [x] |
| T2 | #227 `isSupportedTimeZone`: chấp nhận tên IANA hiện hành mà Chromium/Node chỉ liệt kê tên cũ (`Asia/Ho_Chi_Minh` ↔ `Asia/Saigon`) bằng bảng tên + `Intl.DateTimeFormat`; lưu đúng tên đã chọn; unit test; e2e N2 2/2 | [x] |
| T3 | #228 5 lỗi TS2769 ở 3 file N2 khoá (qc, chỉ kiểu) | [x] |
| T4 | #226 3 vi phạm `no-cross-module-repo` ⇒ cổng `kh.writes.port.ts`, `agents.port.ts` | [x] |
| T5 | #231 `check:size` miễn `reference/` | [x] |
| T6 | #229 + cũ: nguyên nhân gốc từng ca (bảng dưới) | [x] một phần — 3 Tranh chấp |
| T7 | Python / typecheck agent-runtime: thiếu `docker` (và `uv`) ⇒ bước BỊ CHẶN có lý do, không tải về (#230) | [x] |
| T8 | `test:all` chạy sạch, ghi `gate.md` | [ ] |

## Thay đổi test khoá (qc, relock chỉ file đổi; assertion không đổi)
| File | Đổi gì | Vì sao |
|---|---|---|
| `tests/acceptance/N2/pack-outcome.int.test.ts` (dòng 86) | `expect(live)` → `expect([...live])` | #228 TS2769: `RowList` không gán được `never[]`; cùng giá trị so sánh |
| `tests/acceptance/N2/pack-tool.int.test.ts` (3 chỗ) | `expect(await items(…))` → `expect([...(await items(…))])` | như trên |
| `tests/acceptance/N2/reject.int.test.ts` (dòng 48) | `expect(open)` → `expect([...open])` | như trên |
| `tests/acceptance/H2c/send.int.test.ts` A47 | thêm phục vụ job agent thứ hai (`rt.agent(await rt.next(run), done)`) trước khi chờ `run.finished` | H2c-R15 (commit 99360274): tin có file + Orchestrator `answer` ⇒ Hub giao cho agent đọc file; test chỉ phục vụ job Orchestrator nên run không bao giờ xong. Assertion (run.finished, `attachments` E10/E11) giữ nguyên |
| `tests/acceptance/H2c/upload.int.test.ts` A05 | chờ request 1 024 byte hoàn tất (`waitFor` hàng + hết `.part`) trước khi kiểm | phản hồi đầu trên socket thô là 400 của phần "request" thừa, không phải kết quả request thật ⇒ ghi muộn lọt sang A06 (snapshot lệch `.part`/hàng). Assertion giữ nguyên |
| `tests/acceptance/X2b/context.int.test.ts` R08 | `waitAgentMsg(...)` sau `answer(...)` ở lần 1 | tin agent vào phòng bất đồng bộ; lần 2 dựng ngữ cảnh trước khi tin vào ⇒ thiếu assistant. Chờ tín hiệu (tin xuất hiện), assertion giữ nguyên |

## Nguyên nhân gốc từng đỏ cũ
| Ca | Nguyên nhân | Xử lý |
|---|---|---|
| `bun test` đỏ ca cần DB (13 vs 12) | `bun test` không nạp `.env.local` (NODE_ENV=test) | bước `unit` của `test:all` nạp `--env-file=.env.local` khi có |
| 6 ca stack H1/H2a trong `bun test` | `bunfig.toml` không loại `tests/acceptance/H1/stack`, `H2a/stack` (cần docker + stack, chạy bằng `test:h1:stack`/`test:h2a:stack`; H2b/H2c/H3a đã loại) | thêm vào `pathIgnorePatterns` |
| PD-A03 ×3 (#229) | file vượt trần lớp từ P-d2 | tách file giữ hành vi: `run-state.{types,core,decide}.ts`, `tool-stage-settle.ts`, `review-escalations.repo.ts`, `tool-stage-{load,lock}.repo.ts`; re-export giữ import cũ |
| #148 `migrate-hub` ×4, #176 `hub-rls` | test (không khoá, `packages/db`) lỗi thời: main 13→14 (N2 0013), 4 bảng N3 (`notifications`, `notification_deliveries`, `notify_prefs`, `push_subscriptions`) chưa có trong danh sách bảng/policy | cập nhật số/danh sách |
| #200 A36 + FB1-AC-03 (Range) | Bun 1.4: `Bun.file().stream()` vẫn bị nhận ra là file ⇒ 206 | sản phẩm: `pipeThrough(new TransformStream())` (đo: file/stream 206, pipe 200) |
| #200 I19 (ECONNRESET) | Bun 1.4 đóng socket ngay theo `Connection: close` khi thân `Content-Length` còn dư ⇒ RST, client mất phản hồi 413/415 (1.3.14 không đóng) | sản phẩm: chỉ đặt `close` cho thân chunked (đã đọc bỏ); thân có `Content-Length` Bun tự xử lý (đo 8/8 nhận 413 khi không đặt, 0/8 khi đặt) |
| #200 A47, A06; #229 X2b R08 | xem bảng test khoá ở trên | sửa thiết lập test |

## Tranh chấp test (không sửa — đổi điều test khoá kiểm)
| Ca | Chuyện gì | Đề xuất cho qc |
|---|---|---|
| `H2c/rules/contracts-h2c.test.ts` R48 | `JOB_FAIL_REASONS.at(-1)` kỳ vọng `"attachment"`; sản phẩm thêm `"container"` cuối (P-c1) | kiểm tiền tố (vd các lý do H2c đứng đúng thứ tự, thêm lý do sau cho phép) |
| cùng file R49 | duyệt mọi fixture `hub/valid|invalid` kỳ vọng có schema trong `HUB_JSON_SCHEMAS`; `SourceApplyJob.*` (P-c2) và `SourceResolveJob.*` (P-b) cố ý KHÔNG đăng ký ở đó (`json-schema.ts`) | bỏ qua fixture `Source*` hoặc ánh xạ riêng sang schema của chúng |
| `P-a/step0/rules/contracts-pa.test.ts` R-K01 | `ROOM_PROCESS_KINDS` kỳ vọng đúng 7 phần tử; P-d2 thêm `branch` | kiểm tiền tố / thêm `branch` |
| #227 mở rộng | AC-A14, `P-d/admin/timezone-rules.test.ts`, `timezone.int.test.ts` khẳng định alias `Asia/Saigon` bị CHẶN (TZ-R02). Fix giữ nguyên điều đó (server Bun không liệt kê `Saigon` ⇒ chặn) và chỉ chấp nhận thêm tên hiện hành (`Asia/Ho_Chi_Minh`…) trên runtime chỉ liệt kê tên cũ. "Chấp nhận mọi alias" sẽ đảo assertion khoá ⇒ chưa làm | người dùng/qc quyết có đổi TZ-R02 không |