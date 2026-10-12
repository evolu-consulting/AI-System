# Quyết định áp từ readiness lần 1 · X2b2-room-attachments

2026-10-12 · điều phối chấp nhận toàn bộ mặc định (spec-readiness lần 1 = NOT READY, 0 Chặn, 7 Cao). Spec sát trần 25 KB nên chi tiết ở đây; spec chỉ sửa tại chỗ. Khi mâu thuẫn với `spec.md`/`plan.md`/`test-plan.md` cũ, **file này thắng** (các file đó đã được sửa theo).

| # | Quyết định | Áp vào |
|---|---|---|
| 1 | Token job khác hoặc id ngoài payload ⇒ **401**; token rác ⇒ 401 (khớp `internal/attachments.service.ts:112`, H2c "mọi sai xác thực ⇒ unauthorized") | AC07, test-plan I33, G5 |
| 2 | Int không dùng directive `#fake:*` (chỉ có ở Runtime Python). Helper `tests/acceptance/X2b2/_x2b2.ts` gọi `GET /internal/jobs/:id/attachments/:att` và `POST /internal/jobs/:id/outputs` bằng token job. **Bỏ I32** (H2c `files.stack.test.ts` đã phủ sandbox theo job). I30/I31/I38/I40/I42/I44/I45 sửa theo | test-plan §1, §3.4–3.5 |
| 3 | Lệnh e2e: `bunx playwright test -c e2e/chat/playwright.x2b2.config.ts` (= `bun run e2e:chat:x2b2`) | spec §8, tasks F3, test-plan §5 |
| 4 | Thêm task **B7** (backend-lead, thường, sau B2): chỉ `package.json` (`e2e:chat:x2b2`, `done:x2b2`) + `tools/scripts/src/done-x2b2.ts`. **B7 không sửa `e2e/**`** (khoá cho qc): config + env kho e2e (`HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR` tạm) do qc ở Q1 (`e2e/chat/_x2b2-stack.ts` mới, hoặc sửa `_x2b-stack.ts` rồi khoá lại) | tasks |
| 5 | Lệnh xong mỗi B theo đường dẫn, không `bun run test:int` toàn bộ; B2–B6 và F1 phụ thuộc Q1 | tasks |
| 6 | **Bảo mật S8:** `processes/runs/start-inputs.ts` `ownsUpload` thêm `and room_id is null` (file phòng không làm input quy trình); int **I53**: ⇒ 400 `VALIDATION_ERROR` path `inputs`. Gắn vào B3 | plan §5, §11; test-plan; tasks B3 |
| 7 | E08 khẳng định luồng `useRoomLost` (X2a); toast `attach.downloadFailed` khi 404 kiểm unit FE; quyền 404 đã có I03 | test-plan E08, plan-frontend §8 |
| 8 | S3b: endpoint nội bộ không kiểm phòng xoá — chấp nhận; int **I54**: DELETE phòng khi run chạy ⇒ GET nội bộ token job ⇒ 401 | plan §11 |
| 9 | Q16 = D12: Dify `@` trong phòng không nhận file (khớp H2c T11); `runs.attachment_ids` vẫn ghi | spec §9 |
| 10 | R03 trỏ §3 là nguồn duy nhất thứ tự kiểm. R20: `!…` timeline kèm file ⇒ 400 (D8); file cho quy trình chỉ qua form input P-b | spec R03, R20 |
| 11 | FE: 400 path `attachment_ids` của `!key` ⇒ câu key `process.composer.error.noAttach` (hằng `PROCESS_NO_ATTACH_CODE` = `"PROCESS_ATTACH_UNSUPPORTED"` ở `use-bang-submit.ts`) có sẵn | plan-frontend §1, tasks F1 |
| 12 | Chấp nhận nguyên văn G1–G4, G6, G7 của qc (`test-plan.md` §9): G1 map R10/R12/R19 vào I38/I07/I06 · G2 test 1 job ⇒ 5 file (I45) · G3 theo D8 (I21) · G4 thread quy trình chỉ kiểm 201 + gắn · G6 `platform_admin` = người ngoài ⇒ 404 · G7 id trùng khác hoa thường ⇒ 400 ở int (I17). G5 theo #1 | test-plan §9 |
| 13 | Câu chữ UI trỏ `plan-frontend.md` §3 + key `attach.err.missing`. R11: trần 5 file/job, 10 file/tin | spec R11, §5 |

Số ca int sau sửa: I01…I54 trừ I32 = 53.

## Áp từ readiness lần 2 (2026-10-12, điều phối chấp nhận mọi mặc định)
| # | Quyết định | Áp vào |
|---|---|---|
| 14 | E05: stack e2e dùng `FakeRuntime` TS; qc (Q1) thêm op `/rt/output {run_id, name, bytes}` (đặt `token_hash` như `H2c/_h2c2.ts:205`, `POST /internal/jobs/:id/outputs`, rồi `/rt/answer`). Bỏ `#fake:out` ở E05 và spec §7 | test-plan §5, spec §7 |
| 15 | AC06/AC07/AC10 dùng `jobFetch`/`jobOutput`; "deny sandbox" = H2c `files.stack.test.ts` (trong `done:h2c`) | spec §8 |
| 16 | AC16: `!hoa-don` + file ⇒ 400 path `attachment_ids` (I21); không file ⇒ P-a (I51) | spec AC16 |
| 17 | Unit `AttachmentList`/hàm tải 404 ⇒ toast `attach.downloadFailed`; E08 chỉ khẳng định `rooms.toast.kicked` + URL `/c/new` | plan-frontend §8, test-plan E08 |
| 18 | B2 phụ thuộc `B1, Q1`; lệnh xong B1–B6 và spec §8 dùng `--env-file=.env.test-qc.local`; người viết script `done:x2b2` = backend-lead ở B7 | tasks |
| 19 | I17 thêm biến thể id trùng khác hoa/thường ⇒ ×5; G6: I02 có `padmin` nếu fixture có platform_admin, không thì ghi "không kiểm" | test-plan |

## Tranh chấp test (qc, Q1 — 2026-10-12)
- `tests/acceptance/X2b/context.int.test.ts` "X2b-AC11 · attachment_ids vào tin phòng → 400" **xoá** (con trỏ comment `// thay bởi X2b2 I11/I17`; header bỏ "`attachment_ids` → 400") và `tests/acceptance/X2b/rules/contracts-x2b.test.ts` K5 dòng `attachment_ids: [U(11)]` false→**true**, thêm 11 id / trùng ⇒ false. Thay có chủ đích — đối chiếu BA FR-101 + Q9 X2b: test cũ đúng ở X2b, sai sau X2b-2 (X2b2-R01…R04, C-1); không phải code sửa test. Ghi cả ở `X2b-room-agents/spec-decisions.md` §B. "Run phòng không mang file" giữ (đối chứng I41).

## Quyết định qc khi WRITE (Q1, Luật 2)
| # | Quyết định | Lý do |
|---|---|---|
| W1 | "Tenant khác" = `an` (beta) thay `zed` (tenant zeta `active=false`); I02 thêm `padmin` (G6) | tránh đỏ/xanh vì chặn tenant khoá thay vì luật R05 |
| W2 | I21 đặt ở `regress.int` (hub bật engine P-a), không ở `send.int` | D8 chỉ có nghĩa khi `processEngine` bật |
| W3 | Ca có thể xanh vì 400 strict X2a (I02, I17, I21…) thêm bước đối chứng gửi file hợp lệ ⇒ 201 | ca đỏ đúng lý do trước code, xanh khi đúng hành vi |
| W4 | I53 khẳng định 400 `VALIDATION_ERROR` + details path `inputs` | dò hành vi `ownsUpload` hiện có (file người khác ⇒ 400 issues path `["inputs"]`) |
| W5 | `rieng.pdf` (I11, I28, I31) dựng SQL gắn tin H1 `msgU1` như sau E12 thành công | gửi E12 thật mở run Orchestrator, chiếm giới hạn 2 run |
| W6 | e2e: `_x2b2-stack.ts` đặt `HUB_ATTACH_DRIVER/DIR` rồi import `_x2b-stack.ts`; `FakeRuntime(sql, redis, hubUrl?)` + op `output`; cổng riêng 3033/4052/4059/4069/3132; `X2B2_ENV_FILE` chọn DB tag | không nhân đôi stack; không đụng cổng X2b |
| W7 | Setup int + e2e: `hoadon`, `trello` có `allowed_tools [Read, Grep, Write]` | agent ghi `out/` như H2c PL9 |
