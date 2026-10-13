# Test plan · K1-knowledgehub (qc)

Chế độ **WRITE + LOCK** (T2, viết lại theo **CR-073** — siêu tối giản) · 2026-10-13. "Đúng" = spec §2 (luật còn hiệu lực theo CR-073), §3.0 (giao thức KH `X-KH-Key`), §3.1–3.5 (contract), §4 (dữ liệu, `snapshot.kh`, `used_by`), §8 (K1-AC01…09), §9 (Q1–Q34) · `plan.md` §2 (chữ ký hàm thuần), §3.1 (6 bước, 7 lỗi + 5 cảnh báo), §3.4 (câu tool EN), §3.5, §4 (audit), §5 (DDL — chỉ để dựng fixture), §6 (seed, tenant `evolu`) · `plan-frontend.md` §2–§5 (`a24f9df8`, nhãn e2e VI) + mockup https://claude.ai/artifact/MHUei1vhi2WHKqYWi21WFQ · KH thật cho hình response: `ai-sdlc-rowan/POC/KnowledgeHub/main.py` (gate `X-KH-Key`, `/health`, `/version`, `/vector/*`), `app/schemas.py`, `app/projects.py` (`GET /projects`). Hộp đen: không đọc code implementation.

## 1. Quy ước
Như H4b-1 §1 (tên test có mã, chờ theo điều kiện, cấm `skip/only/todo`, id cố định), thêm:

| Mục | Quy ước K1 |
|---|---|
| Tên test | `"<mã BA> · [K1-ACxx ·] [Qxx ·] <ID> · mô tả"` — `HUB-FR-131` kết nối/kiểm tra · `HUB-FR-132` gắn agent/`kh-query` · `HUB-FR-133` Tóm tắt · `HUB-FR-134` hạ cấp · `HUB-BR-31` ≤ 5 lần · `HUB-BR-36`/`HUB-BR-30` không lộ khoá · `HUB-BR-37`/`HUB-BR-40` egress/auth KH · `CR-070` seed |
| Loại | **R** hàm thuần + contract (`bun test`, nạp động — module chưa có ⇒ đỏ ở `fn()`/`schema()`) · **A** int hub-api thật + DB tag riêng + 2 KH GIẢ (`bun run test:int`) · **E** e2e Playwright: studio-web `page.route` (config studio); admin-web/chat-web trên stack P-b2 thật + `page.route` vá `StageView.knowledge` |
| Vị trí | R `tests/acceptance/K1/rules/*.test.ts` · A `tests/acceptance/K1/*.int.test.ts` · E `e2e/studio/k1-knowledgehub.studio.ts` (+ `_k1-kh.ts`), `e2e/K1/{admin,chat}/notice.k1.ts` (config `e2e/K1/playwright.k1.config.ts`) |
| Id cố định | int `c1a1…` (`_k1.ts`), e2e studio `e1a1…`, tenant evolu (seed) `c1a1…0e7010` |
| Chưa có bảng | `needK1()` đầu mỗi ca: `{migration0029, hubSecrets}` ⇒ trước code đỏ ở expect, không `PostgresError` trong `beforeAll` (fixture K1 chỉ chèn khi bảng có) |
| Chuỗi quét | khoá KH `qc-K1-key{A,B}-Zx9Pq7Lm-kh`, khoá sai `qc-K1-wrong-Zx9Pq7Lm-kh` |
| Tenant | int/e2e dùng tenant test cách ly (acme, fixture P-a/P-b2); **seed mẫu kiểm trên `evolu`** (A123, người dùng 2026-10-13); UAT trên evolu là việc của `qc-uat` |

## 2. Hạ tầng
- **`_khfake.ts` — KH GIẢ của qc** (Bun.serve cổng 0, trạng thái bộ nhớ, ĐỘC LẬP mock sản phẩm `tools/mocks/src/kh`): gate khoá chung y `main.py` (`X-KH-Key` hoặc `Bearer`, sai/thiếu ⇒ `401 {"detail":"missing or invalid API key"}`, trừ `/health`); `/health {status, model}`, `/version {version, source, model}`, `/projects {version, projects: {<id>: …}, store}`, `POST /vector/query {text, project, k, max_chars}` ⇒ `{hits[{vector_id, score, source_text, summary, truncated}]}` (project khoá không thấy ⇒ 403), `POST /vector/add` upsert theo `id` ⇒ `{status, vector_id, dimension}`. Điều khiển: `auth` (tắt xác thực), `sso` (khoá tĩnh luôn 401, Q27), `version`, `model`, `healthStatus`, `projectsStatus`, `projects`, `hits`, `scenario` (`ok · server_error · server_error_once · rate_limited · not_found · forbidden · timeout · bad_body` cho `/vector/*`), `slow` (mọi route trễ). Ghi `calls` (có khoá không, header nào, khoá đúng không — không lưu giá trị khoá; body; status) + `vectors` (số lần ghi mỗi `id`).
- **`_k1.ts`**: `startK1({seed})` = `setupPa()` + `seedPf1` + def `k1-auto` (a0 hd-read, a1 hd-post) / `k1-gate` (g0 review Kế toán) + agent `k1-llm` + secret (khi `hub.secrets` có): `kh_api_key` nền tảng `secMain`=KEY.a, `secAlt`=KEY.b, `secWrong`, `secMain2`; `kh_api_key` tenant acme `secTenant`; `provider_api_key` `secProv`. Hai KH giả: **A** `http://localhost:<p>` khoá KEY.a thấy `proj-a, proj-b`; **B** `http://127.0.0.1:<p>` khoá KEY.b thấy `proj-c`. Seed `full` (khi 0029 có): `kh-main` → A (summary `proj-a`, ok), `kh-alt` → B (summary null, ok); hd-read tick `[main]`, hd-post tick `[alt, main]`. hub-api in-process, seam: **`kh: {allowedOrigins, timeoutMs: 1000}`** (G1), `hubSecretsKey`, `publicInternalUrl`, `processLoops:false`, `onProcessHandles` (**`khWriteOnce`**, G2).
- **`_run.ts`**: bắt đầu run ở phòng R, claim job stage bằng Runtime giả, token job, `kh-query`/`tools/list` qua `/mcp` (helper H2a), chấm gate, đọc `kh_jobs`/`kh_writes`/`kh_stage_usage`, `settle`.
- Fixture SQL (`seedConn`, `tick`, cập nhật `kh_connections`/`kh_writes`) chạy thử trên DDL nháp theo plan §5 trong một tx ROLLBACK trên DB qc — 0 lỗi (§7).

## 3. Ma trận AC → test
| AC | Then (chi tiết qc, theo CR-073) | Loại · file | Ca |
|---|---|---|---|
| K1-AC01 | KH hợp lệ ⇒ ok (`projects`, `kh_version`, `embedder`); 7 mã lỗi (URL, mạng, timeout, auth tắt, khoá không đọc được, khoá bị từ chối/SSO, version) + 5 cảnh báo (auth tắt loopback dev, embedder tiếng Anh, project rỗng/> 50, summary_project khoá không thấy); `/version` không khoá phải 401; khoá qua `X-KH-Key` | R `kh-check-rules`, `kh-rules` · A `check` · E studio | R01–R07, R30–R41 · A20–A31 · E07–E08 |
| K1-AC02 | `kh-query` dùng khoá của đúng kết nối; chỉ KH agent đã tick ∩ dùng được; ≥ 2 KH ⇒ nhãn `<kết nối>/<project>`, đúng KH nhận lời gọi; project ngoài nhãn ⇒ `KH_PROJECT`; KH từ chối project ⇒ hạ cấp; không cách ly theo công ty (chấp nhận) | R `kh-agent-rules` · A `query` | R51–R58 · A40–A45, A49 |
| K1-AC03 | Khoá KH không ở response/log/audit/bảng `hub.*`/payload job/prompt/`/mcp`/thân lời gọi KH; chỉ ở header `X-KH-Key` | R `kh-rules` · A `noleak`, `check` | R11 · A21, A80–A82 |
| K1-AC04 | 5 lần OK (`calls_left` 4…0), lần 6 `KH_LIMIT` không gọi KH; 7 song song ⇒ đúng 5; ghép ≤ 4000 ký tự; tham số sai / `KH_PROJECT` / `disabled` không đếm; đếm theo (stage_run, attempt, round) | R `kh-query-rules`, `contracts-k1` · A `query` | R60–R62, R89 · A45–A48, A50, A52 |
| K1-AC05 | auto / gate Đạt ⇒ `kh_writes` + `POST /vector/add` subject `<quy trình>/<stage>`, `id = kw-<run>-<stage_run>-v<n>`; gate chờ/trượt ⇒ không; không đích ⇒ không; gửi lại ⇒ cùng id, KH 1 vector | R `kh-summary-rules` · A `worklog` | R70–R74 · A63–A67 |
| K1-AC06 | KH 500/429/403/timeout/body sai/origin chết ⇒ `KH_UNAVAILABLE`, `last_warning`, audit `degrade`, stage xong; kết nối hết dùng được ⇒ `disabled`; ghi lỗi ⇒ thử lại ≤ 5, 4xx ⇒ `failed` ngay, audit `write_fail`, `skipped`; UI cảnh báo | R `kh-rules` · A `query`, `worklog` · E admin, chat | R08–R10 · A49–A51, A68–A71 · E20, E30 |
| K1-AC07 | KH đầu tiên (thứ tự tick, dùng được) có summary_project ⇒ `snapshot.kh` + "Tóm tắt" bắt buộc + prompt nhắc; không có / không dùng được / stage nhóm ⇒ không; def gốc không đổi | R `kh-agent-rules`, `kh-summary-rules` · A `worklog` · E chat | R56, R75–R77 · A60–A62 · E30–E31 (`write_to`) |
| K1-AC08 | `sdlc-delivery` 9 stage, `bug-fix` 6 stage đúng plan §6, hợp `ProcessStageDefSchema` + `processDefStageIssues` = []; `sdlc` 8 stage; seed lần 2 không nhân đôi; **chép vào tenant `evolu`** (không acme/beta) | A `seed` | A120–A123 |
| K1-AC09a | xoá `kh_api_key` đang được kết nối trỏ ⇒ 409 `SECRET_IN_USE`, `used_by = [{type: knowledge_hub, id: kết nối, key: tên}]` | A `studio` | A14 |
| K1-AC09b | (H4b-1 Q12) `work/<job_id>/` dựng như Runtime từ những gì Hub giao cho job không chứa khoá | A `noleak` | A82 |

### 3.1 Luật / FR → ca
| Luật | Ca |
|---|---|
| HUB-FR-131 CRUD kết nối (URL allowlist/https, `KH_SECRET_INVALID`, `KH_CONNECTION_EXISTS`, đổi URL/khoá ⇒ unchecked, `IN_USE`, list/cursor, quyền) | R01–R03, R11, R80, R84–R86, A01–A10, E01–E06, E09 |
| HUB-FR-131 Kiểm tra (6 bước, 7 lỗi + 5 cảnh báo, lưu không bump) | R04, R07, R30–R41, R81–R82, A20–A31, E07–E08 |
| HUB-FR-132 gắn agent (≤ 5, thứ tự, agentic-cli, version) | R50, R88, A11–A13, E10–E12 |
| HUB-FR-132 `kh-query` (KH của job, `/projects` cache, nhãn, mặc định, đếm, ghép) | R05–R06, R51–R58, R60–R62, R89, A40–A48, A52 |
| HUB-FR-133 Tóm tắt (đích, `snapshot.kh`, `ensureSummary`, ghi idempotent, cắt 200 từ) | R56, R70–R77, A60–A67 |
| HUB-FR-134 hạ cấp + phân loại lỗi + thử lại ghi | R08–R10, R83, R87, A49–A51, A68–A71, E20–E21, E30–E31 |
| HUB-BR-31 ≤ 5 lần/stage nguyên tử | A46–A47, A52 |
| HUB-BR-36 / HUB-BR-30 không lộ khoá | R11, A01, A22, A80–A82 |
| HUB-BR-37 / HUB-BR-40 egress, `redirect`, auth KH bắt buộc (Q28), SSO (Q27) | R01–R03, R34–R36, A05, A21, A24–A26, A30 |
| Q34 "dùng được" (`status ok` ∧ URL lúc gọi) | R05, A08, A41, A50, A61, A71 |
| Q8 stage nhóm | R76, A62 |
| §3.5 audit (`create/update/delete/check/degrade/write_fail`, entity `kh_connection/kh_query/kh_worklog/agent`) | A01, A10, A11, A22, A49, A69–A71 |
| CR-070 seed + tenant evolu | A120–A123 |

FR MUST trong phạm vi (HUB-FR-131, 132, 133, 134): **4/4 có test**. HUB-FR-137 (client `/v1` + token) bị CR-073/Q26 thay bằng `X-KH-Key` ⇒ phủ bằng A21/A80 (xem §8 G11).

## 4. Danh sách ca
| Nhóm | File | Ca |
|---|---|---|
| R | `rules/kh-rules.test.ts` | R01–R11 (11) |
| R | `rules/kh-check-rules.test.ts` | R30–R41 (12) |
| R | `rules/kh-agent-rules.test.ts` | R50–R58 (9) |
| R | `rules/kh-query-rules.test.ts` | R60–R62 (3) |
| R | `rules/kh-summary-rules.test.ts` | R70–R77 (8) |
| R | `rules/contracts-k1.test.ts` | R80–R89 (10) |
| A | `studio.int.test.ts` | A01–A14 (14) |
| A | `check.int.test.ts` | A20–A31 (12) |
| A | `query.int.test.ts` | A40–A52 (13) |
| A | `worklog.int.test.ts` | A60–A71 (12) |
| A | `noleak.int.test.ts` | A80–A82 (3) |
| A | `seed.int.test.ts` | A120–A123 (4) |
| E | `e2e/studio/k1-knowledgehub.studio.ts` | E01–E12 (12) |
| E | `e2e/K1/admin/notice.k1.ts` | E20–E21 (2) |
| E | `e2e/K1/chat/notice.k1.ts` | E30–E31 (2) |
**Tổng 127** = R 53 · A 58 · E 16. Bỏ theo CR-073: `tenant.int.test.ts` (route `/admin/kh*`), `e2e/K1/admin/knowledge.k1.ts` (Dialog "Tri thức").

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| Kịch bản `timeout` | Hub `timeoutMs` 1000 (seam G1), KH giả trễ 2500 ms; không `sleep` trong test |
| Lùi ghi 30 s × 2ⁿ | `dueNow()` đặt `next_at` về quá khứ rồi gọi `khWriteOnce` |
| Cache `/projects` 300 s sống qua ca (một process) | ca cần đếm lời gọi `/projects` đổi `version` kết nối (khoá cache mới) |
| Nhiều run trong phòng R | `settle()` + `seedFull()` đầu mỗi ca; quota run 50/tenant |
| Song song A47 | chỉ kiểm tổng (5 tới KH, 2 KH_LIMIT), không thứ tự |
| e2e studio: cổng 3200 bận | `STUDIO_E2E_WEB_PORT` |
| e2e stack: cổng 4800+, Redis DB 11 | env `K1_E2E_PORT_BASE`, `K1_REDIS_DB` |
| `prepareDb` chạy `ALTER ROLE hub_api …` (cấp cụm) — session khác migrate cùng lúc ⇒ `PostgresError: tuple concurrently updated` trong `beforeAll` (gặp lại 2026-10-13 khi chạy 4 file một lệnh) | môi trường, không phải fixture: chạy lại file; chạy từng file khi có session khác |

## 6. Lệnh xong mốc — `bun run done:k1` (T7 tạo `tools/scripts/src/done-k1.ts`, mẫu `done-h4a`/`done-pb2`)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | unit + R | `bun test apps/hub-api/src/modules/kh packages/contracts tools/mocks tests/acceptance/K1/rules` |
| 3 | int K1 + hồi quy H4b-1/P-b2/H2a | `bun run test:int` (riêng: `bun --env-file=.env.test-k1_qc.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/K1`) |
| 4 | e2e Studio | `bunx playwright test -c e2e/studio/playwright.config.ts k1-knowledgehub` |
| 5 | e2e admin + chat | `bunx playwright test -c e2e/K1/playwright.k1.config.ts` (cần `bun run db:test:create k1_e2e`) |
| 6 | vết FR + khoá | `bun run trace --check && bun run test:lock:verify` |

## 7. Đỏ đúng lý do · chạy 2026-10-13 (CR-073; DB `ai_system_k1_qc_test` qua `.env.test-k1_qc.local`, e2e stack DB `ai_system_k1_e2e_test`; H4b-1 T5 đang BUILD)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | 5 file rules | 43 | 43 đỏ | `qc: <hàm> chưa có (plan §2)` (module `kh.{rules,check.rules,agent.rules,query.rules,summary.rules}` chưa có) |
| R | `contracts-k1` | 10 | 10 đỏ | `qc: <Schema> chưa có (spec §3.1)` · `expect` hằng/mã/`HUB_KH_ERRORS`/`StageView.knowledge`/`Agent.knowledge_connection_ids` vắng |
| A | studio, check, query, worklog, noleak | 54 | 54 đỏ | `needK1`: `{migration0029: false, hubSecrets: true}` — fixture K1 không chạy; 0 `PostgresError`/`TypeError` trong `beforeAll` (chạy từng file; một lần chạy gộp 4 file gặp `tuple concurrently updated` — môi trường, §5) |
| A | `seed` | 4 | 4 đỏ | `tpl("sdlc-delivery")` undefined / khoá stage `bug-fix` rỗng / `seeded:false` / `copied:false` (tenant evolu dựng được, seed chưa chép) |
| E | `k1-knowledgehub.studio.ts` | 12 | 12 đỏ | E01–E09: `/settings` chưa có ⇒ `openAuthed` không thấy `status "Phiên bản cấu hình Hub"`; E10–E12: trang agent lên, `region "KnowledgeHub"` chưa có |
| E | `e2e/K1` admin + chat | 4 | 4 đỏ | stack P-b2 lên đủ, đăng nhập + mở run OK; admin mở được dialog "Kết quả giai đoạn …" qua [Xem kết quả]; đỏ ở locator `status` KnowledgeNotice / "Tri thức: n/5 lần hỏi" |

Fixture SQL K1 chạy trên DDL nháp plan §5 (tx ROLLBACK, DB qc): 0 lỗi. `tsc -p tsconfig.tests.json` sạch phần K1; `biome check` sạch.

## 8. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | Seam test allowlist/timeout (plan chỉ có env) | `AppDeps.kh = { allowedOrigins: string[]; timeoutMs: number }` (vắng ⇒ env); `GET C.allowed_origins`/`timeout_ms` phản ánh seam | backend-lead (T5a/T5c) |
| G2 | Bộ gửi chạy nền 10 s, int dùng `processLoops:false` | `ProcessHandles.khWriteOnce(): Promise<number>` (một lô) | backend-lead (T5f) |
| G3 | Câu `INVALID_ARGS` của `kh-query` | = H2a "Invalid arguments for this tool." | backend-lead |
| G4 | `KH_PROJECT`: dấu phân cách nhãn | 1 nhãn: đúng "Pass project as one of: proj-c."; nhiều nhãn: chỉ kiểm tiền tố + chứa nhãn | backend-lead |
| G5 | `kh_version_too_old.params.found` | chứa "6.3" (chuỗi gốc hoặc chuẩn hoá đều được) | — |
| G6 | `khCheckShouldContinue` sau `kh_auth_disabled` (lỗi) | không kiểm (plan §3.1 bước 3 mơ hồ) | backend-lead (ghi rõ nếu dừng) |
| G7 | `KhCheckResult` khi dừng sớm | `kh_version: null`, `projects: []` (R31) | backend-lead |
| G8 | Audit `check.summary.codes` | mọi mã mục (lỗi + cảnh báo) | backend-lead |
| G9 | `StageView.knowledge.warning` khi lời gọi sau thành công | = `last_warning` (lỗi gần nhất) của (attempt, round) hiện tại (A51) | backend-lead |
| G10 | `khPackHits.hits` khi hit cuối bị cắt | đếm cả hit bị cắt (R61: 2) | backend-lead |
| G11 | **Spec cũ chưa dọn theo CR-073**: §1 (client `/v1/{ns}` + token, `/v1/{ns}/context/step`, "Không làm: dùng `/vector/*` hay khoá chung"), §2 (dòng `capabilities`, `/v1/me`, people lanes), §5 (bảng "Công ty của kết nối", Dialog "Tri thức" admin, nhãn e2e cũ), §8 AC02/AC03 (token, ns), frontmatter `HUB-FR-137` | test theo §3.0/§3.3/§9 Q26–Q34 + plan-frontend §5 (`a24f9df8`) | docs-architect |
| G12 | Bản chép evolu: Group duyệt / bật | A123 chỉ kiểm có bản chép (`source_template_id`, số stage), acme/beta không có; không kiểm `enabled`/Group | backend-lead (plan §6 ghi `review_group` evolu nếu cần) |
| G13 | Admin OutputDialog | e2e mở `/processes/:defId/runs/:runId` → [Xem kết quả] → dialog "Kết quả giai đoạn …" (nhãn i18n hiện có) | frontend-lead |
| G14 | Select "Khoá" lấy secret nền tảng (plan-frontend §7) | mock trả secret nền tảng cho mọi query `/secrets?…` | frontend-lead / backend-lead |
| G15 | Câu `KH_URL_NOT_ALLOWED` trong Sheet ("({reason})" thô hay dịch) | e2e chỉ khớp "Địa chỉ không được phép" | frontend-lead |

## 9. Khoá
Khoá lần 1: 2026-10-13 (T2 cũ, CR-072). **Mở khoá + viết lại 2026-10-13 theo CR-073** (Gate cũ hết hiệu lực; plan §8 liệt kê test viết lại): `tests/acceptance/K1/**` (viết lại; giữ `seed.int` + thêm A123 evolu), `e2e/studio/k1-knowledgehub.studio.ts`, `e2e/studio/_k1-kh.ts`, `e2e/K1/**`; `git rm` `tests/acceptance/K1/tenant.int.test.ts`, `e2e/K1/admin/knowledge.k1.ts`. `bun run test:lock:write` + `bun run test:lock:verify` OK.
