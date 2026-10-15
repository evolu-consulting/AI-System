---
id: FB1-filebox-attachments
title: FB1 · Driver lưu đính kèm FileBox (H2c hội thoại + X2b-2 phòng/nhóm) — v1 CORE-ONLY
milestone: FB1 (sau P-c2)
status: approved            # (scope CORE-ONLY 2026-10-15) draft → ready → approved → in-progress → done
requirements: [HUB-FR-44, HUB-BR-29, HUB-BR-30, HUB-FR-68, HUB-FR-69, HUB-FR-138, HUB-FR-139, HUB-FR-140, HUB-FR-141, HUB-FR-142]   # FR con: HUB-FR-138..142 (backend-lead, PLAN 2026-10-15)
design:
  - docs/adr/0015-filebox-external-file-storage.md (Proposed; D1…D8 + phạm vi v1)
  - docs/CHANGE-REQUESTS.md#CR-076 (driver), #CR-077 (shared org + egress), #CR-078 (secret), #CR-079 (vòng đời)
  - docs/specs/H2c-attachments/spec.md (contract attachment, interface `AttachmentStorage`)
  - docs/specs/X2b2-room-attachments/spec.md (file phòng, RLS 0023)
  owner: backend-lead + frontend-lead
---

# FB1 · Driver lưu đính kèm FileBox (v1 CORE-ONLY)

> Quyết định đã chốt: [`spec-decisions.md`](spec-decisions.md). Contract/DDL/luồng: [`plan.md`](plan.md). Task: [`tasks.md`](tasks.md). Tách từ spec: [`test-plan.md`](test-plan.md) (§8) · [`plan-frontend.md`](plan-frontend.md) (Hoãn) · [`spec-appendix.md`](spec-appendix.md) (mock, egress, lỗi).

## 1. Mục tiêu
Thay driver lưu nội dung đính kèm `local` bằng **FileBox** (dịch vụ file nội bộ nền MinIO; chính là driver S3/MinIO đã hoãn ở CR-039) cho **cả** H2c (hội thoại) **và** X2b-2 (phòng/nhóm). Tối giản, **giữ nguyên contract attachment** (route, mã lỗi, RLS, quota, sweeper). Chọn driver bằng env, không phá `local`.

## 2. Phạm vi (CORE-ONLY, thu hẹp 2026-10-15 theo yêu cầu người dùng)
| Làm (v1) | Hoãn / ngoài v1 (Hardening tương lai) |
|---|---|
| Driver `storage.filebox.ts` cài `AttachmentStorage`, `HUB_ATTACH_DRIVER=filebox`, **mount thẳng** (không dispatcher) | Dispatcher `createDispatchStorage` (đọc/xoá dữ liệu local cũ khi đang filebox) |
| Upload `POST /files?org=&name=` → lưu `filebox_file_id`/`filebox_version_id` (migration 0033, CHỈ 2 cột) | Loại secret `filebox_token` trong `hub.secrets` + UI Studio Secrets (key v1 = env) |
| Tải: `/content` Hub proxy inline; `/link` 302 cho điều hướng (`Sec-Fetch-*`) | Sweeper `DELETE /files/{id}` + log reason (v1: **không dọn FileBox**, file tích lại, dọn sau) |
| Key qua **env `FILEBOX_TOKEN`** (+`FILEBOX_URL/ORG/CA`), fail-closed khi thiếu | Sửa definer `attach_claim_deleted_rooms` |
| Egress: một origin `FILEBOX_URL`, pin cert, cấm `rejectUnauthorized:false` | Phơi versioning, parallel-parts > 100 MB, `org`/key theo tenant |

Biến (ngoài repo, KHÔNG đọc/commit): `FILEBOX_URL`, `FILEBOX_TOKEN`, `FILEBOX_CA`. Build qua **mock** FileBox; **smoke thật là hard stop phía người dùng**.

## 3. Backend / contract / DB
<!-- backend-lead · PLAN 2026-10-15 · chi tiết luồng/bước: `plan.md` §B0–§B8 (CORE-ONLY). Nền đọc: `apps/hub-api/src/modules/attachments/` -->

### 3.0 FR con (HUB-FR-138..142)
| FR | Nội dung (v1 CORE) | AC |
|---|---|---|
| HUB-FR-138 | Driver `storage.filebox.ts` (`driver:"filebox"`) mount thẳng; `stage/commit/discard/open/blob/remove/promote/list` | 01,02,03 |
| HUB-FR-139 | `/content`: `navigate` ⇒ 302 `/link`; còn lại Hub proxy inline; byte-consumer đọc inline | 04,05,06,13 |
| HUB-FR-140 | Bearer từ **env `FILEBOX_TOKEN`**; vắng ⇒ fail-closed. (Secret-store/UI: **Hoãn**) | 07,08 |
| HUB-FR-141 | Egress cùng origin `FILEBOX_URL`; pin cert; cấm `rejectUnauthorized:false` | 09 |
| HUB-FR-142 | **Hoãn** (sweeper DELETE). v1 chỉ `discard`=DELETE khi INSERT lỗi + retry GET/DELETE | 11 (một phần) |

### 3.1 Interface Storage (sửa `storage.ts`, HUB-FR-138)
Mở rộng **thêm, không phá** interface sẵn có. Chữ ký method giữ nguyên (`key: string`) ⇒ **không** đụng ~6 nơi khai báo `Pick<AttachmentStorage,"blob">`.
- `driver: "local" | "filebox"` (union mở rộng).
- `Staged` thêm `fileId?: string | null`, `versionId?: string | null` (local để `undefined`/`null`; filebox điền sau upload). `size`/`sha256`/`commit`/`discard` giữ nguyên nghĩa.
- `open/blob/remove/promote` giữ `(key: string, …)`. **`key` là locator tự mô tả**: local = `"<tenant>/<id>"`; filebox = `"fb/<file_id>[/<version_id>]"`. Driver filebox parse từ tiền tố `fb/`. Hàm thuần mới `fileboxLocator(fileId, versionId): string` và `storageLocatorOf(row): string` (row có `filebox_file_id` ⇒ dạng `fb/…`, ngược lại `storage_key`) trong `storage.ts`.
- `list({after,limit})`: filebox **luôn trả `[]`** (FileBox không có khái niệm file mồ côi/`.part` như kho local — không quét kho; sweeper mồ côi no-op). `StoredEntry`/`StoreCursor`/`promote` chỉ có nghĩa với local.
- Lỗi `StorageTooLarge`/`StorageRejected`/`StorageKeyError` giữ; thêm `FileboxUnavailable extends Error` (5xx/mạng sau retry, token vắng) ⇒ người gọi map `INTERNAL_ERROR`/404 theo §4.

**Ánh xạ method → FileBox call** (HUB-FR-138; `TOKEN` = Bearer từ env `FILEBOX_TOKEN`):
| Method | FileBox | Ghi chú |
|---|---|---|
| `stage(key,body,{maxBytes,inspect})` | ghi `body` ra **tạm cục bộ** (spill temp, đếm byte > `maxBytes`⇒413, `FileInspector`⇒415, sha256) **rồi** `POST /files?org=<FILEBOX_ORG>&name=<id>` tải trọn → `{file_id,version_id}`; xoá temp | upload nhỏ 1 request (≤ `ATTACH_MAX_BYTES` ~20 MB) ⇒ **không** parallel-parts/`:9000`. Trả `Staged{size,sha256,fileId,versionId,commit:no-op,discard:DELETE /files/{file_id}}` |
| `commit()` | **no-op** | upload đã xong ở `stage`; thứ tự an toàn ở §4 |
| `discard()` | `DELETE /files/{file_id}` | hoàn tác khi INSERT DB lỗi ⇒ không để file mồ côi trên FileBox |
| `blob(key,type)` | `GET /files/{file_id}/content` → gom `Blob(type)` | đọc bytes (uploadToDify, CLI). 404 ⇒ `null` (content-missing) |
| `open(key)` | `GET /files/{file_id}/content` (stream) | ít dùng; giữ cho đủ interface |
| `remove(key)` | `DELETE /files/{file_id}` | 404 ⇒ coi như đã xoá (idempotent, không ném) |
| `promote(key)` | no-op | không có `.part` |
| (mới, ngoài interface) `link(fileId)` | `GET /files/{file_id}/link` → `{url}` | chỉ driver filebox phơi; route `/content` dùng để 302 (§3.4) |

**Chữ ký driver (chốt cho qc — C1):**
```ts
createFileboxStorage(cfg: {
  url: string;                 // FILEBOX_URL (base, vd https://149.202.83.5:9443)
  org: string;                 // FILEBOX_ORG
  token: FileboxTokenSource;   // = { get(), refresh() }; v1 nguồn = env FILEBOX_TOKEN (refresh trả lại cùng giá trị); null = vắng ⇒ fail-closed
  caPath?: string;             // FILEBOX_CA (prod); vắng ⇒ dựa NODE_EXTRA_CA_CERTS (bỏ với mock http)
  timeoutMs?: number;          // mặc định 30000
  retryDelaysMs?: number[];    // mặc định [1000, 2000, 4000]; chỉ dùng cho GET/DELETE
  log?: Logger;
}): AttachmentStorage        // .driver === "filebox"
```
`token.get()` trả `null` ⇒ driver không gọi FileBox, ném `FileboxUnavailable` (fail-closed, §4.5). `token.refresh()` gọi khi FileBox trả 401/403 (một lần) rồi thử lại. Nguồn `token` = env (§3.3). qc dựng storage qua `FB1/_fb1.ts buildFbStorage` theo đúng chữ ký này.

**Mount thẳng (không dispatcher):** khi `HUB_ATTACH_DRIVER=filebox`, `server.ts` mount `createFileboxStorage(...)` trực tiếp. Hàng local cũ (`filebox_file_id` NULL) **không** được phục vụ khi đang `filebox` (dispatcher = Hardening). `remove/promote` với key không phải `fb/…` ⇒ **no-op** (sweeper cũ gọi `remove(storage_key)` không được ném).

### 3.2 DB — migration `0033_fb1_filebox_ref.sql` (viết tay, idempotent: `IF NOT EXISTS`, `DO $$`; **chỉ THÊM 2 cột**, không mất dữ liệu cũ)
**`hub.attachments` thêm cột** (`storage_key` **giữ nguyên** `"<tenant>/<id>"` cho mọi hàng):
| Cột | Kiểu | Null | Ghi chú |
|---|---|---|---|
| `filebox_file_id` | text | yes | id file ở FileBox; NULL ⇒ hàng local. CHECK `octet_length BETWEEN 1 AND 256` khi không null |
| `filebox_version_id` | text | yes | version đang trỏ; NULL với local |

- Phân biệt: `filebox_file_id IS NOT NULL`. Không index, không migrate dữ liệu cũ. RLS không đổi.
- **Không** đụng enum/CHECK `hub.secrets`, **không** sửa hàm definer `hub.attach_claim_deleted_rooms` (Hardening cùng sweeper DELETE).

### 3.3 Key FileBox qua env (HUB-FR-140, v1 CORE)
- Hub đọc Bearer từ **env `FILEBOX_TOKEN`** (`parseAttachEnv`); `FileboxTokenSource.get()` trả giá trị đó, `refresh()` trả lại cùng giá trị (401/403 ⇒ thử lại một lần rồi fail-closed). Vắng/rỗng khi `driver=filebox` ⇒ **không throw lúc boot**; mọi thao tác FileBox ném `FileboxUnavailable` (fail-closed, §4.5).
- Token **không** vào job/log/FE/trace/response (HUB-BR-30); chỉ nằm trong env tiến trình Hub. Secret-store (`hub.secrets` loại `filebox_token`, AAD, `useSecret`, xoay khoá không restart) = **Hoãn Hardening**.

### 3.4 Route tải — hybrid redirect/inline (HUB-FR-139, C5/Q-FE1)
`GET /attachments/:id` (metadata JSON) **giữ nguyên**. `GET /attachments/:id/content`:
- Driver `local` ⇒ y như cũ (`blobResponse` 200 / 206 Range), bất kể header.
- Driver `filebox` ⇒ **phân nhánh theo `Sec-Fetch-Mode`/`Sec-Fetch-Dest`** (trình duyệt tự đặt, JS không giả được):
  - `Sec-Fetch-Mode: navigate` **hoặc** `Sec-Fetch-Dest ∈ {document, iframe}` ⇒ **302 redirect** tới `FILEBOX_URL + link.url` (link `/d/…` 10', không key). Dùng khi mở tab/`<iframe>`/`<a>`.
  - `Sec-Fetch-Mode ∈ {cors, same-origin, no-cors}` **hoặc** header vắng ⇒ **Hub đọc `/files/{id}/content` và phát inline** (như local: `blobResponse` + `Content-Disposition`/`nosniff`/CSP do **Hub** phát). Dùng cho FE `fetch`+Bearer→`.blob()`/text (preview, diff, log tự sửa, tải chat) — tránh 302 cross-origin vỡ khi FileBox thiếu CORS/CSP.
  - Lý do an toàn phân nhánh: `Sec-Fetch-*` là forbidden header, mã JS không đặt được ⇒ nhánh inline luôn áp cho mọi `fetch` của FE; nhánh redirect chỉ cho điều hướng tài liệu thật.
- `AttachmentService.content()` đổi kiểu trả về thành union `{kind:"blob",body,headers} | {kind:"redirect",url}`; route `/content` quyết nhánh từ header rồi gọi service tương ứng (`contentInline` vs `contentLink`). RLS/authz **không thêm** (đã kiểm ở `#readable` trước cả hai nhánh). `purged_at` ⇒ 404; FileBox 404 ⇒ 404 `NOT_FOUND` + log `attachment-content-missing`. **Không log URL `/d/…` đầy đủ**; không phơi `file_id` ở thân (link `/d/…` opaque, không chứa `file_id`).
- `Range`, client không-trình-duyệt, header bảo mật nhánh redirect (rủi ro v1 chấp nhận, ADR D2): [`spec-appendix.md`](spec-appendix.md) §A7.

**Zod/response:** v1 **không** thêm/sửa field response attachment (`Attachment`/`AttachmentDetail` giữ nguyên — `file_id`/`version` không phơi, D9). Không schema contract mới ngoài `HUB_SECRET_KINDS`.

### 3.5 Byte-consumer (HUB-FR-139)
Bytes (uploadToDify, CLI download) đọc `/content` inline qua `blob(storageLocatorOf(row))`; ghi diff/log/output đi `stage` và INSERT thêm `filebox_*`; sweeper `DELETE`. Bảng từng chỗ: [`spec-appendix.md`](spec-appendix.md) §A6.

### 3.6 Env mới (`attach-env.rules.ts` `parseAttachEnv` + `config/env-deps.ts`)
| Env | Bắt buộc khi | Ví dụ / mặc định | Ghi chú |
|---|---|---|---|
| `HUB_ATTACH_DRIVER` | luôn | `local` \| `filebox` | enum mở rộng |
| `FILEBOX_URL` | driver=filebox | `https://149.202.83.5:9443` | base API; mock `http://127.0.0.1:<port>` |
| `FILEBOX_ORG` | driver=filebox | `ai-system` | một org chung (D5) |
| `FILEBOX_TOKEN` | driver=filebox | (secret, ngoài repo) | Bearer; không log/commit; vắng ⇒ fail-closed khi dùng |
| `FILEBOX_CA` | driver=filebox (prod) | đường dẫn `filebox.crt` | pin cert; cũng chấp nhận `NODE_EXTRA_CA_CERTS`. **Cấm** `rejectUnauthorized:false` |
| `FILEBOX_TIMEOUT_MS` | tuỳ | `30000` | timeout mỗi request |

Mock test: `http://` loopback ⇒ bỏ CA/pin. `FILEBOX_TOKEN_SECRET`/`FILEBOX_SPILL_DIR` (bản trước) **bỏ** (key env, buffer bộ nhớ — §9).

### 3.7 Mock FileBox cho test (HUB-FR-138)
Chi tiết hợp đồng mock: [`spec-appendix.md`](spec-appendix.md) §A1. Vị trí `tests/acceptance/FB1/_fbfake.ts`.

### 3.8 `parseAttachEnv` + bề mặt egress (C4a, C4b)
**Hình dạng trả về** (`attach-env.rules.ts`) — đổi `AttachEnv` thành **union phân biệt theo `driver`**:
```ts
type AttachEnv =
  | { driver: "local";   dir: string; tenantMaxBytes: number; sweepS: number }
  | { driver: "filebox"; url: string; org: string; caPath?: string;
      timeoutMs: number; tenantMaxBytes: number; sweepS: number };
```
`FILEBOX_TOKEN` **không** nằm trong `AttachEnv` (tránh lọt log); `parseAttachEnv` chỉ kiểm sự hiện diện (ném nếu thiếu, nêu tên biến). Server đọc thẳng `env.FILEBOX_TOKEN` cấp cho `envFileboxToken`.
- `HUB_ATTACH_DRIVER` ∉ {`local`,`filebox`} ⇒ `throw` (server thoát). Driver `filebox` thiếu `FILEBOX_URL`/`FILEBOX_ORG` ⇒ `throw`. `FILEBOX_URL` phải `https://` (prod) hoặc `http://` (chỉ khi loopback — mock); khác ⇒ `throw`.
- Mức log, bề mặt egress (`filebox.client.ts` duy nhất, `fileboxUrlOk`), allowlist IP:port = hạ tầng HS1: [`spec-appendix.md`](spec-appendix.md) §A2. AC-09 chỉ kiểm: https non-loopback, http loopback, cùng origin, không `rejectUnauthorized:false`.

## 4. Nghiệp vụ / luật
<!-- backend-lead · PLAN 2026-10-15 -->

### 4.1 Cách ly tenant — RLS giữ nguyên, org chung (D5, HUB-BR-29)
- "Ai xem file nào" **hoàn toàn** do RLS/`findReadableAttachment`/`findJobFile` sẵn có trên route (không đổi một dòng authz). FileBox **không** là hàng rào tenant thứ hai ở v1.
- MỘT `org` chung `FILEBOX_ORG` cho mọi file, mọi tenant. Không map org theo tenant (Hardening sau = `t_<tenant_id>`, đổi `org` không phá contract).
- Không thêm permission code / lớp phân quyền. Link `/d/…` TTL 10', không key ⇒ không log URL đầy đủ (lộ link = tải được trong 10').
- Dữ liệu local cũ khi đổi sang `filebox`: không phục vụ (không dispatcher; Hardening). Không migrate, không đổi `storage_key`.

### 4.2 Thứ tự ghi an toàn — không để file mồ côi / hàng treo (R05 tương đương)
Luồng filebox (khác local: upload ở `stage`, `commit` no-op):
1. `stage`: đọc body vào bộ nhớ (≤ 20 MB; đếm/inspect/sha256) → `POST /files` → `{file_id,version_id}` (chưa có hàng DB).
2. `#insert` (transaction `system`, khoá tenant, hạn mức chốt): INSERT hàng với `filebox_file_id/version_id` từ `staged`. **Lỗi bất kỳ** (quota 409, guard, DB) ⇒ `staged.discard()` = `DELETE /files/{file_id}` ⇒ **không** mồ côi trên FileBox.
3. `#commit`: no-op (file đã nằm ở FileBox, hàng đã commit).
- Hệ quả: một hàng DB sống ⟺ một file FileBox tồn tại (trừ cửa sổ hẹp giữa upload lỗi-DB và discard; discard idempotent, 404 bỏ qua).
- `supersedeJobOutput` chỉ `purged_at=now()`; **v1 không xoá nội dung FileBox** (file tích lại).

### 4.4 Vòng đời & xoá (HUB-FR-142 — Hoãn Hardening)
v1 **không dọn FileBox**: sweeper không gọi `DELETE /files/{id}`; file hết hạn/gỡ tích lại ở FileBox, dọn sau (sweeper DELETE + log reason = Hardening, CR-079). Chỉ `discard` (INSERT lỗi, §4.2) và `remove` với key `fb/…` gọi DELETE. Với filebox: `list ⇒ []`, `remove(storage_key)` no-op.

### 4.5 Fail-closed key & egress (HUB-FR-140/141, D6/D7)
Token vắng ⇒ fail-closed (upload `500 INTERNAL_ERROR` + log `filebox-token-missing`, FileBox 0 call). Egress cùng origin `FILEBOX_URL`, pin cert, cấm `rejectUnauthorized:false`. Chi tiết: [`spec-appendix.md`](spec-appendix.md) §A9.

### 4.6 Ánh xạ lỗi FileBox → Hub
Bảng đầy đủ: [`spec-appendix.md`](spec-appendix.md) §A4. Tóm tắt: 401/403 ⇒ refresh 1 lần rồi fail-closed; 404 GET ⇒ NOT_FOUND (route) / INTERNAL_ERROR (Dify/CLI); 404 DELETE ⇒ idempotent; `POST /files` không auto-retry; GET/DELETE 5xx ⇒ retry 1/2/4s.

### 4.7 Hàm thuần cho qc bám (khai báo ở PLAN, BUILD cài)
- `fileboxLocator(fileId: string, versionId: string | null): string` → `"fb/<fileId>"` hoặc `"fb/<fileId>/<versionId>"` (ở `storage.ts`).
- `storageLocatorOf(row: {storage_key; filebox_file_id; filebox_version_id}): string` → `fb/…` nếu có `filebox_file_id`, ngược lại `storage_key`.
- `parseFileboxLocator(key: string): {fileId; versionId: string|null} | null` → parse tiền tố `fb/`.
- `isFileboxRow(row): boolean` = `filebox_file_id != null`.
- `fileboxRetryable(status: number | null): boolean` = idempotent 5xx/mạng (dùng cho GET/DELETE, không cho POST).

### AC v1 CORE (qc hoàn chỉnh ở [`test-plan.md`](test-plan.md))
| AC | Tóm tắt |
|---|---|
| FB1-AC-01 | `driver=filebox`: upload ⇒ `POST /files`, hàng có `filebox_file_id/version_id`, `storage_key` vẫn `tenant/id`, response không chứa `file_id`/`version` |
| FB1-AC-02 | INSERT DB lỗi (quota) sau upload ⇒ `DELETE /files/{id}` (không mồ côi); không có hàng DB |
| FB1-AC-03 | `driver=local` không đổi hành vi (hồi quy H2c/X2b-2 xanh) |
| FB1-AC-04 | `/content` (navigate, chủ sở hữu) ⇒ `302` tới `FILEBOX_URL + /d/…`; log không chứa URL đầy đủ |
| FB1-AC-05 | Không quyền (RLS) ⇒ `404` **trước** khi gọi FileBox |
| FB1-AC-06 | `uploadToDify`/CLI download đọc `/files/{id}/content` inline; `purged`/404 ⇒ `INTERNAL_ERROR`/`404` |
| FB1-AC-07 | Key từ **env `FILEBOX_TOKEN`**: mọi call mang `Authorization: Bearer`; giá trị không lộ ở response/log (*điều chỉnh: bỏ secret-store*) |
| FB1-AC-08 | Token vắng ⇒ upload `500 INTERNAL_ERROR` + log `filebox-token-missing`, **không** gọi FileBox |
| FB1-AC-09 | https non-loopback / http loopback (mock) / mọi fetch cùng origin (`fileboxUrlOk`) / không `rejectUnauthorized:false`. Allowlist IP:port = hạ tầng (HS1) |
| FB1-AC-10 | **Hoãn (Hardening)** — sweeper DELETE + log. v1: sweeper không đụng FileBox |
| FB1-AC-11 | `POST /files` 5xx ⇒ **không** retry (một call); `GET/DELETE` 5xx ⇒ retry 1/2/4s *(điều chỉnh: bỏ phần sweeper)* |
| FB1-AC-12 | **Hoãn (Hardening)** — UI Studio Secrets `filebox_token` |
| FB1-AC-13 | Hybrid tải: `Sec-Fetch-Mode: navigate`/`Dest: document` ⇒ 302; `cors`/vắng ⇒ inline (Hub phát `Content-Disposition`/`nosniff`) |
| FB1-AC-14 | **Hoãn (Hardening)** — dispatcher dữ liệu lẫn lộn |
| FB1-AC-15 | (HUB-FR-138 ghi · HUB-FR-139 đọc) Mọi output/diff/test-log/process-output/group-draft stage lên FileBox đều ghi `filebox_file_id/version_id`; đọc lại ra bytes đúng, không mồ côi |

**AC v1 = 01–09, 11, 13, 15** (12 AC). Hoãn: 10, 12, 14.

## 5. Frontend / UI
v1 **KHÔNG đổi FE**; nạp key bằng env. UI Secrets (`filebox_token`) → Hardening. Upload/tải giữ nguyên nhờ nhánh inline cho `fetch` (AC-13; tránh 302 cross-origin vỡ — R-FE1 trong [`plan-frontend.md`](plan-frontend.md)).

## 6. Hiệu năng
Không thuộc Lệnh xong (perf-later).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Giả lập |
|---|---|
| FileBox API (`/files`, `/link`, `DELETE`) | Mock HTTP `tests/acceptance/FB1/_fbfake.ts` (§3.7); smoke thật = hard stop người dùng |

Env mới: §3.6.

## 8. Tiêu chí nghiệm thu (qc)
Test-plan, ma trận AC×test, hạ tầng test, kết quả đỏ-đúng-lý-do, mục cần làm rõ: [`test-plan.md`](test-plan.md). Độ phủ v1: HUB-FR-138..141 (+142 một phần); AC v1 = 01–09, 11, 13.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Xem [`spec-decisions.md`](spec-decisions.md) (D1…D9).
### Trong lúc làm (agent tự quyết theo Luật 2)
Các quyết định PLAN (egress `:9443`, `storage_key` giữ `tenant/id`, upload ở `stage`, không retry POST, `Sec-Fetch-Mode`): [`spec-appendix.md`](spec-appendix.md) §A5. Ghi thêm quyết định BUILD vào đây.
- **Thu hẹp CORE-ONLY (2026-10-15, người dùng):** key = env `FILEBOX_TOKEN`; bỏ secret-store/UI, dispatcher, sweeper DELETE, sửa definer ⇒ Hardening tương lai (CR-078, CR-079).
- **Token (chạm HUB-BR-30):** chỉ trong env/memory tiến trình Hub; không log, không vào `work/<job_id>/`/prompt/trace/FE. Cờ **security review** egress/secret.
- **stage buffer bộ nhớ (BUILD 2026-10-15):** driver `filebox` đọc trọn body vào bộ nhớ (≤ `ATTACH_MAX_BYTES` ~20 MB: đếm/inspect/sha256) rồi `POST /files` một request — KHÔNG spill ra file tạm. Bỏ env `FILEBOX_SPILL_DIR` (không dùng). Spill đĩa = Hardening nếu nâng trần cỡ file.
- **Ghi tham chiếu FileBox ở 4 đường output/diff/log (BUILD, reviewer #1):** autofix/apply điền `filebox_file_id/version_id` từ `staged` khi INSERT; `commitOutputBlob`/`persistDraft` (INSERT trước, stage sau COMMIT) thêm `UPDATE … SET filebox_file_id/version_id` sau stage — giữ bất biến hàng-sống⟺file §4.2.

### Câu hỏi / HARD STOP còn lại (trình Gate)
- **Q-FE1 (backend-lead):** chấp nhận `Sec-Fetch-Mode` ở §5.3 (mặc định: chấp nhận; nếu không thì phải xác nhận FileBox có CORS + CSP `connect-src`, hoặc FE đổi cách tải — tệ hơn).
- **HS1 (hạ tầng):** `FILEBOX_URL`/`FILEBOX_TOKEN`/`filebox.crt` thật (nạp qua env), mở egress IP `149.202.83.5:9443` ở hạ tầng, smoke FileBox thật — người dùng nạp/bật. Build+test qua mock.
- **HS2 (xác nhận ADR):** thu hẹp egress còn `:9443` (bỏ `:9000`) — khác câu chữ ADR-0015 D6/CR-077; đề nghị Gate chấp nhận (mặc định: chấp nhận, an toàn hơn).
- **Lưu ý review:** redirect `/link` ⇒ header bảo mật (`nosniff`/CSP/`Content-Disposition=attachment`) do FileBox phát, không phải Hub (§3.4) — security review xác nhận chấp nhận cho v1 (ADR D2).

## 10. Tranh chấp test
- (không)
