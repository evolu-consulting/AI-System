# P-b-sources · plan (backend) — Nguồn tham chiếu + fix #133/#134

Nối `spec.md` §3–§4. Frontend ở `plan-frontend.md` (frontend-lead). PF = lát cắt build; thứ tự PF-S1…S5 ở §7. Mã: HUB-FR-120…125, WRK-FR-27, ADM-FR-68/69, PB-R01–R22.

## 1. Kiến trúc nguồn → snapshot → job (ranh giới TS ↔ Python)

```
tenant_admin/platform_admin
   │  CRUD /admin/sources (hub-api TS)         ┌─ hub.sources (RLS T)
   ▼                                           │
[hub-api] process_defs.sources/inputs; stage.sources/allowlist  (def, TS)
   │  start run → process_runs (pinned_sources=NULL)
   ▼
[hub-api launcher] def có nguồn ∧ pinned NULL ⇒ enqueue hub.jobs type=source.resolve  ─NOTIFY─►
                                                                                               │
[agent-runtime Python] claim source.resolve (SKIP LOCKED) ─► git CLI/library resolve + dựng   │
   mirror cache + snapshot chỉ-đọc  ─ POST /internal/jobs/:id/sources-resolved ─► [hub-api]    │
   │                                                                                            │
   ▼ ghi process_runs.pinned_sources + sources_pinned_at ⇒ launcher kick lại ⇒ launch stage 0  │
[hub-api] stage job agent.cli: payload.sources = [{key,kind,pin,allowlist}] + allowed_tools R/G/G
   │  ─NOTIFY─►
[agent-runtime] mount work/<job_id>/sources/<key>/ (chỉ-đọc, lọc PB-R07), hook deny ghi sources/
   agent Read/Grep/Glob ; ghi files_read ─► POST outputs + audit source_job_reads
```

Ranh giới:
- **hub-api (TS)** sở hữu: contract, `hub.sources` CRUD, def/run ghim, enqueue `source.resolve`, nhận resolved, ráp `payload.sources`, MANIFEST + prompt, kiểm output `## Nguồn tham chiếu`, audit `source_job_reads`. **KHÔNG** gọi git, KHÔNG ra internet.
- **agent-runtime (Python)** sở hữu: resolve (git ls-remote/clone → SHA; library version; local_path realpath), mirror cache + snapshot (lọc PB-R07, trần 50MB/2000 file sau allowlist), mount chỉ-đọc, hook PreToolUse deny ghi `sources/`, parse `files_read` (stream-json tool_use, D8), SSRF/inject guard (PB-R19).

## 2. Cache + snapshot (Runtime, PB-R16, WRK-FR-27)
- Khoá snapshot = `tenant_id` + `source_id` + SHA/version + `hash(allowlist_union)`. Cache hit ⇒ không clone lại.
- Mirror theo repo (bare), khoá file theo mirror; clone/fetch timeout 120 s. Snapshot = thư mục copy `chmod -R a-w`, dựng ở temp rồi `rename` nguyên tử. LRU `RUNTIME_SOURCE_CACHE_MAX_MB`=2048 (D9); snapshot của run đang mở KHÔNG bị LRU xoá; mất ⇒ dựng lại từ pin, không được ⇒ run `needs_decision`.
- Lọc PB-R07: basename không phân biệt hoa, mọi độ sâu (`.env*`,`.git`,`.ssh`,`.aws`,`*.pem/key/pfx/p12/keystore`,`id_rsa*`,`secrets*`,`credentials*`,`.npmrc`,`.netrc`); THẮNG allowlist; bỏ hardlink/submodule/symlink. Glob = `picomatch`. Trần tính SAU allowlist+lọc; vượt ⇒ `SOURCE_TOO_LARGE`.
- **C8 khớp lọc:** mục có `*` = prefix/suffix-glob (`.env*`,`id_rsa*`,`secrets*`,`credentials*`,`*.pem`…); mục KHÔNG `*` = khớp basename **đúng** (case-insensitive). `.git` chỉ khớp đúng `.git` (thư mục/file) — GIỮ `.gitignore`,`.gitattributes`,`.github` (SN-05). `.ssh`/`.aws` tương tự (khớp đúng).
- **C6 fixture git (test, PB-R19 vs `file://`):** URL trong DB luôn `https://github.com/pb-test/<repo>.git`; Runtime vẫn kiểm https/allowlist/port trên URL **logic**. Khi `RUNTIME_ENV!=production`, Runtime truyền `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` xuống `git` (`url./fixtures/.insteadOf=https://github.com/pb-test/`, `protocol.file.allow=always`) ⇒ git (sau kiểm) đọc từ đĩa. `RUNTIME_SOURCE_TEST_MODE=1` ⇒ bỏ kiểm DNS-trả-IP-nội-bộ (nếu không, offline hỏng). Production KHÔNG đặt hai env này.

## 3. Contract — bảng trường đầy đủ (nối spec §3)

### 3.1 `hub-admin/sources.ts`
```
SourceKeySchema   = z.string().regex(/^[a-z0-9-]{2,32}$/)
SourceKindSchema  = z.enum(["git_remote","local_path","library"])
SOURCE_DESC_MAX=500 ; SOURCE_PATH_MAX=1024 ; SOURCE_URL_MAX=2048 ; SOURCE_BRANCH_MAX=255
SOURCE_GLOB_MAX=256 ; STAGE_SOURCES_MAX=5 ; DEF_SOURCES_MAX=20 ; RESOLVE_ITEMS_MAX=20 ; RESOLVE_ALLOWLIST_MAX=40
GlobSchema = z.string().min(1).max(256).superRefine(không "..", không mở đầu "/", không ký tự null)
GitUrlSchema = z.string().max(2048).url().superRefine(startsWith https:// ∧ KHÔNG "@" trước host ∧ không userinfo)
BranchSchema = z.string().min(1).max(255).regex(/^[^-]/)  // không mở đầu "-" (PB-R19)

GitRemoteConfig = strictObject{kind:lit git_remote, url:GitUrl, branch:Branch}
LocalPathConfig = strictObject{kind:lit local_path, path:z.string().min(1).max(1024)}
LibraryConfig   = strictObject{kind:lit library, document_id:Uuid}
SourceConfigSchema       = discriminatedUnion(kind,[GitRemoteConfig,LocalPathConfig,LibraryConfig])
LocalPathPublic = strictObject{kind:lit local_path}  // ẩn path
SourceConfigPublicSchema = discriminatedUnion(kind,[GitRemoteConfig,LocalPathPublic,LibraryConfig])

GitPin     = strictObject{kind:lit git_remote, url:GitUrl, sha:z.string().regex(/^[0-9a-f]{40}$/)}
LocalPin   = strictObject{kind:lit local_path, path:z.string().max(1024), snapshot_id:Uuid}
LibraryPin = strictObject{kind:lit library, document_id:Uuid, version:Uuid}
SourcePinSchema = discriminatedUnion(kind,[GitPin,LocalPin,LibraryPin])
LocalPinPublic = strictObject{kind:lit local_path, snapshot_id:Uuid}   // C1: bỏ path (GitPin.url/LibraryPin không bí mật)
SourcePinPublicSchema = discriminatedUnion(kind,[GitPin,LocalPinPublic,LibraryPin])

SourceViewSchema = strictObject{id:Uuid, tenant_id:Uuid, key:SourceKey, kind:SourceKind,
  config: z.union([SourceConfigSchema, SourceConfigPublicSchema]), description:z.string().max(500),
  version:z.number().int().min(1), used_by:z.array(ProcessKeySchema),
  last_pin: z.union([SourcePinSchema, SourcePinPublicSchema]).nullable(),  // C1: server strip path cho non-platform
  created_at:IsoDateTime, updated_at:IsoDateTime, updated_by:UpdatedBySchema}
SourceCreateRequest = strictObject{key, kind, config:SourceConfigSchema, description:z.string().max(500), tenant_id:Uuid.optional()}
SourceUpdateRequest = strictObject{config:SourceConfigSchema, description, version:z.number().int().min(1)}
SourceListQuery  = strictObject{tenant_id:Uuid.optional(), kind:SourceKind.optional(), limit:coerce 1..100 =20, cursor:string.optional()}
SourceDeleteQuery= strictObject{tenant_id:Uuid.optional(), version:coerce int ≥1}
SourceCheckResult= strictObject{pin: z.union([SourcePinSchema,SourcePinPublicSchema]), files:int≥0, bytes:int≥0}  // C1 theo quyền
SourceInUseDetails = strictObject{refs: z.array(strictObject{process_key, stage_key}).max(100)}
LibraryDocItem   = strictObject{id:Uuid, name:z.string(), version:Uuid, updated_at:IsoDateTime}       // C3
LibraryDocListQuery = strictObject{q:z.string().max(200).optional(), limit:coerce 1..100 =20, cursor:string.optional()}
LibraryDocListResponse = strictObject{items:z.array(LibraryDocItem).max(100), next_cursor:string.nullable()}
```
**C1 strip:** repo/service build `SourceView.last_pin`/`SourceCheckResult.pin` = `SourcePin` khi caller `platform_admin`, ngược lại map local_path → bỏ `path` (`SourcePinPublic`). Cùng chỗ strip `config` (xem §3.2 GET). Không bao giờ để `path` lọt ra non-platform (A-06/K-05).
**C3 library-documents:** `GET /admin/sources/library-documents` (route trong module `sources`, guard `tenant_admin`) đọc kho H2c `attachments` origin='library' của tenant (RLS), trả `LibraryDocListResponse`; cursor như `processes.ts`. Dùng cho picker drawer `library`.
Routes trong `apps/hub-api/src/modules/sources/` (module mới), mount dưới `/admin/sources` cùng guard `tenant_admin`; ghi `local_path` guard `platform_admin` (403 `SOURCE_FORBIDDEN_KIND` nếu tenant_admin). GET trả `config` theo quyền: platform_admin → `SourceConfig`; tenant_admin/member → `SourceConfigPublic`.

### 3.2 Chip + def/run (nối spec §3.3–§3.5)
```
ProcessSourceChipSchema = strictObject{key:SourceKey, kind:SourceKind, description:z.string().max(500),
  default_branch:BranchSchema.optional()}  // C4: chỉ set cho git_remote (từ config.branch); undefined cho local_path/library
GET /process-runs/sources → strictObject{items: z.array(ProcessSourceChip).max(200)}
// C2: ProcessCatalogItemSchema (chat/processes-api.ts) += inputs:z.array(ProcessInputDefSchema).max(10).default([])
//     ⇒ import ProcessInputDefSchema từ hub-admin/processes (re-export qua chat nếu cần tránh vòng lặp)

ProcessInputDefSchema = strictObject{key:SourceKey, label:z.string().trim().min(1).max(80),
  type:z.enum(["text","select","file","source_ref"]), required:z.boolean(),
  options:z.array(z.string().min(1).max(200)).max(20).optional()}  // superRefine: options chỉ khi type=select
StageSourceSchema = strictObject{source_key:SourceKey, allowlist:z.array(GlobSchema).max(20).default([])}
// ProcessStageDefSchema += sources:z.array(StageSourceSchema).max(5).default([]), must_know:z.array(z.string().trim().min(1).max(200)).max(10).default([])
// ProcessDefInputBaseSchema += sources:z.array(SourceKeySchema).max(20).default([]), inputs:z.array(ProcessInputDefSchema).max(10).default([])
// superRefine def (processDefStagePaths mở rộng): mỗi stage.sources[].source_key ∈ def.sources else path stages.<i>.sources.<j>.source_key → 422 PROCESS_REF_INVALID

ProcessInputValueSchema = discriminatedUnion(type,[
  strictObject{type:lit text, key:SourceKey, text:z.string().max(PROCESS_INPUT_MAX)},
  strictObject{type:lit select, key:SourceKey, value:z.string().max(200)},
  strictObject{type:lit file, key:SourceKey, attachment_id:Uuid},
  strictObject{type:lit source_ref, key:SourceKey, source_key:SourceKey, branch:BranchSchema}])
// C19: += inputs:z.array(ProcessInputValueSchema).max(10).optional() cho CẢ:
//   CreateProcessRunRequestSchema (chat/processes-api.ts — đường !key P-b1) VÀ RunProcessDefRequestSchema (hub-admin — admin "Chạy", P-b2)
```
**C19 validate lúc start** (service, không ở zod contract vì cần def): với mỗi `inputs[i]`: `key∈def.inputs` (lạ ⇒ 422 `VALIDATION_ERROR` path `inputs.<i>.key`); `type` khớp `def.inputs[key].type`; `select` ⇒ `value∈def.inputs[key].options`; `source_ref` ⇒ `source_key` là nguồn `git_remote` cùng tenant (lệch/không git/không tồn tại ⇒ 422 `VALIDATION_ERROR`, không rò tồn tại). Thiếu `required` KHÔNG chặn (agent hỏi, AC-H37).
**C20 AskCard chip:** Hub KHÔNG điền `ask.choices` bằng key nguồn; FE lấy chip từ `GET /process-runs/sources` (lọc `kind='git_remote'`), khớp `key` để hiện mô tả. (IN-03/E-PB11)

### 3.3 Job + kênh (`hub/job.ts`, `hub-internal/sources.ts`)
```
JobSourceSchema = strictObject{key:SourceKey, kind:SourceKind, pin:SourcePinSchema, allowlist:z.array(GlobSchema).max(20)}
// AgentCliJobSchema += sources:z.array(JobSourceSchema).max(5).optional()  → pydantic JobPayload1.sources tự sinh
ResolveItemSchema = strictObject{source_id:Uuid, key:SourceKey, kind:SourceKind, config:SourceConfigSchema, allowlist_union:z.array(GlobSchema).max(40)}
SourceResolveJobSchema = strictObject{v:lit 1, type:lit "source.resolve", job_id:Uuid, tenant_id:Uuid,
  process_run_id:Uuid.nullable(), items:z.array(ResolveItemSchema).min(1).max(20), timeout_s:int 10..300}
// JobPayloadSchema discriminatedUnion += SourceResolveJobSchema
ResolveResultSchema = discriminatedUnion(status,[
  strictObject{status:lit ok, source_id:Uuid, pin:SourcePinSchema, files:int≥0, bytes:int≥0},
  strictObject{status:lit error, source_id:Uuid, code:z.enum(["SOURCE_UNRESOLVABLE","SOURCE_TOO_LARGE","SOURCE_HOST_NOT_ALLOWED","SOURCE_FORBIDDEN_KIND"]), message:z.string().max(500).optional()}])
SourcesResolvedRequestSchema = strictObject{results:z.array(ResolveResultSchema).min(1).max(20)}

// C18 files_read channel (hub/events.ts): JobResultEventSchema += source_reads:z.array(JobSourceReadSchema).max(5).optional()
JobSourceReadSchema = strictObject{source_key:SourceKey, files_read:z.array(z.string().max(1024)).max(2000).nullable(), bytes_read:z.number().int().min(0).nullable()}
// files_read = path tương đối gốc nguồn (đã bỏ tiền tố "sources/<key>/"); D8 parse hỏng ⇒ null + cảnh báo.
// Hub nhận job.result → map source_key→source_id (theo payload.sources của job) → INSERT hub.source_job_reads (append-only).
```
**C12 `sources-resolved`:** job-token hợp lệ nhưng `results[i].source_id ∉ job.items` ⇒ từ chối CẢ báo cáo, **422 `VALIDATION_ERROR`**, KHÔNG pin (run chờ tiếp → timeout → `needs_decision`). RS-03…06 (token/run/tenant sai) vẫn **401** (PB-R18). Mọi `source_id` phải khớp `items` của chính job.

### 3.4 Hàm thuần `sources.rules.ts` (C5 — chốt chữ ký, qc viết test trước)
File: `apps/hub-api/src/modules/processes/runs/sources.rules.ts` (dùng chung cho launcher/stage-driver/output; không I/O, dễ test). Mọi kiểu lấy từ `@ai/contracts`.
```
import type { StageSource, SourcePin, ProcessSourceChip, ProcessDef } from "@ai/contracts";
type RunErrorCode = "ALL_PROVIDERS_EXHAUSTED"|"TIMEOUT"|"UPSTREAM_ERROR"|"CANCELLED"|"BUDGET_EXCEEDED"|"NOT_CONFIGURED"|"INTERNAL_ERROR";
type RefCheck = { ok: true } | { ok: false; reason: "missing"|"empty"|"unknown_key"|"version_mismatch"|"path_absent" };

// RF-01…05 · hợp nhất allowlist các stage dùng cùng sourceKey → sắp xếp + khử trùng; >40 ⇒ throw RangeError
allowlistUnion(stages: readonly { sources?: readonly StageSource[] }[], sourceKey: string): string[]
// RF-06…10 · stage có nguồn ⇒ ["Read","Grep","Glob"] (bỏ qua agentTools); không nguồn ⇒ agentTools nguyên
forceSourceTools(stageHasSources: boolean, agentTools: readonly string[]): string[]
// RF-11…14 · stage.token_budget ?? 200000 khi stageHasSources; không nguồn ⇒ stage.token_budget (giữ P-a); ≤0 ⇒ throw
defaultSourceBudget(stage: { token_budget: number|null }, stageHasSources: boolean): number|null
// RF-15…19 · MANIFEST.md: mỗi nguồn 1 mục {key, mô tả, phiên bản/sha, đường dẫn mount}; thứ tự theo stage.sources; không chứa url-credential
buildManifest(items: readonly { key: string; description: string; pin: SourcePin }[]): string
// RF-20…27 · parse "## Nguồn tham chiếu" trong md; key∈stageSourceKeys, @version khớp pin; path tồn tại đối chiếu filesRead (null⇒bỏ kiểm path, C16); heading trong ```code``` bỏ qua; sai hoa ⇒ missing
checkSourceRefs(md: string, stageSourceKeys: readonly string[], pins: Readonly<Record<string, SourcePin>>, filesRead?: ReadonlyArray<string>|null): RefCheck
// RF-28…33 · map reason lỗi team → 1 trong 7 mã runs_error_code_ck (PB-R17); không bao giờ null
mapTeamError(reason: string|null|undefined): RunErrorCode
```
Hàm liên quan CRUD (host allowlist, cú pháp local_path) nằm trong module `sources` (service), không trong file này.

## 4. Kênh Hub→Runtime resolve — luồng, timeout, thất bại (PB-R05/D4)

1. **Start** (`start.service`): run tạo với `snapshot.sources` (từ def, mỗi nguồn + allowlist_union gộp các stage) + `pinned_sources=NULL`. Nếu def không nguồn ⇒ set `pinned_sources='[]'` ngay (bỏ qua resolve).
2. **Launcher gate** (`launcher.ts kick`): trước `plan()`, nếu `head.snapshot.sources` không rỗng ∧ `pinned_sources IS NULL` ∧ chưa có job resolve đang chạy ⇒ enqueue `source.resolve` (scope system, tạo job-token như agent job, `hub.jobs` status `queued`), NOTIFY. KHÔNG launch stage 0. Idempotent: khoá `process_runs` FOR UPDATE; nếu đã có job resolve `running`/`queued` cho run ⇒ skip.
3. **Runtime**: claim (SKIP LOCKED), mỗi item resolve + dựng snapshot (§2); gửi `POST /internal/jobs/:id/sources-resolved`. Kết thúc job (status `finished` khi mọi item ok; `failed` + `error_code` khi có lỗi — dùng `job.result`/`job.failed` run-event như agent để Hub `JobFollower`/poll dừng chờ).
4. **Hub nhận resolved** (`sources/resolve.service`): xác thực job-token (type `source.resolve`, running) — mọi sai 401. Ghi theo transaction scope system: mọi `ok` ⇒ `pinned_sources = jsonb(pin[])` + `sources_pinned_at=now()`; rồi `launcher.kick(process_run_id)` lại ⇒ launch stage 0. Có `error` (bất kỳ item) ⇒ `toDecision(reason='source_unresolvable')` ⇒ run `needs_decision` (option retry/cancel), KHÔNG pin.
5. **Timeout/thất bại**: job resolve có `timeout_s`; nếu job fail/timeout/orphan (sweep lease như agent job) và `pinned_sources` vẫn NULL ⇒ `toDecision('source_unresolvable')`. Retry decision ⇒ enqueue resolve mới. **Làm lại stage** dùng `pinned_sources` đã ghim (HUB-BR-27), KHÔNG resolve lại.
6. **Kiểm tra kết nối** (`POST /admin/sources/:key/check`): enqueue `source.resolve` 1 item `process_run_id=null`, Hub chờ đồng bộ (JobFollower, tới `timeout_s` mặc định 60) → ok→200 `SourceCheckResult`; error→422 mã; quá hạn→422 `SOURCE_UNRESOLVABLE`.

**Lưu ý (PB-R18/#133):** endpoint `sources-resolved` + job-token: id/job phải khớp token; `process_run_id` của job phải khớp token-job's run (hoặc null cho check). Không nhận resolved cho run khác.

### 4.1 Nơi phát mã lỗi (C7/C9/C10/C11) — ai kiểm cái gì
- **C7 `local_path` ngoài gốc:** Hub chỉ validate **cú pháp** ở POST/PUT (`path` 1..1024, không NUL — zod). Kiểm `HUB_SOURCE_LOCAL_ROOTS` + `realpath` (chống thoát symlink) là của **Runtime** lúc resolve (check hoặc start), Hub không biết roots. Vi phạm gốc ⇒ ResolveResult `error SOURCE_UNRESOLVABLE` ⇒ check: 422 `SOURCE_UNRESOLVABLE`; start: `needs_decision source_unresolvable`. `SOURCE_FORBIDDEN_KIND` CHỈ cho vi phạm quyền (tenant_admin ghi `local_path`, PB-R21) — kiểm ở Hub trước khi enqueue.
- **C9 `SOURCE_TOO_LARGE` lúc start:** Runtime dựng snapshot phát hiện >50MB/>2000 file (sau allowlist+lọc) ⇒ ResolveResult `error SOURCE_TOO_LARGE` ⇒ run `needs_decision source_unresolvable`, message mang mã `SOURCE_TOO_LARGE`. KHÔNG đi đường job `failed`→`NOT_CONFIGURED` ở bước start. (`NOT_CONFIGURED`/PB-R17 chỉ nếu stage `agent.cli` tự vượt trần lúc mount — hiếm, snapshot đã kiểm ở resolve.)
- **C10 library `document_id`:** Hub kiểm kho H2c **cùng tenant** (RLS) ngay ở POST/PUT create/update nguồn `library`. Không tồn tại HOẶC khác tenant (không phân biệt, không rò) ⇒ 422 `SOURCE_UNRESOLVABLE`.
- **C11 platform_admin `tenant_id`:** POST `local_path` (chỉ platform_admin, PB-R21) BẮT BUỘC `tenant_id` trong body (platform_admin thao tác thay tenant). Thiếu ⇒ 422 `VALIDATION_ERROR` (issue path `tenant_id`). `tenant_admin` tạo git_remote/library: `tenant_id` lấy từ phiên (gửi khác phiên ⇒ bỏ qua/403 theo mẫu hub). Khớp spec §3.2 `tenant_id?(platform_admin+local_path)`.
- **C13 seam test:** `createApp({sourceCheckTimeoutMs?:number})` — mặc định 60000 ms; test tiêm nhỏ để K-04 không chờ lâu. (Cùng chỗ nhận option như các seam `createApp` hiện có.)

### 4.2 Resolve library — token & layout mount (C15)
- Job `source.resolve` có item `library` ⇒ job-token (type `source.resolve`) cấp đọc đúng các `document_id` library trong `items` của job qua internal H2c (`GET /internal/jobs/:job_id/attachments/:attId` hoặc endpoint library tương ứng), scope tenant của job. Runtime KHÔNG đọc tài liệu ngoài `items`.
- Snapshot stage `agent.cli` KHÔNG cần token cho nguồn (snapshot đã trên đĩa, chỉ-đọc). Job-token stage giữ như H2c (cho `attachments` thường).
- **Layout mount library:** `work/<job_id>/sources/<key>/<tên-tài-liệu-đã-chuẩn-hoá>` — 1 tài liệu / nguồn library, tên = tên hiển thị tài liệu đã sanitize (bỏ ký tự đường dẫn); bản ghim = `version` (id bản tài liệu). (LB-01/04)

### 4.3 Kiểm `## Nguồn tham chiếu` tồn tại (C16)
`checkSourceRefs` (§3.4) kiểm `key∈stage` + `@version` khớp pin ở Hub. Phần "path tồn tại trong snapshot" (PB-R07 cuối): Hub không có snapshot ⇒ đối chiếu với `files_read` Runtime báo (C18 `job.result.source_reads`); nếu `files_read=null` (D8 parse hỏng) ⇒ BỎ kiểm tồn tại (chỉ key+version), ghi cảnh báo. OC-07.

## 5. DDL migration `0021_pb_sources.sql` (viết tay, idempotent như 0019)
Khối: (1) `hub.sources`; (2) `hub.source_job_reads`; (3) ALTER ADD cột nullable `process_defs`/`process_runs`; (4) DROP+ADD `hub.jobs jobs_type_ck` gồm `source.resolve`; (5) RLS + GRANT. Mẫu CHECK/RLS theo `0000`/`0019`.

```
-- (1)
CREATE TABLE IF NOT EXISTS hub.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, key text NOT NULL, kind text NOT NULL,
  config jsonb NOT NULL, description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT sources_key_ck CHECK (key ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT sources_kind_ck CHECK (kind IN ('git_remote','local_path','library')),
  CONSTRAINT sources_config_ck CHECK (jsonb_typeof(config)='object'),
  CONSTRAINT sources_desc_ck CHECK (char_length(description)<=500),
  CONSTRAINT sources_version_ck CHECK (version>=1));
CREATE UNIQUE INDEX IF NOT EXISTS sources_tenant_key_uq ON hub.sources(tenant_id,key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS sources_tenant_idx ON hub.sources(tenant_id) WHERE deleted_at IS NULL;
-- (2)
CREATE TABLE IF NOT EXISTS hub.source_job_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, process_run_id uuid NOT NULL, stage_run_id uuid NOT NULL,
  job_id uuid NOT NULL, source_id uuid NOT NULL, source_key text NOT NULL,
  pin jsonb NOT NULL, files_read text[], bytes_read bigint, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_job_reads_pin_ck CHECK (jsonb_typeof(pin)='object'),
  CONSTRAINT source_job_reads_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS source_job_reads_run_idx ON hub.source_job_reads(process_run_id);
CREATE INDEX IF NOT EXISTS source_job_reads_source_idx ON hub.source_job_reads(source_id);
-- (3) ADD COLUMN IF NOT EXISTS: process_defs.sources jsonb, process_defs.inputs jsonb (CHECK jsonb_typeof=array khi NOT NULL)
--     process_runs.pinned_sources jsonb, process_runs.sources_pinned_at timestamptz, process_runs.inputs jsonb
-- (4) hub.jobs jobs_type_ck: DROP CONSTRAINT IF EXISTS + ADD gồm 'source.resolve' (kiểm pg_constraint)
--     review_tasks_reason_ck (0019:316): DROP+ADD thêm 'source_unresolvable' (reason mới, idempotent)
-- (5) ALTER TABLE ENABLE RLS; policy *_hub_rw USING/WITH CHECK v_t (system OR user∧tenant_id=GUC); GRANT hub_rw;
--     source_job_reads chỉ INSERT+SELECT (không UPDATE/DELETE); agent_runtime KHÔNG GRANT.
```
Idempotent: `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS`/kiểm `pg_constraint`,`pg_policies` như 0019. Chạy lại `done:pa` (D10) sau migration.

## 6. Fix #133 / #134 (KHÔNG migration)

### 6.1 #134 — team fail ghi error_code sai ⇒ run kẹt (PB-R17, AC-PB-03)
**Tái hiện:** quy trình stage `executor:team`, 1 member fail (agent_failed hoặc job_timeout) ⇒ `team-member.ts:93 closeMemberRun(d, runId, failed=true)` chạy `UPDATE hub.runs SET status='failed', owner=null, lease_until=null WHERE id=.. AND status='running'` — KHÔNG set `error_code` ⇒ `runs_error_code_ck` (`0000:297` `(error_code≠null)=(status∈{failed,cancelled})`) vi phạm ⇒ `UPDATE` ném ⇒ bong qua `runMember`→`team-exec`→`stage-driver.ts:83` catch ⇒ chỉ `ctx.writer.abort()`; `hub.process_runs` không chuyển trạng thái ⇒ kẹt `running`.
**Sửa:**
- `team-member.ts closeMemberRun(d, runId, outcome: MemberOutcome)`: khi `outcome.kind==='failed'` set `error_code` = `reason==='job_timeout' ? 'TIMEOUT' : 'UPSTREAM_ERROR'`, kèm `error_message` + `error_hint` (cùng non-null, `runs_error_cols_ck`). Gọi: `closeMemberRun(d, prepared.run.id, outcome)`.
- `stage-driver.ts drive` catch (dòng 83): thay `if(!ctx.writer.done) ctx.writer.abort()` bằng: `abort()` + chuyển `process_runs → needs_decision` qua `toDecision(reason)` (reason map PB-R17) trong tx scope system; không để kẹt `running`. (Tách helper `failStuckRun(d, hubRunId, reason)` tra `link` → `toDecision`.)
- `apply`/`runApplyTx`/`finish`: bọc try/catch quanh ghi; lỗi ghi ⇒ vẫn đặt stage `failed` + run `needs_decision`, không ném tiếp.
- Unit: `team-member.test.ts` (closeMemberRun ghi mã hợp lệ), `stage-driver` catch → needs_decision. int: job team fail → `hub.runs.error_code ∈ 7`, run `needs_decision`, không crash.

### 6.2 #133 — member sau tải attachment 404/401 (PB-R18, AC-PB-03/04)
**Chỗ ráp:** `team-exec.ts:300 draftFiles()` → `mkCall:263` → `MemberCall.files` → `team-member.ts:71 runMember` → `prepareProcess({files})` → `run-files.rules.ts:98 jobAttachments` → `payload.attachments`. Tải: `internal/attachments.service.ts:54 findJobFile` đòi `attId∈payload.attachments` ∧ `jobAttachment(attId,tenantId)` có hàng.
**Sửa:**
- Nháp ghép (`draftFiles`) hiện `id=crypto.randomUUID()`, nội dung chỉ trong RAM ⇒ member sau không tải được. Persist nháp thành `hub.attachments` thật (origin `output`, gắn `process_run`/job, như `output-attachment.ts commitOutputBlob`) TRƯỚC khi đưa vào `files` của member kế; dùng id thật.
- Thêm chốt chặn PB-R18 lúc ráp `files`/`sources` cho job member + agent đơn: mỗi `attachment id` phải thuộc `process_run_id` này + `tenant_id` (truy `hub.attachments`/`process_outputs` cùng run); id lạ ⇒ loại, log cảnh báo. Đặt ở `launcher.priorFiles` + `team-exec.draftFiles` (hoặc helper `runScopedFileIds`).
- Unit: guard loại id ngoài run. int (AC-PB-04): `payload.sources`/attachment chứa id run/tenant khác ⇒ 401. int (AC-PB-03): team ≥2 member nhận output stage trước ⇒ member 2+ fetch 200, run tới `finished`/`awaiting_review`.

## 7. Thứ tự PF (lát build)
| PF | Nội dung | Phụ thuộc |
|---|---|---|
| PF-S1 | Contract (sources/job/resolve/errors + gen pydantic) + DDL 0021 + CRUD `hub.sources` (routes/service/repo, RLS, quyền local_path) + "Kiểm tra kết nối" khung | — |
| PF-S2 | agent-runtime: resolve (git CLI/library/local_path), mirror+snapshot cache (lọc PB-R07, trần, nguyên tử), SSRF/inject guard, endpoint report; hook deny ghi `sources/`, `allowedTools` R/G/G (`options.py`+test) | PF-S1 |
| PF-S3 | Hub giao nguồn vào job: def/run ghim + kênh resolve (launcher gate, resolve.service, pinned_sources), `payload.sources`, MANIFEST + prompt + kiểm `## Nguồn tham chiếu`, audit `source_job_reads` | S1,S2 |
| PF-S4 | Fix #133 + #134 | — (độc lập; làm sớm song song) |
| PF-S5 | Smoke Claude thật (UAT, trần ≤50k token; không CI) | S2,S3 |

PF-S4 không phụ thuộc nguồn ⇒ làm trước/song song để gỡ BLOCKER stage nhóm.

## 8. Rủi ro (model khi BUILD — xem tasks.md)
Cao: RLS `hub.sources`/audit, kênh resolve (job-token, cross-run 401), SSRF/inject git, ghim/pinned, fix #133 (id scope)/#134 (trạng thái khoá). Thường: CRUD shape, MANIFEST/prompt, DDL cột nullable, chip.

## 9. Điểm mở cần qc/frontend
- qc: AC-PB-03/04 cần fixture repo git cục bộ (`file://`, `NODE_ENV!=production`, PB-R19) + `fake-cli #fake:read sources/<key>/<path>` (ghi audit). AC-H36 (a)–(g) chia test theo spec §8.
- frontend: `SourceConfigPublic` (ẩn path) cho tenant_admin; form `!key` + chip (`GET /process-runs/sources`); cảnh báo "đường dẫn trên máy Runtime".
- `source_unresolvable` là `DecisionReason` mới ⇒ cập nhật `DECISION_REASONS` (contracts) + `review_tasks_reason_ck` (migration 0021 DROP+ADD, §5(4)) + state-rule/`optionsFor` (add_attempt=retry/cancel). ĐÃ ghim ở S1-3/S1-4.
- Reconcile 422 vs async: spec PB-R05 ghi "422 SOURCE_UNRESOLVABLE" — áp cho đường **đồng bộ** "Kiểm tra kết nối" (§4.6) + validate tĩnh lúc start; resolve **bất đồng bộ** thất bại ⇒ run `needs_decision` (Gate chốt "thất bại → needs_decision"). Không đổi contract đã duyệt (mã lỗi vẫn như §3.6).

### 9.1 Chốt PLAN-reconcile (2026-10-11)
Mọi điểm mở backend (test-plan §6; plan-frontend §9; plan §9) chốt ở **spec.md §9 bảng C1–C23** (cột "Ảnh hưởng" trỏ ai cập nhật + test ID); shape/chữ ký ở plan §2/§3.1–§3.4/§4.1–§4.3. Routing: frontend-lead → C2,C3,C4,C20,C23,C1; qc → C5–C19,C21,C22.
