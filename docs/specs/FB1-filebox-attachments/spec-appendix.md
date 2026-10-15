---
id: FB1-spec-appendix
parent: FB1-filebox-attachments
---
# FB1 · Phụ lục spec — chi tiết tham chiếu (tách để spec ≤ 25 KB)

> Spec chính: [`spec.md`](spec.md). Contract (driver §3.1, DB §3.2, key env §3.3, route §3.4, env §3.6, AC) ở lại spec. **v1 CORE-ONLY (2026-10-15):** A3, A8 và các dòng dispatcher/sweeper/secret-store = Hoãn Hardening.

### A1 (spec §3.7) Mock FileBox cho test (HUB-FR-138, task #8) — chốt thiết kế, BUILD/qc dựng
Vị trí đề xuất `tests/acceptance/FB1/_fbfake.ts` (theo nếp fake của repo: K1 `_khfake.ts`, P-c2 `_support/`; qc chốt đường dẫn cuối). Server HTTP nhẹ (`Bun.serve`), hợp đồng = thật:
`POST /files?org=&name=` (Bearer bắt buộc; trả `201 {file_id, version_id, ...}`; `413` khi vượt) · `GET /files/:id/content` (stream bytes, hỗ trợ `Range`; `404` id lạ) · `GET /files/:id/link` (`200 {url:"/d/<rand>"}`; `404` id lạ) · `GET /files/:id/versions` · `DELETE /files/:id` (`204`; `404` đã xoá) · `GET /health` (`200`). Thiếu/sai Bearer ⇒ `401`. Lưu nội dung trong bộ nhớ theo `file_id`.

### A2 (spec §3.8) Egress & log
- **Mức log:** `throw Error` **chỉ chứa tên biến**, không giá trị (giữ R04; token không nằm trong env). Boot log một dòng `attach-driver {driver}` (info, không giá trị). `tenantMaxBytes`/`sweepS` parse như cũ.
- **Bề mặt egress (qc quét đúng một chỗ):** toàn bộ `fetch` tới FileBox nằm **duy nhất** trong `apps/hub-api/src/modules/attachments/filebox.client.ts`. Hàm thuần `fileboxUrlOk(target: string, base: string): boolean` (so `new URL(target).origin === new URL(base).origin`) chặn mọi URL khác origin `FILEBOX_URL`; client dựng URL từ `cfg.url` + path cố định. Test egress/TLS chỉ cần khẳng định trên file này: (1) mọi request cùng origin `FILEBOX_URL`; (2) **không** `rejectUnauthorized:false`/`NODE_TLS_REJECT_UNAUTHORIZED`; (3) CA nạp từ `caPath` khi https. Không có hạ tầng SSRF-allowlist chung — ràng buộc theo base URL như `gitHostAllowed`/`khUrlPolicy`.
- **IP:port `149.202.83.5:9443` (loại `:9000`) = allowlist HẠ TẦNG (firewall egress, HS1), KHÔNG hardcode trong app** (tránh IP trong mã; brittle). App chỉ đảm bảo 3 điều trên + `parseAttachEnv` ép scheme (https non-loopback / http chỉ loopback cho mock). ⇒ **Ghi cho qc (C4b):** AC-09 giữ ca "https bắt buộc với host không-loopback", "http loopback (mock) được", "mọi fetch cùng origin `FILEBOX_URL`", "không `rejectUnauthorized:false`"; **bỏ** ca đòi `parseAttachEnv` tự từ chối cổng `:9000`/IP lân cận (đó là kiểm hạ tầng, không phải app). Smoke egress thật = HS1.

### A3 (spec §4.4) Vòng đời & xoá — **Hoãn (Hardening, CR-079)**
v1 không có sweeper DELETE / log `attachment-filebox-deleted` / reason enum: file FileBox tích lại, dọn sau. Chỉ `discard` (INSERT lỗi) và `remove(fb/…)` gọi `DELETE` (404 = idempotent). `filebox_version_id` lưu để tải đúng bản, không phơi cho user. Thiết kế reason cũ: git history.

### A4 (spec §4.6) Ánh xạ lỗi FileBox → Hub (task #9)
| FileBox | Thao tác | Hub |
|---|---|---|
| `401/403` | bất kỳ | làm mới token **một lần** → thử lại; vẫn lỗi ⇒ fail-closed (upload/link/bytes → `500`; bỏ). Không lộ chi tiết |
| `404` | `GET /content`,`/link` | **Dify/CLI bytes ⇒ `null` → `AttachmentContentMissing` → `INTERNAL_ERROR`** (C4c: chọn INTERNAL_ERROR, đồng nhất RV-8/hành vi local hiện có — không đổi thành 404); route `/content` inline ⇒ 404 `NOT_FOUND`; link ⇒ `404 NOT_FOUND`; cả hai + log `attachment-content-missing` |
| `404` | `DELETE` | idempotent — coi đã xoá |
| `413` | `POST /files` | `ATTACHMENT_TOO_LARGE` (hiếm; đã chặn 20 MB trước) |
| `415/422` | `POST /files` | `INTERNAL_ERROR` (đã `FileInspector` trước upload; không mong đợi) |
| `5xx`/mạng | `GET /content`,`/link`,`DELETE` (**idempotent**) | retry backoff `1s,2s,4s` (≤3) → vẫn lỗi ⇒ `FileboxUnavailable` (bytes→`INTERNAL_ERROR`; link→`500`; DELETE→warn, sweep sau) |
| `5xx`/mạng | `POST /files` (**không idempotent**) | **KHÔNG** auto-retry (tránh upload trùng ⇒ mồ côi) ⇒ `500`; client `POST /attachments` tự thử lại |

FileBox sập ⇒ upload/tải lỗi rõ ràng (degrade), **không** chặn luồng chat (ADR-0015 Hệ quả).

### A5 (spec §9) Quyết định PLAN
- **Egress thu hẹp còn `:9443`** (PLAN BE 2026-10-15): v1 upload nhỏ 1 request ⇒ bỏ `:9000` khỏi allowlist (ADR-0015 D6/CR-077 liệt kê cả hai + fallback API; v1 = chế độ "chỉ API `:9443`", đúng nhánh fallback). `:9000`/parallel-parts giữ cho Hardening > 100 MB. Siết chặt hơn ⇒ an toàn hơn; trình Gate ghi nhận.
- **storage_key giữ `tenant/id` cho mọi hàng** (PLAN BE): file_id nằm ở cột `filebox_file_id`; locator đọc/xoá dựng runtime (`fb/<file_id>`) ⇒ không đổi chữ ký interface, không phá logic mồ côi/`idOf` local.
- **Upload ở `stage`, `commit` no-op, `discard`=DELETE** (PLAN BE, §4.2): vì file_id chỉ biết sau `POST /files`; giữ bất biến "hàng sống ⟺ file tồn tại".
- **Không auto-retry `POST /files`** (PLAN BE, §4.6): tránh upload trùng → mồ côi; chỉ retry GET/DELETE (idempotent).
- **Audit DELETE = log có cấu trúc** (PLAN BE, §4.4): `attachment-filebox-deleted`; audit_log bảng = Hardening (perf-later).
- **Token qua env `FILEBOX_TOKEN`** (CORE-ONLY, thay D3 secret store): đọc lúc khởi động, fail-closed khi vắng; secret-store = Hardening.
- **Đề xuất BE phân nhánh `/content` theo `Sec-Fetch-Mode`** (PLAN FE, §5.3): FE tải bằng fetch+Bearer+blob nên 302 cross-origin cần CORS FileBox chưa xác nhận; nhánh `cors` ⇒ Hub phát inline, `navigate` ⇒ 302. Cần backend-lead chấp nhận → AC-13.

### A6 (spec §3.5) Byte-consumer
| Chỗ | Đường v1 | Sửa gì |
|---|---|---|
| `attachments.service.ts content()` (browser/FE fetch) | **hybrid** (§3.4): `navigate`→302 /link; `cors`/vắng→inline bytes | route phân nhánh theo `Sec-Fetch-*` + `storage.driver` |
| `attachment-dify.ts uploadToDify` (bytes→Dify) | **`/content` inline** (`blob`) | `RunFile` thêm `fileboxFileId`,`fileboxVersionId`; gọi `blob(storageLocatorOf(file), mime)` thay `storageKey(tenant,id)` |
| `internal/attachments.service.ts download` (CLI job) | **`/content` inline** (`blob`) | `credential.repo findJobFile` SELECT thêm 2 cột; `blob(storageLocatorOf(row), OCTET)` |
| `internal/apply.service` (diff), `internal/autofix.service`+`autofix.repo` (test-log/diff), `processes/runs/output-attachment` (output/process-output), group-draft (`attachments.repo`/`run-files`) | **`stage`** (upload) | INSERT thêm `filebox_file_id/version_id` = `staged.fileId/versionId` ở **mọi** path (AC-15); đọc lại qua `blob(storageLocatorOf(row))` |
| `sweeper.ts` remove | **Hoãn** (v1 không DELETE FileBox; `remove(storage_key)` no-op) | không sửa sweeper |

### A7 (spec §4.3) Bytes vs redirect
- **Redirect (302):** chỉ route trình duyệt `GET /attachments/:id/content` khi driver=filebox. Đã sau RLS ⇒ không authz thêm.
- **Bytes inline (`/content`):** mọi chỗ backend tiêu thụ nội dung — `uploadToDify`, CLI job download (`internal/attachments`), (ghi diff/log/output là `stage`, không đọc). **Không** redirect ở các chỗ này (giữ `Blob`/stream như cũ).

### A8 (spec §3.3) Secret-store — **Hoãn (Hardening, CR-078)**
Enum/CHECK/scope_ck/AAD/`used_by`/UI Secrets: không làm ở v1; key qua env.

### A9 (spec §4.5) Fail-closed & egress
- **Token vắng** (env `FILEBOX_TOKEN` rỗng/thiếu) ⇒ fail-closed: upload → `500 INTERNAL_ERROR` + log `filebox-token-missing`; link/bytes → cùng cách. Không bao giờ thử gọi FileBox không token.
- **Egress:** chỉ `149.202.83.5:9443` (xác nhận v1: upload nhỏ 1 request ⇒ **không** cần `:9000`/parallel-parts). `:9000` KHÔNG vào allowlist v1. Pin cert `filebox.crt` (`FILEBOX_CA`/`NODE_EXTRA_CA_CERTS`); tuyệt đối không `rejectUnauthorized:false`. Cert/token không commit/log/FE.

**Bổ sung §3.4:**
- `Range`: nhánh inline giữ hành vi local (Range → stream 200). Nhánh redirect: trình duyệt phát lại `Range` tới link FileBox.
- Client **không-trình-duyệt** (dify, run-files, CLI) **không** đi qua route này — đọc `open/blob` (`/content`) trực tiếp (§3.5). Header bảo mật nhánh redirect do FileBox phát — rủi ro v1 chấp nhận (ADR-0015 D2); nhánh inline do Hub phát (an toàn).
