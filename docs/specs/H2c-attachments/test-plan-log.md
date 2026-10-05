# Test plan · H2c-attachments — nhật ký §10 (qc)

Tách từ [`test-plan.md`](test-plan.md) §10 ngay từ TEST-PLAN (trần 25 600 B mỗi file). Ghi theo khuôn H2b [`test-plan-log.md`](../H2b-routing/test-plan-log.md).

## 10. Đỏ đúng lý do · nhật ký
Chưa chạy (TEST-PLAN). Sau mỗi nhóm WRITE (QW-R, QW-A1, QW-A2 + MK-U, QW-PU, QW-P): bảng `File · ID · đỏ đúng lý do / tổng · lý do đỏ · xanh trước code (lý do)` + "Lệch plan / cần backend-lead"; DB riêng `ai_system_h2c_<nhóm>_{,hub_}test` (ghi đã drop). Q2/Q-PU/Q3: số dòng `UNLOCKED`/`CHANGED` trước ghi (Q2: đúng 1 `CHANGED tools/hub-dev/src/dify-mock.ts` + hồi quy MK-U xanh), tổng file lock, `git diff tests/.lock` chỉ thêm/đổi đúng các dòng đó. Tranh chấp: bảng TC như H2b (`#`, test, phán quyết, sửa, kết quả; kiểm cả file 3 lần liên tiếp trên DB riêng). I1: bảng 18 bước `done:h2c` (test-plan §7.1).

### Bài học áp dụng từ H2b (kiểm trước khi báo "đỏ đúng lý do")
| # | Bài học | Áp vào H2c |
|---|---|---|
| B1 | TC-3: id cố định trùng giữa ca/lần chạy, key Redis cũ | `crypto.randomUUID()`/`uuid4()` mọi id chèn SQL; id cố định ⇒ `DEL run:<id> sse:<id>` |
| B2 | I1 H2a: DB Hub/Runtime chung DB TS ⇒ `DuplicateTableError` | DB `…_hub_test` riêng (`HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) |
| B3 | `run.ts` Windows → container không thấy env shell | Env DB đặt **trong chuỗi lệnh** truyền cho `run.ts`; chỉ export 4 biến DB, không `source` file có PEM |
| B4 | TC-5/TC-7 (H2a stack): `AGENT_RT_ORPHAN_S=5` với heartbeat mặc định ⇒ job bị coi mồ côi | Đặt `AGENT_RT_HEARTBEAT_S=1` khi hạ orphan |
| B5 | TC-4: Hub chạy host, chỉ container dùng `host.docker.internal` | Catalog `base_url` `localhost`; Runtime `AGENT_RT_HUB_URL`/MK qua `host.docker.internal` + `--add-host …:host-gateway` |
| B6 | TC-3/TC-6: đọc ngay sau đổi cấu hình, điều kiện chờ thoả sớm | Chờ cache Hub ≤ 5 s bằng điều kiện phản ánh **thay đổi cuối**; ca tự dọn ở `finally` |
| B7 | TC-4/TC-7: helper tự chèn dữ liệu sau `counts()`, đếm trước khi run của ca ghi xong | Tạo hội thoại trước `counts()`; `settleRuns` trước khi đếm |
| B8 | Lọc test sai: `bun run test:int <path>` chạy cả repo | `bun --env-file=… --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2c/<file>`; stack/hubdev `--config=bunfig.stack.toml` |
| B9 | AC-08 H2c: ca không dựng được qua int (F15, L4) | Gọi thẳng `fetch_attachments`; không ép int vào nhánh không tới được |

### QW-R · hàm thuần `tests/acceptance/H2c/rules/` (2026-10-05)
`bun test ./tests/acceptance/H2c/rules` → **66 ca / 10 file: 50 đỏ, 16 xanh** (342 `expect`). Không DB/Redis/đĩa. typecheck (`tsc -p tsconfig.tests.json`: 0 lỗi ở `rules/`), biome, `check:size`, `check:fn`, `trace --check` xanh. Helper `rules/_rules.ts` (byte mẫu, `uid` dải `a2c0…`, `payloadInput`, `ch()` code point, `lookup` hàm stub thiếu). Chưa khoá (Q2).

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `attachment-name.test.ts` | R01–R10 | 14/14 | stub `not implemented` (`parseFilenameHeader`, `displayName`, `splitExt`, `extOf`, `safeName`, `contentDisposition`, `difyFileType`) | — |
| `sniff.test.ts` | R11–R16 | 7/7 | stub `isExecutableHead`/`headOk`/`FileInspector.push`/`extOf` | — |
| `run-files.test.ts` | R17–R24 | 10/10 | stub `pickRunFiles`, `jobFileNames`, `jobAttachments`, `*FilesBlock`, `withOutHint`; R21 `orchestratorPrompt` + R24 `buildJobPayload`: `expect` (khối `<attachments>`/khoá `attachments` chưa có — B4/B6) | — |
| `attach-limits.test.ts` | R25–R30 | 6/6 | stub `overQuota`, `parseAttachEnv`, `storageKey`/`keyUnder`, `orphanCandidate`; R27 `expect(msg).not.toMatch(/^not implemented/)` (chặn stub ném "lọt" ca ném) | — |
| `command-input-h2c.test.ts` | R31–R34 | 5/8 | `expect`: `buildInputs` chưa dựng `files`, chưa `invalid` khi lệch map (B7) | R31 hồi quy H2a (vắng/`null`); R32 vắng file → `missing`, tuỳ chọn → ok; R34 `file` không map → `missing` (hành vi H2a đã đúng) |
| `mcp-h2c.test.ts` | R35–R38 | 3/6 | R35 `hasFiles` false/true + R36 `withFiles`: `expect` (tham số chưa dùng — B8); R37 stub `fileArg` | R35 `hasFiles` vắng (H2a); R36 `withFiles` vắng (H2a); R38 `TOOL_FILE_TEXT` (hằng có từ B0) |
| `dify-upload.test.ts` | R39–R40 | 2/2 | **module `dify/dify-upload.ts` chưa có** → nạp động, ném `not implemented: dify/dify-upload.ts (stub thiếu)` | — |
| `run-errors-h2c.test.ts` | R41 | 1/2 | `expect`: hint `file_rejected` chưa có | R41 vế hồi quy (7 mã × 2 locale, `refused` H2b) |
| `messages-h2c.test.ts` | R42–R43 | 2/3 | R42 `expect` (`toMessage` bỏ qua tham số `refs`); R43 `toAttachmentRef` **chưa có** → `lookup` ném `not implemented` | R42 `refs` vắng/`[]` → y hệt H2b |
| `contracts-h2c.test.ts` | R44–R49 | 0/8 | — | cả 8: contract C2 (`b3658f0`) đã có hằng/schema/fixture — xanh đúng (P2 chỉ thêm) |

**Lệch plan / cần backend-lead** (stub B0 `3f54974` thiếu so với plan-rules; test viết theo plan-rules, biên dịch được, đỏ nêu rõ "stub thiếu"):
1. `apps/hub-api/src/modules/dify/dify-upload.ts` (`mapDifyUploadError`, `difyUploadId`, plan-rules §5) **không tồn tại** — test nạp động `import(MODULE)`; khi thêm file đúng đường dẫn/tên export, test chạy thẳng.
2. `conversations.rules.ts`: thiếu `toAttachmentRef` và tham số thứ 4 `refs?: readonly AttachmentRef[]` của `toMessage` — test gọi qua `lookup`/kiểu hàm rộng hơn (gán được).
3. `orchestrator.prompt.ts` `PromptInput.attachments?` và `runner.rules.ts` `PayloadInput.attachments?` chưa khai báo — test truyền qua `as PromptInput`/`as PayloadInput`.
4. `mcp.rules.ts` `toolInputSchema(inputs, withFiles)`: plan-rules dùng `i.description ?? i.name` nhưng `WorkflowInput.description` bắt buộc (contract M2) — R36 dựng input thiếu mô tả bằng ép kiểu; nếu catalog luôn có mô tả, nhánh `?? i.name` chỉ là phòng thủ.
