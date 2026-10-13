# Test plan · K1-knowledgehub (qc)

Chế độ **WRITE + LOCK** (T2) · 2026-10-13. "Đúng" = spec §2 (luật), §3 (contract), §4 (dữ liệu, `snapshot.kh`, `used_by`), §8 (K1-AC01…09), §9 (Q1–Q9; Q2 người dùng chốt: people lanes bật OK với project riêng, lỗi `kh_people_lanes_on_shared` khi tenant có project dùng chung) · `plan.md` §2 (chữ ký hàm thuần), §3.1 (10 bước + mã), §3.3 (phân loại lỗi), §3.4 (câu tool EN), §4 (audit), §5 (DDL — chỉ để dựng fixture), §6 (seed) · `plan-frontend.md` §4–§5 (câu chữ + nhãn e2e VI) · hợp đồng KH v6.4 (`KnowledgeHub/docs/integration/api-contract.md`, `auth-and-tenancy.md`) cho KH giả. Hộp đen: không đọc code implementation.

## 1. Quy ước
Như H4b-1 §1 (tên test có mã, chờ theo điều kiện, cấm `skip/only/todo`, id cố định), thêm:

| Mục | Quy ước K1 |
|---|---|
| Tên test | `"<mã BA> · [K1-ACxx ·] <ID> · mô tả"` — `HUB-FR-131` Studio/kiểm tra kết nối · `HUB-FR-132` tri thức/`kh-query`/gắn project · `HUB-FR-133` Tóm tắt/worklog · `HUB-FR-134` hạ cấp · `HUB-FR-137` token · `HUB-BR-35` cách ly tenant · `HUB-BR-36`/`HUB-BR-30` không lộ · `HUB-BR-37`/`HUB-BR-40` egress/TLS/auth · `CR-070` seed |
| Loại | **R** hàm thuần + contract (`bun test`, nạp động — module chưa có ⇒ đỏ ở `fn()`/`schema()`) · **A** int hub-api thật + DB tag riêng + KH GIẢ (`bun run test:int`) · **E** e2e Playwright: studio-web `page.route` (config studio) và admin-web/chat-web trên stack P-b2 thật + `page.route` cho route KH |
| Vị trí | R `tests/acceptance/K1/rules/*.test.ts` · A `tests/acceptance/K1/*.int.test.ts` · E `e2e/studio/k1-knowledgehub.studio.ts` (+ `_k1-kh.ts`), `e2e/K1/{admin,chat}/*.k1.ts` (config `e2e/K1/playwright.k1.config.ts`) |
| Id cố định | int `c1a1…` (`_k1.ts`), e2e studio `e1a1…` |
| Chưa có bảng | `needK1()` đầu mỗi ca: `{migration0029, hubSecrets}` ⇒ trước code đỏ ở expect, không `PostgresError` trong `beforeAll` (fixture K1 chỉ chèn khi bảng có) |
| Chuỗi quét | client_secret `qc-K1-<tenant>-Zx9Pq7Lm-cs`, token KH giả tiền tố `khfake_` |

## 2. Hạ tầng
- **`_khfake.ts` — KH GIẢ của qc** (Bun.serve cổng 0, trạng thái bộ nhớ, ĐỘC LẬP mock sản phẩm `tools/mocks/src/kh` của T5b): `/health`, `/version` `{version}`, `POST /v1/token` (JSON/form, client `kh-ns-<ns>`, token `khfake_…`), `/v1/me` (không token: 401, hoặc `kind=local` khi auth off), `/v1/capabilities`, `/v1/{ns}/manifest` `{ns, manifest_rev, manifest:{keyspaces, settings}}`, `/v1/{ns}/context/step`, `/v1/{ns}/worklog` (idempotency replay). Kịch bản theo ns: `ok · token_expired_once · token_expired_always · ns_not_active · ns_suspended · embedder_unavailable · forbidden · quota · timeout · server_error · invalid` + cờ `peopleLanes/retrievalLanes/projects/keyspaces/manifestRev/kind/meNs`; toàn cục `version/auth/health/capabilities/tokenStatus`. Ghi `calls` (method, path, token đã dùng, `Idempotency-Key`, `X-KH-*`, body, status), `tokens`, `worklog`. Token sai ns ⇒ 403.
- **`_k1.ts`**: `startK1({seed})` = `setupPa()` + `seedPf1` + def K1 (`k1-auto`, `k1-gate`, `k1-shared`, `k1-none`, `k1-mixed`, `k1-free`, `k1-beta`) + agent `k1-llm` + (khi 0029 + `hub.secrets` có) secret `kh_api_key` dựng bằng mã hoá đối chứng H4b-1 (`seedSecret`) + (seed `full`) `kh_settings.base_url` = KH giả, `kh_tenants` acme/beta `status ok` + `check_result.keyspace_dims [role, step]`, project acme `proj-a`, `proj-b`, `proj-shared` (chỉ đọc), beta `proj-beta`, binding, `knowledge_enabled` cho hd-read/hd-post. hub-api in-process với seam: **`kh: {allowedOrigins, timeoutMs: 1000}`** (G1), `hubSecretsKey` (H4b-1 D11), `publicInternalUrl` (H2a), `processLoops:false`, `onProcessHandles` (**`khWriteOnce`**, G2).
- **`_run.ts`**: bắt đầu run ở phòng R, claim job stage bằng Runtime giả, gán token job, `kh-query`/`tools/list` qua `/mcp` (helper H2a), chấm gate, đọc `kh_writes`/`kh_stage_usage`, `settle`.
- Fixture SQL đã kiểm khớp DDL plan §5 bằng script nháp (DDL tối thiểu tạm trên DB qc, không phải migration) — 0 lỗi.

## 3. Ma trận AC → test
| AC | Then (chi tiết qc) | Loại · file | Ca |
|---|---|---|---|
| K1-AC01 | 10 bước đạt ⇒ `status ok` + cảnh báo embedder; lanes bật + chỉ project riêng ⇒ OK; lanes bật + project dùng chung ⇒ `kh_people_lanes_on_shared {project_id}`; `kind=local` ⇒ `kh_auth_disabled`; không token 2xx ⇒ `kh_auth_disabled` (localhost dev ⇒ cảnh báo `_dev`); http ngoài localhost ⇒ `not_https`; mọi mã bước 1–10 | R `kh-check-rules`, `kh-rules` · A `check` · E studio | R01–R06, R30–R43 · A30–A47 · E06–E07 |
| K1-AC02 | run acme chỉ gọi `/v1/acme_ns/*` + token client `kh-ns-acme_ns`; project lấy từ snapshot; tenant beta không thấy/không gắn được project/def acme ⇒ 404 | A `query`, `tenant` · R `kh-summary-rules` | A74–A75, A51, A56, A60 · R61, R64 |
| K1-AC03 | token cache bộ nhớ (≤ 1 lần xin cho 3 lời gọi); 401 ⇒ token mới + thử lại đúng 1; 401 lặp ⇒ dừng; secret/token không ở response/log/audit/bảng/job | R `kh-rules` · A `query`, `noleak` | R14–R16 · A77–A79, A110–A111 |
| K1-AC04 | 5 lần OK (`calls_left` 4…0), lần 6 `KH_LIMIT` không gọi KH; song song 7 ⇒ đúng 5; `budget_chars 4000`, text ≤ 4000; tham số sai không đếm | R `kh-summary-rules`, `contracts-k1` · A `query` | R65–R66, R75, R78 · A73–A75, A84 |
| K1-AC05 | auto/gate Đạt ⇒ `kh_writes` + POST worklog subject `<quy trình>/<stage>`, `Idempotency-Key kw-<run>-<stage_run>-v<n>`; gate chờ/trượt ⇒ không; project chỉ đọc ⇒ không; gửi lại ⇒ cùng khoá, KH 1 dòng | R `kh-summary-rules` · A `worklog` | R50–R53, R63 · A93–A97 |
| K1-AC06 | KH sập / 404 / 423 / 503 / timeout ⇒ `KH_UNAVAILABLE`, `last_warning`, audit `degrade`, stage xong + run đi tiếp; ghi lỗi ⇒ thử lại ≤ 5, `403` ngay `failed`, audit `write_fail`; UI cảnh báo | R `kh-rules` · A `query`, `worklog` · E chat | R16–R17 · A80–A83, A98–A101 · E30 |
| K1-AC07 | quy trình có project ⇒ snapshot thêm `Tóm tắt` + template, prompt nhắc; def gốc không đổi; quy trình không gắn / chỉ đọc / tenant không hiệu lực ⇒ snapshot = def | R `kh-summary-rules` · A `worklog` · E admin | R55–R62 · A90–A92 · E20, E22 |
| K1-AC08 | `sdlc-delivery` 9 stage, `bug-fix` 6 stage đúng plan §6, hợp `ProcessStageDefSchema` + `processDefStageIssues` = []; `sdlc` 8 stage; seed lần 2 không nhân đôi; 12 file khoá `sdlc` = `test:lock:verify` | A `seed` | A120–A122 |
| K1-AC09a | xoá `kh_api_key` đang trỏ ⇒ 409 `SECRET_IN_USE`, `used_by ∋ {type: knowledge_hub, id: tenant, key: ns}` | A `studio` | A23 |
| K1-AC09b | (H4b-1 Q12) `work/<job_id>/` dựng như Runtime từ những gì Hub giao cho job (payload + prompt + mọi phản hồi `/mcp`) không chứa secret/token | A `noleak` | A112 |

### 3.1 Luật / FR → ca
| Luật | Ca |
|---|---|
| HUB-FR-131 Studio URL + allowlist + version + đổi URL ⇒ unchecked | R01–R06, A01–A06, E01–E04 |
| HUB-FR-131 tenant ↔ ns ↔ secret (tạo/sửa/xoá, mã lỗi, list) | R70–R71, R77, A10–A18, E05, E08–E12 |
| HUB-FR-132 tri thức agent (`knowledge_enabled`, `KH_AGENT_RUNTIME`) | R76, A20–A21, E13 |
| HUB-FR-132 `/admin/kh`, binding, `effective` | R59–R62, A50–A61, E20–E24 |
| HUB-FR-132 `kh-query` (tool, đếm, câu tool, khoá step D13) | R13, R54, R64–R66, A70–A76, A84 |
| HUB-FR-133 Tóm tắt (cắt 200 từ/4000, subject, idem, ensureSummary, hàng chờ, bộ gửi) | R50–R58, R63, A90–A97 |
| HUB-FR-134 hạ cấp + phân loại lỗi + lùi ghi | R16–R17, R73, A79–A83, A98–A101, E30–E31 |
| HUB-FR-137 token (credentials JSON, token_url, làm mới 60–90 s, 401 ×1) | R09–R10, R14–R15, A41, A77–A79 |
| HUB-BR-35 cách ly (ns = tenant, secret của chính tenant, project từ snapshot, 404 chéo) | R12, R61, R64, A12, A43, A45, A51, A56, A60, A74–A75 |
| HUB-BR-36 / HUB-BR-30 không lộ | R22, A10, A41, A47, A110–A112 |
| HUB-BR-37 / HUB-BR-40 egress, TLS, auth bật, lanes × dùng chung | R01–R06, R11, R34, R37, R40, A33–A38 |
| Q3/D14 `StageView.knowledge` | R75, A83, A93, A95, E30–E31 |
| Q5 hiệu lực (`status ok`, mọi đổi ⇒ unchecked) | R12, A06, A15, A52, A71, A82, A92, A101 |
| Q6/D12 đếm nguyên tử theo `(stage_run, attempt, round)` | A73, A75, A82, A84 |
| Q7 không nhận `kh_api_key` nền tảng | A12, E11 |
| Q8 stage nhóm | R57, R62, R63 |
| §3.6 audit (`update/create/delete/check/enable/disable/degrade/write_fail`) | A03, A10, A18, A20, A32, A53, A55, A59, A80, A99, A101 |

## 4. Danh sách ca
| Nhóm | File | Ca |
|---|---|---|
| R | `rules/kh-rules.test.ts` | R01–R22 (35: R16 × 17) |
| R | `rules/kh-check-rules.test.ts` | R30–R43 (14) |
| R | `rules/kh-summary-rules.test.ts` | R50–R66 (17) |
| R | `rules/contracts-k1.test.ts` | R70–R78 (9) |
| A | `studio.int.test.ts` | A01–A06, A10–A18, A20–A21, A23 (18) |
| A | `check.int.test.ts` | A30–A47 (18) |
| A | `tenant.int.test.ts` | A50–A61 (12) |
| A | `query.int.test.ts` | A70–A84 (18: A80 × 4) |
| A | `worklog.int.test.ts` | A90–A101 (12) |
| A | `noleak.int.test.ts` | A110–A112 (3) |
| A | `seed.int.test.ts` | A120–A122 (3) |
| E | `e2e/studio/k1-knowledgehub.studio.ts` | E01–E13 (13) |
| E | `e2e/K1/admin/knowledge.k1.ts` | E20–E24 (5) |
| E | `e2e/K1/chat/notice.k1.ts` | E30–E31 (2) |
**Tổng 179** = R 75 · A 84 · E 20. FR MUST trong phạm vi (HUB-FR-131, 132, 133, 134, 137): **5/5 có test**.

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| Kịch bản `timeout` | Hub `timeoutMs` 1000 (seam G1), KH giả trễ 2500 ms; không `sleep` trong test |
| Lùi ghi 30 s × 2ⁿ | `dueNow()` đặt `next_at` về quá khứ rồi gọi `khWriteOnce` (không chờ thời gian thật) |
| Token cache sống qua ca (một process) | A77 kiểm "≤ 1 lần xin", không "= 1"; A78/A79 đổi kịch bản ns để buộc 401 |
| Nhiều run trong phòng R | `settle()` đầu mỗi ca; quota run 50/tenant |
| Song song A84 | chỉ kiểm tổng (5 tới KH, 2 KH_LIMIT), không thứ tự |
| e2e studio: cổng 3200 bận | `STUDIO_E2E_WEB_PORT` |
| e2e stack: cổng 4800+, Redis DB 11 | env `K1_E2E_PORT_BASE`, `K1_REDIS_DB` |
| `prepareDb` chạy `ALTER ROLE hub_api …` (cấp cụm) — session khác chạy migrate cùng lúc ⇒ `PostgresError: tuple concurrently updated` trong `beforeAll` (gặp 2026-10-13 khi H4b-1 chạy song song) | môi trường, không phải fixture: chạy lại file; không chạy int K1 song song với session khác |

## 6. Lệnh xong mốc — đề xuất `bun run done:k1` (T7 tạo `tools/scripts/src/done-k1.ts`, mẫu `done-h4a`/`done-pb2`)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | unit + R | `bun test apps/hub-api/src/modules/kh packages/contracts tools/mocks tests/acceptance/K1/rules` |
| 3 | int K1 + hồi quy H4b-1/P-b2/H2a | `bun run test:int` (riêng: `bun --env-file=.env.test-k1_qc.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/K1`) |
| 4 | e2e Studio | `bunx playwright test -c e2e/studio/playwright.config.ts k1-knowledgehub` |
| 5 | e2e admin + chat | `bunx playwright test -c e2e/K1/playwright.k1.config.ts` (cần `bun run db:test:create k1_e2e`) |
| 6 | vết FR + khoá | `bun run trace --check && bun run test:lock:verify` |

## 7. Đỏ đúng lý do · chạy 2026-10-13 (trước T4; DB `ai_system_k1_qc_test` qua `bun run db:test:create k1_qc`, e2e stack DB `ai_system_k1_e2e_test`)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | 4 file rules | 75 | 75 đỏ | `qc: <hàm> chưa có (plan §2)` (module `kh.rules/kh.check.rules/kh.summary.rules/kh.plan` chưa có) · `qc: <Schema> chưa có (spec §3.1)` · `expect` hằng/mã contract vắng |
| A | 6 file int K1 (studio, check, tenant, query, worklog, noleak) | 81 | 81 đỏ | `needK1`: lần đầu `{migration0029: false, hubSecrets: false}`; chạy lại sau khi H4b-1 T4 (0028, `92b90214`) vào `main` giữa chừng: `{migration0029: false, hubSecrets: true}` — fixture K1 không chạy |
| A | `seed` | 3 | 3 đỏ | `tpl("sdlc-delivery")` undefined / khoá stage `bug-fix` rỗng / `seeded:false` (A122 thêm điều kiện dương sau lần chạy đầu: trước đó xanh rỗng) |
| E | `k1-knowledgehub.studio.ts` | 13 | 13 đỏ | `/settings` chưa có ⇒ heading "Cài đặt" không thấy; E13 `switch "Được dùng tri thức (KnowledgeHub)"` không thấy |
| E | `e2e/K1` admin + chat | 7 | 7 đỏ | stack P-b2 lên đủ, đăng nhập + mở def/run OK; đỏ ở locator `region "Tri thức"` / `button "Tri thức"` / `status` KnowledgeNotice / "Tri thức: 0/5 lần hỏi" (E31 qua điều kiện dương: view 200, "Rà soát code" hiện, chưa có dòng tri thức) |

Int: 84 ca = 84 đỏ ở `expect`; **0 ca đỏ do dựng dữ liệu** (không `PostgresError`/`TypeError` trong `beforeAll`/fixture; seed agent `k1-llm` + def K1 chạy thật). Fixture SQL bảng K1 kiểm riêng trên DDL nháp theo plan §5: 0 lỗi. `tsc -p tsconfig.tests.json` sạch; `biome check` sạch; `check:size` OK.

## 8. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | Seam test cho allowlist/timeout (plan chỉ có env) | `AppDeps.kh = { allowedOrigins: string[]; timeoutMs: number }` (vắng ⇒ env `HUB_KH_ALLOWED_ORIGINS`/`HUB_KH_TIMEOUT_MS`); `GET /kh/settings.allowed_origins`/`timeout_ms` phản ánh seam | backend-lead (T5a/T5c) |
| G2 | Bộ gửi worklog chạy trong vòng nền 10 s, int dùng `processLoops:false` | `ProcessHandles.khWriteOnce(): Promise<number>` (một lô, như `sweepOnce`) | backend-lead (T5f) |
| G3 | `KhProbe` (plan §2.2) không mang `read_only` ⇒ không tính được Q2 | thêm `sharedProjects: readonly string[]` (project `read_only` của tenant) | backend-lead (T5a) |
| G4 | `peopleLanesOn(manifest)` nhận gì | tài liệu manifest (`GET …/manifest`.`manifest`): `settings.include_people_lanes`, ghi đè bởi `settings.retrieval.include_people_lanes` | backend-lead xác nhận |
| G5 | Hình KH chưa ghi trong plan: `/version` `{version}`, `me.projects` mảng chuỗi, token body JSON | KH giả theo `api-contract.md`; KH thật khác ⇒ ghi Tranh chấp test | backend-lead |
| G6 | Mock KH sản phẩm (`tools/mocks/src/kh`) là code BE | test khoá dùng KH GIẢ riêng `tests/acceptance/K1/_khfake.ts` (khoá); mock sản phẩm chỉ cho dev/UAT, test riêng của nó ở T5b | — |
| G7 | Câu `INVALID_ARGS` của `kh-query` (plan §3.4 không ghi) | = câu H2a "Invalid arguments for this tool." | backend-lead |
| G8 | `used_by` knowledge_hub: spec chỉ ghi `key = ns` | `{type: "knowledge_hub", id: tenant_id, key: ns}` | backend-lead |
| G9 | Nhãn nút xác nhận ConfirmDialog đổi URL; tiêu đề ConfirmDialog xoá tenant | đổi URL: `alertdialog` chứa câu §4, nút "Lưu"; xoá: `alertdialog` chứa "Xoá cấu hình KnowledgeHub của {tenant}?", nút "Xoá" (như H4b-1) | frontend-lead |
| G10 | KnowledgeNotice ở admin OutputDialog | e2e phủ chat run-page (component chung `packages/ui`); admin OutputDialog không có ca riêng | frontend-lead (unit F4) |
| G11 | K1-AC09b `work/<job_id>/` do Runtime dựng | dựng như Runtime từ đúng những gì Hub giao cho job (payload DB + prompt + phản hồi `/mcp` theo token job) rồi quét thư mục | — (qc quyết, đóng H4b-1 Q12 phần K1) |
| G12 | Phụ thuộc H4b-1 chưa code (`hub.secrets`, `useSecret`, `hubSecretsKey`, `SECRET_IN_USE`) | `needK1` đòi cả `hub.secrets`; K1 int chỉ xanh được sau H4b-1 T4–T5 trên `main` | điều phối |
| G13 | Prompt nhắc Tóm tắt (D15) | A90/A91 chỉ kiểm prompt chứa/không chứa "Tóm tắt" (template hoặc dòng D15) | — |
| G14 | Cột "Test" của spec §8 | ánh xạ ở §3 file này | docs-architect (điền spec §8 nếu cần) |

## 9. Khoá
Khoá 2026-10-13 (T2, trước T3 Gate; Gate đổi spec ⇒ qc mở lại + ghi lý do): `bun run test:lock:write` thêm `tests/acceptance/K1/**` (15 file) + `e2e/studio/k1-knowledgehub.studio.ts`, `e2e/studio/_k1-kh.ts` + `e2e/K1/**` (3 file); `bun run test:lock:verify` OK.
