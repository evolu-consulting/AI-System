---
id: CR-118
requirements: UW-FR-01..15, ADM-FR (trang app, năng lực)
design: ../../adr/0034-web-hop-nhat.md
trạng thái: Đang làm (2 đợt, chưa push/deploy); intake 26 câu TẤT CẢ theo mặc định + N1–N3 (2026-11-04)
---
# CR-118 · Web hợp nhất + feature management + flow runtime (spec master)

Delta hành vi cũ: `../cr118-spec/tasks.md`.

## 1. Phạm vi theo đợt
| Đợt | Nội dung | Không làm |
|---|---|---|
| 1 — Web gộp + FeatureGate | `apps/sohoptac-web` (git mv contracts-web) nhận Community làm module; một shell/router/phiên; `/pack/me` + OpenFeature + SSE; React 19.2.9 + Compiler; depcruise 6 luật; deploy-kit | admin-api redeem SSO; route SHT; CSS Community sang shadcn |
| 2 — Flow + UX + năng lực | FlowRuntime, node `form`, `/apps/$appKey` 5 tab, tenant chỉ xem, `TenantCapabilityView` | Low-code màn/trạng thái; tenant tự sửa quy trình; route đóng băng; Dify mới; DLC |
npm: `react` 19.2.9 (2026-10-14), `babel-plugin-react-compiler` 1.0.0 (chỉ app gộp), `@openfeature/web-sdk` 1.10.0, `@openfeature/react-sdk` 1.4.1 (lát kiểm peer). Web khác giữ React 18.

## 2. Module / route map
| Đường dẫn | Module | Ghi chú |
|---|---|---|
| `/` | shell | home theo `default_app`/quyền: contracts → `/overview`; đối tác → `/community` |
| `/overview`, `/contracts/$id`, `/partners`, `/products`, `/settings/*`, `/notifications` … | contracts | GIỮ NGUYÊN path gốc (bookmark, email, DocuSign, baseline) |
| `/community`, `/community/profile/$orgId/$section` | community | lazy chunk; `/community?settings=1` mở dialog Cài đặt |
| `/login`, `/sso`, `/privacy`, `/terms` | platform | `/sso` giữ (admin/chat hand-off vào) |
Hash cũ (`legacy-hash.ts` thuần + unit): `#/feed`→`/community`; `#/profile/<o>/<s>`→`/community/profile/<o>/<s>`; `#/settings`→`/community?settings=1`.
301 (edge): `community.<d>/*` → `sohoptac.<d>/community` (host chính; fragment giữ); proxy `/auth`,`/pack` giữ 30 ngày; `COMMUNITY_WEB_URL` + catalog `community` = `https://sohoptac.<d>/community`, `sso=false`.
Phiên: một phiên `X-App: contracts` (`ai_rt_contracts`); đối tác đăng nhập lại 1 lần; login gộp có đổi mật khẩu bắt buộc + TOTP; `/community*` không bounce sang AI System.

## 3. Cây thư mục đích + 6 luật depcruise (mức error)
`src/{app, routes (mỏng: path+beforeLoad+lazy), shell (chỉ đọc manifest), platform/{auth,features,flow,brand,i18n,prefs}, shared/{kernel (thuần), ui}, modules/{contracts,community}/{manifest.ts,i18n.ts,domain,application,adapters,ui}}`. Contracts giữ `features/<f>/{lib,hooks,api.ts,components,pages}` dưới `modules/contracts/`, ánh xạ lớp bằng luật.
| # | Luật | Cấm / chỉ cho |
|---|---|---|
| 1 | web-mod-no-cross-module | `modules/X → modules/Y`; liên module chỉ qua chuỗi route + port server (ADR-0031) |
| 2 | web-shell-manifest-only | `shell → modules/*` chỉ `manifest.ts`; `modules → shell` cấm |
| 3 | web-domain-pure | `domain`/`features/*/lib` không react, web-kit, adapters, ui |
| 4 | web-ui-no-adapters | `ui`/`components` → `adapters`/`api.ts` cấm (qua application/hooks) |
| 5 | web-features-port-only | mọi nơi → `platform/features/*` chỉ qua `index.ts` |
| 6 | web-business-no-other-web | app gộp không import `apps/(admin|chat|studio|dlc-workspace)-web` |
Đợt 2 thêm: `modules → platform/flow` chỉ `index.ts`. Ngân sách: initial JS 150 KB/CSS 25 KB; chunk community JS ≤ 60 KB gz, CSS ≤ 15 KB gz; `check:size`/`check:fn` giữ.

## 4. FeatureGate / OpenFeature (UW-FR-04..06)
App chỉ dùng hook OpenFeature + `<Gate>`/`useCan` qua `platform/features/index.ts`. Provider mỏng đọc `GET /pack/me`; context = (tenant, user); `beforeLoad` gọi `gate.ensure()`; module tắt → không DOM/route/chunk.
| Mục | Hợp đồng |
|---|---|
| `GET /pack/me` (hub packs/kit; schema `ShellMeResponseSchema` @ai/contracts/packs) | `{ packs:{contracts:{enabled,actions[]}, community:{enabled,actions[],role}}, addons:[key], brand:{name,appName,logo,accent}, home, versions:{config,hub} }`; đối tác: `contracts` luôn `{enabled:false,actions:[]}`, addons chỉ của community |
| Nguồn / hiệu năng | ConfigCache (0 SQL nóng; nguội ≤ 1); p95 nóng ≤ 5 ms, nguội ≤ 15 ms, 304 ≤ 2 ms; thân ≤ 8 KB gz |
| ETag | `"<config_version>.<hub_config_version>"`; `If-None-Match` → 304; `Cache-Control: private, no-cache`; cache web xoá khi hết phiên |
| SSE (N3) | `/me/stream` thêm event `config.changed`, data `{config_version,hub_config_version}`, phát khi hub nạp lại ảnh (LISTEN `config_changed`/`hub_config_changed`) |
| Web | Query key `["platform","me"]`; `config.changed` → refetch (304 rẻ); dự phòng: focus, 403/404 gói tắt, `staleTime` 60 s |
| Fail-closed | server (pack guard) là nguồn thật; gate web chỉ ẩn UI; module vừa tắt → về home + toast. Độ trễ: hub nạp ≤ 5 s, web gần tức thời (SSE) hoặc ≤ focus/60 s |

## 5. FlowRuntime (UW-FR-10..15, đợt 2)
| Phần | Hợp đồng |
|---|---|
| Ports (`platform/flow/port.ts`) | `FlowRuntime{view(slot,ref), act(taskId,action,payload), summary(slot,refs[≤100])}`; `FlowDefinitionReader{current(slot)}` chỉ đọc |
| Server (hub packs/kit, route mới) | `GET /pack/:k/flow/:slot/:ref` · `POST /pack/:k/flow/tasks/:id/actions/:action` · `POST /pack/:k/flow/:slot/summary` (SQL cố định mỗi lô; p95 ≤ 50 ms lô 100). Gói cấp `SlotAdapter` (ref→run, quyền đọc, hành động gói) qua PackRunsPort |
| Renderer registry | `RENDERERS:{[K in FlowStepKind]}` thiếu loại ⇒ lỗi typecheck; loại lạ ⇒ `GenericStepRenderer`; renderer lazy theo loại; `LegacyMachineRenderer` cho lượt `mode=machine` |
| Node `form` (engine, additive, `test:frozen`) | người làm có form; quyết + payload ghi vào stage output trong CÙNG transaction; idempotent; validator dựng từ form trong SNAPSHOT (strict, bỏ trường lạ) |
| Field subset | `text, textarea, number, money, date, select, checkbox`; ≤ 20 trường; không HTML/script/biểu thức; nhãn render text |
| Quyền | `canAct` engine + quyền gói; đối tác không làm bước ở khe contracts; ref tra qua SlotAdapter trong `withScope` tenant; audit mọi act |
Thêm loại bước = contract + `hub nodes/<kind>` + editor admin-web + renderer; thêm khe = hàng `process_slots` + def mặc định + SlotAdapter + `<FlowPanel>` (migration hub ≥ 0087, chỉ slot-intake COULD).

## 6. Trang cấu hình app `/apps/$appKey` (platform_admin)
| Tab | Nội dung (dùng lại component, một đường lưu) |
|---|---|
| Tổng quan · Tính năng | mô tả, số công ty theo mức, khe, cảnh báo cấu hình, AppFormDialog · FeatureGroupSection lọc app, "Đang bật ở n công ty", vai theo app: tóm tắt + link |
| Quy trình | mỗi khe một thẻ (mặc định + phiên bản, sơ đồ chỉ đọc, công ty đang dùng); Sửa → `/processes/$id` (editor duy nhất) |
| Công ty | bảng mức/add-on/khe; ngăn kéo = đúng `AppCard` + khe (chung `/tenants/$id?tab=features`); xác nhận nêu tác động; `GET /admin/apps/:key/tenants` nếu cần (Opus, platform_admin) |
| Xem trước | công ty × vai (Quản trị/Thành viên/Đối tác) × bản lưu/nháp; `previewApp(manifest, entitlements, slotAssignments, role)` thuần, dùng chung shell (`@ai/contracts/apps/<key>.manifest.ts`) |
Tenant chỉ xem: web gộp › Cài đặt › "Ứng dụng & quy trình" (quản trị công ty + chủ gói): mức, add-on, mỗi khe tên + phiên bản + sơ đồ + luật CR-113; không nút sửa; thành viên/đối tác không thấy. `/features`, `/processes` giữ.

## 7. Capability read-model (không bảng mới, không migration)
8 khái niệm: Tenant(+Group/Vai) · App · Feature · Capability (Agent/Flow/Tool; owner = App hoặc Dùng chung) · Slot · Binding · Policy · Snapshot. Hàm thuần GHÉP kết quả luật gốc (`computeEffectiveAccess`, `effectiveAgents`, `packAccessInput`, `resolveSlot`), test tương đương từng luật; luật thật chạy chỗ cũ.
| Endpoint | Ai | Mục tiêu (đo `-Exclusive`, tuần tự) |
|---|---|---|
| `GET /pack/me` | người dùng (lát cắt tenant×user) | như §4 |
| `GET /hub-admin/tenants/:id/capabilities` | platform_admin; tenant_admin chỉ tenant mình, chỉ đọc | 0 SQL nóng, p95 ≤ 20 ms (≤ 50 agent, ≤ 20 khe, ≤ 200 feature); ≤ 3 SQL khi ảnh hub thiếu; ETag/304 |
Nạp ảnh sau NOTIFY: SQL cố định, ≤ 200 ms/100 tenant (ghi số thật). Không làm chậm contracts.list p95 ≤ 58,4 ms ×1,1, chat.first-delta p50 ≤ 43,7 ms ×1,1. Baseline mới `perf/baseline/platform.{me,capabilities}.json`. Dify chỉ đọc (ADR-0022); DLC không đụng. UI: tab "Ứng dụng & năng lực" (key URL `features`): thẻ app (+Agent/Tool), Dùng chung, Giới hạn, lý do không hiệu lực.

## 8. Lát
Làn: **F**=đầy đủ (Opus medium, test trước), **N**=nhanh. | Lát | Đợt | Làn | Model | Phụ thuộc |
|---|---|---|---|---|
| spec (docs) | 1 | N | Sonnet | — |
| move (git mv + dời thư mục + luật 1–6) | 1 | N | Sonnet high | spec |
| react19 (19.2.9 + Compiler) | 1 | N | Sonnet high | move |
| feature-gate (hub `/pack/me`, SSE, web OpenFeature) | 1 | F | Opus (server) + Sonnet (web) | move |
| auth (một phiên, login gộp, guard) | 1 | F | Opus | move |
| community-module | 1 | N | Sonnet | move, react19 |
| shell | 1 | N | Sonnet | feature-gate, community-module |
| i18n-css · deploy-kit | 1 | N | Sonnet | community-module · auth |
| e2e (viết, không chạy) | 1 | N | Sonnet | shell, i18n-css |
| cleanup (xoá community-web) | 1 | N | Haiku | cả đợt 1 |
| flow-contract | 2 | F | Opus | đợt 1 |
| flow-api | 2 | F | Opus | flow-contract |
| node-form (engine Opus; editor/renderer Sonnet) | 2 | F | Opus + Sonnet | flow-contract |
| flow-web · flow-admin | 2 | N | Sonnet | flow-api (mock) · — |
| capability-model → capability-api | 2 | F | Opus | feature-gate |
| app-manifest | 2 | N | Sonnet high | feature-gate |
| admin-app-page → admin-app-tenants (+endpoint F, Opus) | 2 | N + F | Sonnet + Opus | app-manifest |
| capability-ui · tenant-settings | 2 | N | Sonnet | capability-api + admin-app-page · flow-web |
| e2e2 (viết, không chạy) | 2 | N | Sonnet | các lát UI |
| slot-intake (COULD) | 2 | F | Opus + Sonnet | node-form, flow-web |
Tên lát `cr118-<…>`. `move` chỉ chạy khi không lát nào khác mở trên contracts-web. Migration: dự kiến không (admin 0033 / hub ≥ 0087 do điều phối giao).

| community-ui (§11.1) | 2 | N | Sonnet | shell |
| flow-routing: chọn quy trình theo điều kiện (§11.2; engine/resolve Opus, admin UI Sonnet) | 2 | F | Opus + Sonnet | flow-api, admin-app-page |

## 11. Bổ sung người dùng 2026-11-04
### 11.1 Community UI (làn N)
- **Thẻ đăng bản tin (composer):** thêm nút thu gọn về trạng thái tối thiểu (một dòng "Bạn đang nghĩ gì…"), bấm lại để mở; nhớ trạng thái theo người dùng (localStorage, lỗi ⇒ mặc định mở).
- **Đính kèm:** gộp nút Ảnh + Video thành một nút "Đính kèm"; cho tải file bất kỳ (ảnh/video xem trước như cũ, file khác hiện thẻ tên + dung lượng + tải về). Giới hạn kích thước/loại lấy từ cấu hình upload hiện có (FileBox); quét loại MIME phía server, không tin đuôi file.
- **Dialog Cài đặt:** sửa padding các mục sidebar trái cho đều (theo token `--cm-*`); phần cài đặt Sổ Hợp Tác hiển thị NGAY trong dialog Cài đặt Community (một mục/nhóm "Sổ Hợp Tác"), không mở trang riêng; chỉ hiện khi `/pack/me` bật app contracts và người dùng có quyền.
- Kịch bản e2e (viết, chạy cuối đợt): thu gọn/mở composer; đăng bài kèm PDF; mở Cài đặt › Sổ Hợp Tác không đổi URL ngoài `?settings=`.

### 11.2 Nhiều quy trình mỗi tenant + điều kiện chọn quy trình (làn F)
- **Gán quy trình cho tenant:** một tenant có thể có NHIỀU quy trình (nhiều phiên bản/định nghĩa cho cùng khe và nhiều khe). Quy trình chỉ hiện với tenant admin sau khi **platform_admin gán** quy trình đó cho tenant (trang `/apps/$appKey` › tab Công ty, hoặc `/tenants/$id`). Chưa gán ⇒ tenant không thấy, không chọn, không chạy được.
- **Điều kiện chọn quy trình (routing):** mỗi khe của tenant có danh sách luật có thứ tự `{điều kiện → quy trình}` + một quy trình mặc định. Điều kiện bản đầu: **phòng ban của người khởi tạo** (một hoặc nhiều phòng ban, gồm phòng ban con); mở rộng sau (loại hợp đồng, giá trị) theo cùng cấu trúc. Luật đầu tiên khớp thắng; không khớp ⇒ mặc định; không có mặc định ⇒ chặn khởi tạo với thông báo rõ.
- **Chốt khi khởi tạo:** quy trình được chọn ghi vào run (snapshot definition + id luật đã khớp) lúc launch; đổi luật/gán sau KHÔNG ảnh hưởng run đang chạy.
- **Ai sửa (người dùng chốt 2026-11-04):** platform_admin gán/bỏ gán quy trình cho tenant và sửa được luật. **Tenant admin tự sửa luật chọn quy trình** của tenant mình ở "Cài đặt › Ứng dụng & quy trình" (thêm/xoá/đổi thứ tự luật, chọn phòng ban, chọn quy trình mặc định), nhưng CHỈ chọn trong số quy trình platform đã gán; không sửa nội dung quy trình, không gán thêm. Đây là ngoại lệ duy nhất cho câu "không nút sửa" ở §6. Thành viên/đối tác không thấy.
- **Chặn phía server khi tenant admin lưu:** chỉ tenant của chính mình (`withScope`); mọi `processId` phải thuộc danh sách đã gán; mọi `departmentId` phải thuộc tenant; ≤ 50 luật mỗi khe; lưu cả danh sách trong MỘT transaction (thay thế, có `version` chống ghi đè đồng thời ⇒ 409); ghi audit (ai, trước/sau); bump `config_version` + `config.changed`. Platform bỏ gán một quy trình đang được luật dùng ⇒ chặn với danh sách luật bị ảnh hưởng (hoặc xác nhận chuyển luật đó về mặc định).
- **Test thêm:** int tenant admin lưu luật OK; tenant admin chọn quy trình chưa gán ⇒ 422; phòng ban tenant khác ⇒ 422; tenant admin tenant khác ⇒ 403/404; ghi đồng thời ⇒ 409; thành viên ⇒ 403. e2e (viết, chạy cuối đợt): tenant admin thêm luật theo phòng ban, người phòng đó khởi tạo ⇒ đúng quy trình.
- **Dữ liệu:** mở rộng bảng gán khe hiện có theo tenant (thêm `priority`, `condition jsonb` dạng `{departmentIds: uuid[]}` đã validate bằng zod; RLS theo tenant; `process` phải thuộc danh sách đã gán). Migration hub số do điều phối giao (≥ 0087, tránh 0071–0080 và 0085). Resolve bằng hàm thuần `pickProcess(rules, initiatorDeptPath)` + một câu SQL cố định khi launch (nằm trong ảnh cấu hình nóng, 0 SQL thêm); bump `config_version` + `config.changed` khi đổi.
- **Test:** unit `pickProcess` (khớp phòng ban con, thứ tự, mặc định, không mặc định); int: gán/bỏ gán, tenant khác không đọc được luật (RLS), launch chọn đúng quy trình theo phòng ban, run cũ giữ quy trình khi đổi luật; perf launch không vượt PD-P01 hiện tại.

## 9. Kế hoạch test
- Trong lát: unit luật thuần (gate, nav, legacy-hash, login outcome, home pick, previewApp); int một đường chính mỗi endpoint + chặn chéo tenant + đối tác + đếm SQL; e2e viết không chạy.
- Một lần cuối MỖI đợt, evotest (T1): `run-tests.ps1 -Step e2e -Filter <job>` (đợt 1: sohoptac-web, community, N1, deployed; đợt 2 thêm admin app-config, P-a) + `-Capture cw` + `test:all --no-frozen`; đợt 2 thêm `test:frozen`, `dlc:check`; chỉ báo đỏ mới (`known-red.json`). Perf `-Exclusive` do điều phối, một lần, tuần tự.
- UAT stg riêng: project `sohoptac2-cr118`, image tag `cr118` (KHÔNG `:latest`), cổng 127.0.0.1:2853x, tunnel, DB tmpfs, seed demo; 3 vai (chủ quản admin, member, đối tác): chuyển Community↔SHT không reload, tắt Community ⇒ nav mất, đối tác gõ `/contracts`. Dọn: `down -v`, xoá image `cr118`, `e2e:reap`, `e2e:lanes --prune`, xoá worktree (kiểm đĩa F:).
- Cuối đợt: một review + security Opus medium trên diff gộp.

## 10. Rollout / rollback (chỉ khi người dùng xác nhận deploy)
1. Kiểm VERSION/migration prod trước (lệch deploy 2026-10-30). 2. Deploy lên `sohoptac.<d>`; cùng lần đổi catalog community + `COMMUNITY_WEB_URL`, `community.<d>` 301. 3. `e2e-deployed` + verify-ui.
Rollback: giữ image tag trước; trả server block 8085 + catalog community về URL cũ (không migration).
