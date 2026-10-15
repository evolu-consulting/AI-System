---
id: FB1-test-plan
parent: FB1-filebox-attachments
---
# FB1 · Test-plan (qc) — tách từ spec §8

> Spec chính: [`spec.md`](spec.md). Mã AC: FB1-AC-01..14 (liên tục, không trùng).
> **v1 CORE-ONLY (2026-10-15):** AC v1 = 01–09, 11, 13, 15. **Hoãn (Hardening):** AC-10 (sweeper DELETE), AC-12 (UI Secrets), AC-14 (dispatcher). Test thuộc AC hoãn (`sweeper.int` s*/t* trừ t6, `secret.int` k* về secret-store, `legacy.int` x*, e2e `filebox-secret`) tạm `test.skip`/gỡ khỏi lệnh xong — **qc chỉnh** (tests/.lock). AC-07/08: token lấy từ env `FILEBOX_TOKEN` (không `hub.secrets`) — `upload.int` c/d2–d3 và `_fb1.ts` cần nguồn token env; AC-11 chỉ phần upload/GET/DELETE retry.

<!-- qc · WRITE 2026-10-15 · chưa LOCK (khoá sau Gate). Test KHÔNG đọc code sản phẩm; viết theo spec §3–§5 (+ appendix) + contract. -->

### T1 Hạ tầng test
| Thành phần | File | Ghi chú |
|---|---|---|
| FileBox GIẢ ([`spec-appendix.md`](spec-appendix.md) §A1) | `tests/acceptance/FB1/_fbfake.ts` | `Bun.serve` cổng 0, hợp đồng = thật: `POST /files?org=&name=` (201 `{file_id,version_id,org,name,size}` · 413 · 401), `GET /files/:id/content` (Range→206 · 404), `GET /files/:id/link` (`{url:"/d/<rand>"}`), `GET /files/:id/versions`, `DELETE` (204 · 404), `GET /health`, `GET /d/:rand` (đích link). Ghi `calls` (không lưu token), `failNext/failAlways(route, status)`, `setToken`, `vanish`, `put`. |
| Dựng hub + driver | `FB1/_fb1.ts` | `startHubFb` = `startHubH2b` + `attachments.storage = createFileboxStorage(...)` (nạp động) trỏ mock; `needFb` đỏ ở `expect` khi chưa có migration 0033 / driver; `insertFbRow` (nạp byte vào mock + chèn hàng có `filebox_*`). |
| Dựng hub phòng | `FB1/_fb1room.ts` | như `startX2b2` nhưng storage = FileBox (không sửa helper X2b2 đã khoá). |
| Chạy | `bun --env-file=.env.test-qc.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/FB1` (DB riêng `bun run db:test:create qc`); `rules.test.ts` chạy cả `bun test` thường. |

### T2 Ma trận AC × test (68 test sau cắt CORE-ONLY; mọi tên bắt đầu bằng mã FR/AC)
| AC | FR | File · test id | Nội dung kiểm |
|---|---|---|---|
| FB1-AC-01 | 138 | `upload.int` a1–a4 · `bytes.int` o1 · `room.int` m1 · `rules` r1–r4 | 1 `POST /files?org=ai-system&name=<id>` có Bearer + byte; hàng có `filebox_file_id/version_id` khớp FileBox, `storage_key` = `tenant/id`; response `Attachment` strict, không lộ `file_id`/`version`/"filebox"; chunked; 415 ⇒ không gọi FileBox; output job và file phòng cùng driver; hàm thuần locator |
| FB1-AC-02 | 138 | `upload.int` b1–b2 | quota 409 dưới khoá ⇒ có POST rồi DELETE đúng `file_id`, FileBox rỗng, 0 hàng mới; DELETE hoàn tác 404 vẫn 409 đúng mã |
| FB1-AC-03 | 138 | `regress.int` l1–l3 · `rules` r3, r5, e6 | `driver=local`: ghi đĩa, cột `filebox_*` NULL, `/content` 200/206 (không 302), mock không nhận call; `storageKey/isStorageKey` không đổi; `parseAttachEnv local` giữ nguyên; hàng local dọn song song, không đụng FileBox. **Hồi quy đầy đủ = chạy nguyên bộ `tests/acceptance/H2c` + `X2b2` ở VERIFY (không sửa).** |
| FB1-AC-04 | 139 | `content.int` e1–e5 · `room.int` m2 | chủ/thành viên `GET /content` (navigate) ⇒ 302 tới `FILEBOX_URL + /d/…`; 1 call `/link`, 0 call `/content`; Location và thân không chứa `file_id`/`version_id`; theo link tải đúng byte, Range 206 ở FileBox; log không chứa URL `/d/…` hay token; metadata giữ nguyên |
| FB1-AC-05 | 139 · BR-29 | `content.int` f1–f4, g1 · `bytes.int` h5 · `room.int` m3 | khác user/khác tenant/uuid lạ ⇒ 404 một thân; 401 trước 404; `purged_at` ⇒ 404; **FileBox không nhận call nào** trước khi qua RLS; org chung vẫn cách ly tenant; FileBox 404 ở `/link` ⇒ 404 NOT_FOUND + log `attachment-content-missing`; job tenant khác ⇒ 401 |
| FB1-AC-06 | 139 | `bytes.int` h1–h4, i1–i3 · `content.int` g2–g3 | CLI download và `uploadToDify`/`storage.blob`/`open` đọc `GET /files/{id}/content` inline (không `/link`, không redirect), sha/size đúng ở Dify mock; mất file ⇒ 404 + log (CLI) / `run.failed INTERNAL_ERROR` (Dify, i3); GET 5xx ⇒ retry rồi 200; `/link` luôn 5xx ⇒ 500 sau 4 call |
| FB1-AC-07 (v1: env) | 140 | `secret.int` k2 · `rules` e4 | token lấy từ env `FILEBOX_TOKEN` (KHÔNG hub.secrets); thiếu ⇒ `parseAttachEnv` ném, lỗi chỉ nêu TÊN biến; giá trị token không có trong response, log, `hub.jobs`, `hub.run_steps`, `hub.messages` |
| FB1-AC-08 | 140 | `upload.int` c1–c2, d2–d3 · `secret.int` k1 | token vắng ⇒ 500 INTERNAL_ERROR (upload, `/content` link và bytes), FileBox 0 call, 0 hàng; 401 ⇒ làm mới đúng 1 lần rồi thử lại, vẫn 401 ⇒ fail-closed |
| FB1-AC-09 | 141 | `rules` e1–e8 | `parseAttachEnv` nhận `filebox` + https hợp lệ; **http:// tới host không phải loopback ⇒ ném**; mock `http://127.0.0.1:<port>` được; lỗi chỉ nêu tên biến; `fileboxUrlOk(base,url)` ép cùng-origin (khác host/port/scheme ⇒ false); kiểm tĩnh: không `rejectUnauthorized:false` / `NODE_TLS_REJECT_UNAUTHORIZED` ở `apps/hub-api/src`. **Không** kiểm allowlist IP:port ở app (là hạ tầng/firewall, HS1) |
| FB1-AC-10 **(Hoãn)** | 142 | — | sweeper DELETE: đã bỏ ca khỏi phạm vi v1. `discard`=DELETE lúc upload dở vẫn kiểm ở AC-02 |
| FB1-AC-11 | 138 | `upload.int` d1, d4 · `sweeper.int` t4–t5 · `bytes.int` h4 · `content.int` g2–g3 · `rules` r6–r7 | POST 5xx ⇒ **đúng 1 call**, 500, 0 hàng; POST 413 ⇒ `ATTACHMENT_TOO_LARGE`; GET 5xx ⇒ retry (tối đa 4 call = 1 + 3); mồ côi `list ⇒ []`, `promote` no-op; `fileboxRetryable`, `FileboxUnavailable` |
| FB1-AC-12 **(Hoãn)** | 140 | e2e `filebox-secret.spec.ts` (Playwright, chưa viết) | UI Studio Secrets `filebox_token`: tạo/thay/xoá, không cột Tenant, không lộ giá trị — nhãn/role: [`plan-frontend.md`](plan-frontend.md) §F-2 |
| FB1-AC-13 (v1, R-FE1, [`plan-frontend.md`](plan-frontend.md) §F-3) | 139 | `secfetch.int` n1–n4 | **chỉ nếu Gate chấp nhận** `Sec-Fetch-Mode`: `navigate` ⇒ 302; `cors`/`same-origin`/vắng ⇒ 200 inline từ `/files/{id}/content`; vẫn sau RLS. Gate bác ⇒ xoá file này trước LOCK |
| FB1-AC-14 **(Hoãn)** | — | — | dispatcher dữ liệu lẫn lộn: đã xoá `legacy.int.test.ts` khỏi phạm vi v1 |
| FB1-AC-15 (fix Blocker review vòng 1) | 138, 139 | `outputs.int` u1–u4 · `draft.int` (1) | output / diff / test-log / process-output / group-draft dưới `driver=filebox`: hàng có `filebox_file_id/version_id` khớp FileBox (không NULL); đọc lại qua `blob` ra đúng bytes; không file mồ côi |

Ghi chú: các ca 302 gửi tường minh `Sec-Fetch-Mode: navigate` ⇒ đúng cả khi AC-13 được hay không được chấp nhận. Retry trong test dùng `retryDelaysMs:[5,10,20]` (production mặc định `1s,2s,4s`, §4.6).

### T3 Độ phủ FR (MUST)
| FR | AC | Ghi chú |
|---|---|---|
| HUB-FR-138 | 01, 02, 03, 11, 15 | driver, stage/commit/discard/remove/blob/open/promote/list, locator |
| HUB-FR-139 | 04, 05, 06, (13), 15 | redirect vs bytes, RLS trước link, Range |
| HUB-FR-140 | 07, 08 (12 Hoãn) | key env, fail-closed |
| HUB-FR-141 | 09 | env/allowlist/TLS tĩnh |
| HUB-FR-142 | (10 Hoãn) | sweeper DELETE Hoãn (Hardening) |

**Độ phủ v1: HUB-FR-138..141 (+142 một phần)**; AC v1 01–09, 11, 13, 15 có ≥ 1 test (AC 10/12/14 Hoãn) (AC-12 = e2e FE `e2e/filebox-secret.spec.ts`, qc/frontend-lead viết sau Gate; AC-13/14 có `secfetch.int`/`legacy.int`) (một test có thể phủ nhiều AC).

### T4 Kết quả (chạy `.env.test-qc.local`, sau BUILD CORE-ONLY)
Typecheck FB1 sạch. **FB1: 68/68 xanh.** Hồi quy `tests/acceptance/H2c` + `X2b2`: 271 xanh, 2 đỏ pre-existing R48/R49 (drift P-c2, không do FB1: `packages/contracts` + fixture không bị chạm; TECH-DEBT #180).

| File | Số test |
|---|---|
| `rules.test.ts` | 15 |
| `upload.int.test.ts` | 12 |
| `content.int.test.ts` | 12 |
| `bytes.int.test.ts` | 9 |
| `secret.int.test.ts` (env token) | 2 |
| `sweeper.int.test.ts` (hợp đồng storage) | 2 |
| `regress.int.test.ts` | 3 |
| `room.int.test.ts` | 4 |
| `secfetch.int.test.ts` | 4 |
| `outputs.int.test.ts` (AC-15) | 4 |
| `draft.int.test.ts` (AC-15) | 1 |
| **Tổng** | **68** |

Đã xoá: `legacy.int.test.ts` (AC-14). Sửa test khoá: `H2c/db.int.test.ts` A130 (thêm cột `filebox_file_id`, `filebox_version_id`).

### T5 Cần làm rõ / bổ sung (qc không tự đoán)
| # | Agent | Việc |
|---|---|---|
| C1 | ĐÃ CHỐT | `createFileboxStorage(cfg)` chỉ thêm `caPath?` tùy chọn (mock http bỏ qua) ⇒ `FB1/_fb1.ts buildFbStorage` không đổi. Giả định còn lại: `token: {get, refresh}`, `retryDelaysMs?`. |
| C2 | ĐÃ CHỐT | Composite `createDispatchStorage({filebox, local})` phân tuyến theo locator ⇒ FB1-AC-14 (`legacy.int`). Giả định module `attachments/storage.dispatch.ts` (nếu khác tên/đường dẫn ⇒ sửa `composeDispatch` trong `_fb1.ts`, 1 chỗ). |
| C3 | ĐÃ CHỐT | reason ∈ `unbound\|conversation_deleted\|room_deleted\|orphan\|superseded\|already_gone`; AC-10 dùng `unbound`/`conversation_deleted`/`room_deleted`/`already_gone`. `orphan`/`superseded` chưa có ca riêng. |
| C4 | ĐÃ CHỐT | Allowlist IP:port là hạ tầng ⇒ bỏ ca đòi app từ chối `:9000`/IP lân cận; giữ https bắt buộc, chặn http (trừ loopback), `fileboxUrlOk` (giả định chữ ký `(base, url) ⇒ boolean` ở `attachments/filebox.client.ts`), không `rejectUnauthorized:false`. |
| C5 | ĐÃ CHỐT | Giữ `secfetch.int.test.ts` (AC-13). |
| C6 | Hoãn | E2E Studio Secrets `filebox_token` — Hardening, không viết. |
| C7 | ĐÃ CHỐT | Dify khi FileBox mất file ⇒ `INTERNAL_ERROR` (bytes.int i3). |
