# Readiness — H4a-studio-shell-agents

## Lần 1 · 2026-10-06 · spec-readiness (Opus) · **NOT READY**

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/H4a-studio-shell-agents/` tới `fe05182` · 6 file (spec, tasks, plan, plan-frontend, plan-frontend-copy, test-plan) · mã yêu cầu: HUB-FR-72/60/61/62/64/69/90, HUB-BR-08/09/06. Đối chiếu: BA §9.3, ui-agent-studio §13, `migrations-hub/0000` (CHECK agents/orchestrator_settings, FK xoá agent), `0006` (sequence + `orchestrator_settings_tenant_uq`), `contracts/hub/common.ts` (`AgentKeySchema`, `ALLOWED_TOOLS`), `config.rules.ts` (`orchestratorProblem` :78, `pickOrchestrator` :100), admin-api auth (mã `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `TEMP_LOCKED`), `packages/i18n/package.json` exports, cổng 3001/4020 (`rsbuild.config.ts`, `.env.example`). Symbol plan trỏ tới đều có thật.

Lý do NOT READY: (1) mọi câu hỏi mở (Q1–Q10, QB1–QB7, QF1–QF3) mới là **mặc định đề xuất, người dùng chưa chấp nhận** → theo luật strict #3 và Luật 2b không tự duyệt được; (2) còn 4 lỗ hổng Chặn có hai cách hiểu giữa các tài liệu.

## Lỗ hổng
Nhóm: **(a)** chỉ sửa tài liệu cho nhất quán, không cần người dùng · **(b)** cần người dùng quyết (gộp ở mục "Câu hỏi cho người dùng").

| # | Mức | Nhóm | Mục | Vị trí | Vấn đề | Mặc định đề xuất | Ai sửa |
|---|---|---|---|---|---|---|---|
| K1 | Chặn | a (sau U1) | D/I | spec R03, R07 ↔ spec §3 :79, plan §2.3–2.4, P8 · plan-frontend §4 :92–103 · copy `editor.counter` "/1000" · plan-frontend §4 "mô tả < 20 chỉ cảnh báo" | Hai bộ số cho cùng trường: key `_`/2–40 vs `^[a-z][a-z0-9-]{1,47}$`; mô tả 1–1000 (cảnh báo < 20) vs 20–400 chặn; timeout 1 vs 10; `history_n` 0 vs 1. QF1 "theo spec/contract" không chọn được vì spec tự mâu thuẫn | Theo DB/contract (QB2): sửa R03/R07 ra đúng số §3; plan-frontend §4 + câu VI/EN theo contract (key 2–48 không `_`, mô tả 20–400 **chặn**, câu "Mô tả từ 20 đến 400 ký tự", timeout 10–3600, `history_n` 1–50); counter "/400" | docs-architect (R03/R07) + frontend-lead (§4, copy) |
| K2 | Chặn | b (U2) | D/I | spec R07 "runtime `llm`/`agentic-cli`" · plan-frontend §3 :73, :84 (menu + select Orchestrator lọc `llm`/`agentic-cli`) ↔ QB1/P9 chỉ `agentic-cli` | UI cho chọn `llm` rồi nhận 409; `ORCHESTRATOR_RUNTIMES` chỉ export từ `hub-api` `config.rules.ts`, FE không import được | Chỉ `agentic-cli`; chuyển `ORCHESTRATOR_RUNTIMES` vào `@ai/contracts/studio` (hub `config.rules` import lại); FE lọc theo hằng đó; sửa R07 | backend-lead (P9, §2.2) + frontend-lead (§3) + docs-architect (R07) |
| K3 | Chặn | a | B | spec §3 :66 + plan §2.3 `AgentListQuerySchema` `limit … = 50` ↔ plan §2.3 `AgentListItem` "mặc định **200** (E1)", plan §12, test A05 (G1) · plan-frontend §8 "> 200 → lỗi đề xuất E1" | Mặc định `limit` 50 hay 200; FE lọc client nên 50 làm sai danh sách. FE khi `truncated=true` làm gì: không viết | `limit` 1–200 = **200** ở spec §3 + `AgentListQuerySchema`; FE khi `truncated=true`: Alert vàng "Chỉ hiện 200 agent đầu. Dùng ô tìm để lọc trên máy chủ." (EN "Showing the first 200 agents. Use search to filter on the server.") và ô tìm chuyển sang `?q=` server | backend-lead (spec §3, plan §2.3) + frontend-lead (§3, copy) |
| K4 | Chặn | b (U3) | G/H | spec Q10 "ép sửa file chung → dừng và hỏi" ↔ plan-frontend D8 (thêm export `./studio-locales` vào `packages/i18n/package.json` + nhánh `studio/` trong `tools/scripts/src/i18n-check.ts`) · tasks F1 cột File thiếu `packages/i18n/package.json` | F1 không thể chạy tới cuối mà không dừng hỏi | Cho phép **chỉ thêm** (1 dòng export + 1 nhánh, mẫu `chat-locales`/`CHAT_DIR`), không đổi chuỗi Admin/Chat; tasks F1 thêm `packages/i18n/package.json` | người dùng → frontend-lead (tasks F1) |
| H1 | Cao | a | E/J | plan-frontend §6 :119 · copy `conflict.*` "chép cấu trúc Admin" | ConflictDialog: "Ghi đè" và "Xem khác biệt" làm gì chưa viết; câu chữ không nguyên văn | "Ghi đè" = gửi lại bản nháp với `version = details.current.version`; "Xem khác biệt" = bảng trường khác nhau (nháp ↔ `current`); "Tải bản mới" = nạp `current`, bỏ nháp. Chép nguyên văn VI/EN từ `packages/i18n/locales/{vi,en}.json` `conflict.*` vào copy | frontend-lead |
| H2 | Cao | a | B/J | plan-frontend §10 E5 `locked`, E8 `AGENT_KEY_EXISTS`, `details.fields` · copy bảng lỗi `VALIDATION_ERROR {fields}` ↔ plan §12 `active`, `KEY_TAKEN`, `details.issues[{path,code,message}]` | FE đọc tài liệu FE sẽ code sai mã/trường; copy thiếu câu cho `KEY_TAKEN`, `AGENT_NOT_ORCHESTRATABLE{reason}`, `ORCHESTRATOR_DEFAULT_PROTECTED`, `TENANT_INACTIVE`, `INTERNAL_ERROR` | Sửa §10 thành "đã chốt theo plan §12"; copy thêm 5 dòng (KEY_TAKEN = câu "Key đã được dùng bởi agent khác"; NOT_ORCHESTRATABLE: "Agent này chưa làm Orchestrator được (đang tắt hoặc runtime chưa hỗ trợ)."; DEFAULT_PROTECTED: "Không xoá được Orchestrator mặc định."; TENANT_INACTIVE: "Tenant đang bị khoá."; INTERNAL_ERROR → `login.err.server`) + EN; map `issues[].path` → trường | frontend-lead |
| H3 | Cao | a | H2 | plan §4.1 (G3, G4, G5, G7 test-plan §8) | Chữ ký hàm thuần chưa đủ: kiểu vào `agentWarnings`, kiểu trả `similarAgents`, `ids` cho reason ≠ `not_found`, `dify-*` có `runtime_not_ready` không | Ghi đúng mặc định qc đã dùng: `agentWarnings(a: {runtime, runtime_options})`; `similarAgents` → `{agent_id, agent_key, score}[]` sắp giảm ≤ 5; `ids` chỉ có khi `not_found`; dify-* không cảnh báo | backend-lead |
| H4 | Cao | a | J | copy `login.totp.*` "theo Admin", `login.err.*` | Không nguyên văn TOTP; không ghi map mã admin-api → câu (`INVALID_CREDENTIALS`, `ACCOUNT_LOCKED`, `TEMP_LOCKED` + `{time}` lấy từ đâu, 429) | Chép nguyên văn `auth.login.totp.*` vào copy; bảng map: INVALID_CREDENTIALS→invalid, ACCOUNT_LOCKED→locked, TEMP_LOCKED→tempLocked (`{time}` = `details.until` HH:MM giờ trình duyệt, như `admin-web/src/lib/errors.ts`), INVALID_OTP→`totp.wrong`, INVALID_TOTP_TOKEN→về form mật khẩu, lỗi mạng→network, khác→server | frontend-lead |
| H5 | Cao | a | G | spec §7 :121 (`PUBLIC_ADMIN_API_URL`, `PUBLIC_HUB_URL`) ↔ plan-frontend D3/D4/§2 (đường tương đối, `PUBLIC_AUTH_URL`, `PUBLIC_CHAT_WEB_URL`, proxy `ADMIN_API_URL`=3001, `HUB_URL`=4020) | Danh sách env lệch; thiếu giá trị dev mặc định | spec §7 theo plan-frontend: `PUBLIC_AUTH_URL` (vắng = tương đối), `PUBLIC_ADMIN_WEB_URL` (dev `http://localhost:3000`), `PUBLIC_CHAT_WEB_URL` (dev `http://localhost:3100`), build-time `ADMIN_API_URL`=`http://localhost:3001`, `HUB_URL`=`http://localhost:4020`; bỏ `PUBLIC_ADMIN_API_URL`, `PUBLIC_HUB_URL` | docs-architect |
| M1 | Trung | a | E | plan-frontend §3 :85 Sheet tenant | Giá trị khởi tạo form bản tenant mới chưa ghi | Điền sẵn từ bản mặc định (agent, max_steps, token_budget, history_n, on_no_match) | frontend-lead |
| M2 | Trung | a | F/H | spec §8 :140 + tasks Q1 `bunx playwright test studio` ↔ test-plan §6 `-c e2e/studio/playwright.config.ts`; `tools/scripts/src/done-h4a.ts`, script gốc `done:h4a`/`e2e:studio`, depcruise rule studio-web không nằm ở cột File task nào (I1 "—") | Lệnh xong không chạy được như ghi; file không có chủ | spec §8/tasks dùng `bun run e2e:studio`; I1 cột File: `tools/scripts/src/done-h4a.ts`, `package.json` (2 script); F1 thêm file cấu hình depcruise | docs-architect (spec, tasks) + qc |
| M3 | Trung | a | F | test-plan §3.1 R12, §8 G12 | Chưa có ca: Nhân bản (R12), Đặt làm Orchestrator (QF3), TOTP (QF2), Hoàn tác tắt, banner mất mạng, Sheet tenant | qc thêm E12–E17 trước LOCK | qc |
| L1 | Thấp | a | I | spec §8 "spec-ac.md" ↔ test-plan G8 | AC chi tiết ở test-plan §3 | Sửa spec §8 trỏ test-plan §3 | docs-architect |
| L2 | Thấp | a | I | BA §9.3 | 11 mã lỗi Studio mới không có trong BA | CR ở I3 thêm vào BA §9.3 | docs-architect |
| L3 | Thấp | a | I | ui §13 (key `^[a-z0-9-]{2,32}$`, `max_steps` 1–10, Orchestrator "có profile") | ui lệch contract | CR sửa ui §13 ở I3 (QF1) | docs-architect |
| L4 | Thấp | a | A | spec R02 `{user_id, role, hub_config_version}` ↔ §3/plan `MeSchema` (+ tenant_id, tenant_key, username, display_name) | Thiếu trường trong R02 | R02 trỏ `MeSchema` | docs-architect |
| L5 | Thấp | a | H | tasks: task `Q1` trùng tên câu hỏi Q1 | Dễ nhầm | Đổi task thành `QC1` | docs-architect |

## Mâu thuẫn giữa tài liệu
- spec R03/R07 + plan-frontend §4 ↔ spec §3 + plan + DB CHECK → giữ DB (K1).
- spec R07 + plan-frontend §3 (`llm` làm Orchestrator) ↔ QB1/P9 → giữ `agentic-cli` nếu U2 đồng ý (K2).
- spec §3 + `AgentListQuerySchema` (50) ↔ plan E1/§2.5/test A05 (200) → giữ 200 (K3).
- plan-frontend §10 E5/E8 ↔ plan §12 → giữ plan §12 (H2).
- spec §7 env ↔ plan-frontend D3/D4 → giữ plan-frontend (H5).
- Q10 ↔ D8 → chờ U3 (K4).

## Câu hỏi cho người dùng (gộp tối thiểu)
1. **U1** — Chấp nhận nguyên gói mặc định Q1–Q9, QB2–QB7, QF1–QF3 (gồm xoá agent **cứng có điều kiện** Q6, audit cấu hình toàn hệ thống `tenant_id` NULL QB6, lưu được tool `Edit`/`Bash` kèm cảnh báo QB7) và G1–G13 của qc? Mặc định: **có**.
2. **U2 (QB1)** — Tới khi `llm` chạy được, chỉ agent `agentic-cli` được làm Orchestrator (thu hẹp CR-020 "chọn một agent")? Mặc định: **có**, mở lại = sửa một hằng.
3. **U3 (Q10)** — Cho phép F1 **thêm** 1 dòng export vào `packages/i18n/package.json` và 1 nhánh `studio/` vào `tools/scripts/src/i18n-check.ts` (không đổi chuỗi Admin/Chat)? Mặc định: **có**.
4. **U4 (Q3/D4)** — Prod: chấp nhận cần reverse proxy `/auth` → admin-api cùng origin Hub (ghi PRODUCTION-NOTES); thiếu thì Studio reload = đăng nhập lại tới CR-044? Mặc định: **có**.

## Checklist
| Mục | Kết quả | Bằng chứng |
|---|---|---|
| A Phạm vi | Đạt | spec §1 :22–39, frontmatter :7 |
| B Contract | Mâu thuẫn | K3, H2 (plan §2–§3 đủ còn lại) |
| C Dữ liệu | Đạt | spec §4, plan §6 D1–D4, FK `0000`:113/123/192/197/244, `0006`:38–57 |
| D Nghiệp vụ | Mâu thuẫn | K1, K2 |
| E UI | Thiếu | H1, M1 (trạng thái đủ: plan-frontend §3) |
| F Kiểm chứng | Thiếu | M2, M3 (AC→test: test-plan §3) |
| G Phụ thuộc & môi trường | Mâu thuẫn | H5, K4 (mock: spec §7, test-plan §2) |
| H2 Vai trò | Thiếu | H3 (spec §3–5 đã điền, test-plan có) |
| H Task | Thiếu | K4, M2 (cột Rủi ro có, đúng định nghĩa) |
| I Nhất quán | Mâu thuẫn | K1–K3, H2, L1–L5; câu hỏi mở chưa được chấp nhận |
| J Độ chính xác | Thiếu | H1, H2, H4 |

## Quét từ mơ hồ
28 kết quả; vô hại (câu chữ UI có "…", "vài giây" trong `orch.slow` là copy, "tuỳ chọn" = optional field, "…" trong mã yêu cầu/đường dẫn). Ghi thành lỗ hổng: plan-frontend :73, :84 (K2), :133 "> 200 → lỗi đề xuất E1" (K3).

## Kích thước
spec 22 187 · plan 29 261 · plan-frontend 23 981 · test-plan 17 771 · copy 14 458 · tasks 7 909 B — trong trần (plan sát 30 720).

## Chưa kiểm
Canvas `*.dc.html` (đối chiếu nhãn e2e ↔ artboard); nội dung test đã viết ở `tests/acceptance/H4a/`, `e2e/studio/` (chỉ đọc test-plan); `conflict.*`/`auth.login.totp.*` trong `packages/i18n/locales` chỉ xác nhận có file.

---

## Lần 2 · 2026-10-06 · spec-readiness (Opus) · **READY**

## Kết luận: READY
Phạm vi đã kiểm: `git diff fca5271..HEAD` (4ed0fc6, 0f6a53c, afffca3, 7509496) trên `docs/specs/H4a-studio-shell-agents/` (6 file đổi), `ba-agent-hub.md` §9.3, `CHANGE-REQUESTS.md` CR-045, `e2e/studio/*` + 18 lỗ hổng mở của lần 1 · mã yêu cầu: HUB-FR-72/60/61/62/64/69/90. Đối chiếu thêm: `packages/i18n/locales/vi.json` (`conflict.*` :1180–1183, `auth.login.totp.*` :78–86 — copy chép đúng nguyên văn), `.dependency-cruiser.cjs` (có thật), tasks B2 (contract `common.ts`).

Quyết định người dùng 2026-10-06 đã ghi vào spec §9 (U1–U4), plan §11, plan-frontend D4/D8/D12/§12 → mọi Q/QB/QF/G đóng theo luật strict #3. Không còn Chặn/Cao.

### Đóng từ lần 1
K1 (spec R03/R07 + plan-frontend §4 + copy "/400" theo DB) · K2 (R07, P9, plan §2.2, D12: chỉ `agentic-cli`, hằng ở `@ai/contracts/studio`) · K3 (`limit` = 200 ở spec §3 + `AgentListQuerySchema`; `truncated` → Alert `agents.truncated` + lọc `?q=` debounce 300 ms) · K4 (U3; tasks F1 có `packages/i18n/package.json`) · H1 (plan-frontend §6 hàng Xung đột + copy `conflict.*`) · H2 (§10 E5/E6/E8 theo plan §12; copy thêm 5 mã) · H3 (plan §4.1 G3/G4/G5/G7) · H4 (copy `login.totp.*` + bảng map lỗi đăng nhập) · H5 (spec §7 theo D3/D4) · M1 (Sheet điền sẵn từ bản mặc định) · M2 (spec §8, tasks QC1/I1, test-plan §6: `bun run e2e:studio`, `done-h4a.ts`) · M3 (E12–E17, E13b; 19 ca e2e) · L1 · L2 (BA §9.3 đã áp) · L4 (R02) · L5 (QC1).

## Lỗ hổng
| # | Mức | Mục | Vị trí | Vấn đề | Mặc định (sửa trong BUILD, không chặn) |
|---|---|---|---|---|---|
| N1 | Trung | Kích thước | `plan.md` 30 723 B > 30 720 B | Vượt trần 3 byte (WORKFLOW Kỷ luật token #5) | backend-lead rút ≥ 3 byte ở lần sửa plan kế tiếp (vd. bỏ một chú thích trong §11); không tách phụ lục |
| N2 | Trung | H/I | tasks B6 "export `ORCHESTRATOR_RUNTIMES` từ `config.rules.ts`" ↔ tasks đầu bảng, plan P9/§2.2, D12 (định nghĩa ở `@ai/contracts/studio` `common.ts`) | Câu task cũ chưa sửa | Theo P9: B2 định nghĩa hằng trong `packages/contracts/src/studio/common.ts`; B6 chỉ cho `config.rules.ts` import lại (không export từ hub) |
| N3 | Trung | E/J | plan-frontend §6 hàng Agents/Orchestrator/Đăng nhập ↔ e2e `agents-menu.studio.ts`:38–63, `auth.studio.ts`:94, `orchestrator.studio.ts`:30–31 | 4 nhãn qc tự đặt chưa có ở §6: ConfirmDialog "Đặt làm Orchestrator" (`alertdialog`, nút "Huỷ"/"Đặt làm Orchestrator"); menuitem cho agent không đủ điều kiện ẩn hoặc disabled; TOTP sai mã hiện `alert`; option `combobox "Tenant"` chứa key tenant | frontend-lead chấp nhận đúng 4 mặc định qc và thêm vào §6 ở F3/F6/F2: ConfirmDialog = `alertdialog` + "Huỷ"/"Đặt làm Orchestrator"; menuitem **ẩn** khi agent tắt hoặc runtime ∉ `ORCHESTRATOR_RUNTIMES`; `login.totp.wrong` trong `role="alert"`; nhãn option "{name} ({key})" |
| N4 | Thấp | I | test-plan §4 tiêu đề "Q10 … còn chờ" | Sai: Q10 đã chốt qua U3 | qc sửa chữ: "Q10 chốt qua U3" |
| N5 | Thấp | I | spec §3 hàng `GET /studio/api/me` `Me {user_id, tenant_id, role, hub_config_version}` ↔ R02/plan §2.2 `MeSchema` | Liệt kê thiếu trường | Theo `MeSchema` (plan §2.2) |
| N6 | Thấp | I | ui-agent-studio §13 (CR-045 mục 2) | Chưa sửa theo DB/contract | Áp ở I3 như CR-045 ghi |
| N7 | Thấp | H | tasks F1 "file cấu hình depcruise gốc" | Không nêu tên file | `.dependency-cruiser.cjs` |

## Mâu thuẫn giữa tài liệu
- tasks B6 ↔ plan P9/D12 → giữ P9 (N2).
- test-plan §4 "Q10 còn chờ" ↔ spec §9 U3 → giữ U3 (N4).
- spec §3 `Me` ↔ `MeSchema` → giữ `MeSchema` (N5).

## Câu hỏi cho người dùng
Không có câu hỏi mới.

## Checklist
| Mục | Kết quả | Bằng chứng |
|---|---|---|
| A Phạm vi | Đạt | spec §1; R02 trỏ `MeSchema` |
| B Contract | Đạt | spec §3 `limit = 200`; plan §2.3, §12; copy bảng lỗi (KEY_TAKEN, NOT_ORCHESTRATABLE, DEFAULT_PROTECTED, TENANT_INACTIVE, INTERNAL_ERROR) |
| C Dữ liệu | Đạt | không đổi từ lần 1 |
| D Nghiệp vụ | Đạt | spec R03/R07 = §3 = plan P8/P9 |
| E UI | Đạt (N3 Trung) | plan-frontend §3 (truncated, Sheet M1), §6 Xung đột |
| F Kiểm chứng | Đạt | test-plan §3 (AC-02, AC-08 + E12–E17), §6 bảng 7 bước |
| G Phụ thuộc & môi trường | Đạt | spec §7 env + giá trị dev; U3, U4 |
| H2 Vai trò | Đạt | plan §4.1 chữ ký đủ (G3–G7) |
| H Task | Đạt (N2, N7) | tasks F1 (U3 file), QC1, I1 có file |
| I Nhất quán | Đạt (N4–N6 Thấp) | BA §9.3, CR-045 |
| J Độ chính xác | Đạt | copy `login.totp.*`, map lỗi đăng nhập, `conflict.*` nguyên văn |

## Quét từ mơ hồ
6 kết quả trên dòng thêm mới; vô hại ("nên" = "vì vậy"; "…" trong danh sách `path` ví dụ — luật map theo `path` tổng quát; tiêu đề test-plan §4 ghi ở N4).

## Kích thước
spec 24 479 · plan **30 723** (N1) · plan-frontend 25 122 · plan-frontend-copy 18 609 · test-plan 19 136 · tasks 8 638 B.

## Chưa kiểm
Canvas `*.dc.html`; thân test `tests/acceptance/H4a/` (chỉ đối chiếu nhãn e2e ở `e2e/studio/` với plan-frontend §6).
