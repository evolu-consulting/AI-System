---
id: CR-120
requirements: FLOW-FR-01..13 (§1)
design: ../../adr/0036-app-must-declare-slots.md
trạng thái: Spec 2026-11-05
---
# CR-120 · Flow là xương sống thật

Người dùng chốt 2026-11-05: flow là xương sống mọi app; app nào cũng PHẢI có flow; flow động; dữ liệu một nguồn; bật runtime ở
prod trong CR này; Community 3 khe. Nền: CR-118 §5/§6/§11.2, ADR-0017/0030/0035; XÂY TRÊN lát `hub-routing-backfill` (0089).

## 1. Yêu cầu
FLOW-FR-01..03 = §2 (khe bắt buộc, check, hiển thị /apps + Cài đặt mọi khe, cảnh báo thiếu) · 04..05 = §3 (một nguồn, bất biến) ·
06 = §4 (runtime bật) · 07 = §5 (loại bước) · 08..11 = §6 (def Contracts + 3 khe Community) · 12 = §7 · 13 = §8b (một khung UI).

## 2. Hợp đồng App ↔ khe (A)
`AppSlotDecl` (`packages/contracts/src/app-manifest/manifest.ts`) — thêm trường, giữ `key/label/level/addon`:
| Trường | Kiểu | Luật |
|---|---|---|
| `purpose` | string ≤ 200 | câu ngắn, hiện ở /apps + Cài đặt |
| `required` | boolean (mặc định true) | true ⇒ thuộc bất biến FLOW-FR-05 |
| `defaultDefKey` | `ProcessKey` | key def thư viện (`tenant_id null`) seed bằng migration hub; = `process_slots.default_def_id` |
| `allowedKinds` | `FlowStepKind[]` ≥ 1 | editor admin-web chặn loại khác (422 `STEP_KIND_NOT_ALLOWED` khi lưu/xuất bản) |
| `trigger` | string ≤ 120 | sự kiện mở lượt (vd `post.created`), hiển thị |
SlotAdapter = `FlowSlotAdapter` (ADR-0035) đăng ký cùng `SlotSpec` lúc mount gói, khoá = `key` khe.

| Kiểm | Ở đâu | Đỏ khi |
|---|---|---|
| tĩnh | `bun run check:app-slots` (lefthook + CI) | 0 khe; `allowedKinds` rỗng/lạ; `defaultDefKey` sai dạng; key trùng |
| khởi động | `packs/kit` mount | khe manifest thiếu `SlotSpec`/`FlowSlotAdapter` ⇒ log error + ops-watch đỏ (không chặn boot) |
| dữ liệu | int `slot-contract.int.test.ts` | khe thiếu hàng `process_slots`/def mặc định xuất bản |
Khe CR-120: `contracts.approval` (có), `contracts.intake` (mới), `community.post-moderation`, `community.partner-join`, `community.report`.

## 3. Một nguồn cho gán (B)
| Bảng | Vai trò sau CR-120 |
|---|---|
| `hub.process_tenant_defs` | tập def đã gán tenant × khe — NGUỒN |
| `hub.process_routings` + `process_routing_rules` | luật chọn; luật `is_default` = def hiệu lực khi không luật nào khớp — NGUỒN |
| `hub.process_slots.default_def_id` | mẫu cấp phát khi tenant bật app (không phải gán) |
| `hub.process_slot_assignments` | 0091: bảng → `…_legacy`, VIEW cùng tên từ luật `is_default` (chỉ đọc); CR-121 xoá |

| Migration | Số / `when` | Nội dung | Lát |
|---|---|---|---|
| hub 0089 | 1803500000000 | (đang mở) gán cũ → `process_tenant_defs` | hub-routing-backfill |
| hub 0090 `slot_default_rules` | 1803600000000 | gán cũ ⇒ `process_routings` + luật `is_default` (priority 49) nếu chưa có; một câu theo tập, chạy lại vô hại | cr120-single-source |
| hub 0091 `slot_assign_view` | 1803700000000 | đổi tên bảng cũ, tạo VIEW; audit giữ | cr120-single-source |
| hub 0092 `community_slots` | 1803800000000 | 3 hàng `process_slots` + 3 def thư viện + bản xuất bản | cr120-community-flows |
| hub 0093 `contracts_intake_slot` | 1803900000000 | khe `contracts.intake` + def + bản xuất bản | cr120-contracts-flow (đợt 2) |
| community 0008 `flow_states` | 1803600000000 (journal community) | `posts.moderation` (`none|pending|approved|rejected`, mặc định `none`), `join_requests`, `reports` + RLS; feed ẩn `pending/rejected` | cr120-community-flows |
Thứ tự `when` > max hiện có (hub 1803500000000 sau 0089; community 1803300000000). Không dùng 0071–0080, 0085.

- `resolveSlot` (một câu cố định): luật `is_default` của tenant × khe ⇒ bản xuất bản; KHÔNG còn đọc `process_slot_assignments`.
- Đường gán cũ `PUT|DELETE /tenants/:tid/process-slots/:slot` + `assignByKey` (onboarding) ghi luật `is_default` (+ tập gán) trong MỘT tx.
- Cấp phát: `ensureSlotDefaults(tenantIds?)` — một câu theo tập mỗi khe, chạy lúc boot + khi bật app (`config_changed`): tenant bật app thiếu mặc định ⇒ gán `defaultDefKey` + luật `is_default`. Idempotent.
- Bất biến FLOW-FR-05 = `count(tenant bật app × khe bắt buộc không có is_default có bản xuất bản) = 0`.

## 4. Runtime bật (C)
| Hạng mục | Quyết định |
|---|---|
| Cờ | `flowRuntimeOn = env.HUB_FLOW_RUNTIME !== "off"` (mặc định bật); `/pack/me.flags["flow.runtime"]` giữ nguyên |
| Hành động duyệt | web gọi `FlowRuntime.act` (`POST /pack/contracts/flow/contracts.approval/:ref/tasks/:id/actions/:action`); adapter gọi use case cũ |
| Xoá đường UI cũ | thẻ duyệt gọi thẳng approvals; phép chiếu FlowView ở web ⇒ `GET /pack/:k/flow/:slot/:ref` |
| Rollback | `HUB_FLOW_RUNTIME=off` ⇒ adapter http của web chuyển `act` về endpoint approvals cũ (giữ ở hub 1 bản phát hành; một file `flow/adapters/legacy-act.ts`, CR-121 xoá) |
| Prod | bật khi deploy CR-120 — CHỈ khi người dùng xác nhận; kiểm VERSION/migration prod trước |

## 5. Loại bước (D)
| Loại (FlowView) | Engine hôm nay | Khoảng trống → lát |
|---|---|---|
| review (duyệt) | `after.kind=review`: group/head_only/approver, `remind_every_h`, `escalate`, `branch` | — |
| form | executor `form` (CR-118) | — |
| agent | executor `agent`/`team` | G1: thêm `agent` vào `FLOW_STEP_KINDS` + renderer (đang hiện `system`) → community-flows |
| tool Dify | executor `tool` (workflow catalog) = kind `dify` | — |
| tool MCP | không có | G2: nguồn catalog `mcp` (Agent Hub) → contracts-flow, COULD |
| wait ngày | `wait-until` (ngày gốc + `offset_days`) | — |
| wait khoảng / sự kiện | không có | G3 `wait-for` (N giờ); G4 `wait-event` (khoá sự kiện + hạn) → contracts-flow |
| nhắc/chuyển cấp | chỉ ở review | G5: `remind_every_h`/`escalate` cho task `form` → contracts-flow |
| if / set | có | — |
| esign | chỉ máy trạng thái contracts | G6: tool pack-port `contracts.esign.send` + `wait-event esign.completed` → contracts-flow |
Mỗi loại mới = contract + `hub nodes/<kind>` + editor + renderer (ADR-0035 §4); engine chỉ cộng thêm, `test:frozen` xanh.

## 6. Def mặc định (E)
| Khe | Bước (→) | Ghi chú |
|---|---|---|
| `contracts.intake` | Nhận HĐ (upload) → agent trích xuất → form bổ sung → review theo luật CR-113 → esign (G6) → wait-until ngày nghĩa vụ − N + nhắc | allowedKinds: agent, form, review, dify, esign, wait, system |
| `community.post-moderation` | agent `screen` (field `flagged`, `reason`) → if flagged ⇒ review (quản trị community, nhắc 24 h, chuyển cấp 48 h → tenant admin) → set approved/rejected; else set approved | agent lỗi/hết hạn ⇒ review (KHÔNG tự đăng); trigger `post.created` khi khe có def |
| `community.partner-join` | form (tên công ty, người liên hệ, email, lý do) → review tenant admin → set ⇒ tạo liên kết org đối tác (org.repo) | người làm form = người xin; đối tác không làm bước review |
| `community.report` | agent `triage` (loại, mức) → review điều phối viên → set hành động (ẩn / giữ / cảnh báo) | báo cáo trùng (cùng người × đích) ⇒ 409 |
Agent seed theo key (`community-screen`, `community-triage`, `contracts-extract`). Không dữ liệu NitiGroup/titi trong seed/test.

## 7. Kiểm bất biến (F)
| Kiểm | Hợp đồng |
|---|---|
| ops-watch `flow-coverage.check.ts` | MỘT câu SQL (tenant bật app × khe bắt buộc thiếu `is_default` có release) > 0 ⇒ đỏ kèm ≤ 20 cặp; p95 ≤ 100 ms / 1 000 tenant |
| e2e prod `e2e/deployed/flow-coverage.spec.ts` | Demo Sổ Hợp Tác + NiTi (chỉ đọc, không ghi dữ liệu): Cài đặt › Ứng dụng & quy trình thấy mọi khe bắt buộc có "Đang dùng"; mở 1 HĐ thấy FlowPanel |
| Luật review | rubric reviewer (`docs/WORKFLOW.md`; sửa `.claude/agents/reviewer.md` cần người dùng duyệt): bảng mới thay bảng cũ ⇒ backfill + int "tenant cũ thấy dữ liệu", thiếu = Blocker |

## 8. Lát (G)
Đợt 1 song song 6 lát (one-shell đang chạy); đợt 2 sau khi đợt 1 gộp.
| Lát | Đợt | Model | Phụ thuộc | Migration | Chạm |
|---|---|---|---|---|---|
| cr120-slot-contract | 1 | Opus (kit mount/adapter) + Sonnet (UI /apps, Cài đặt) | — | không | manifest.ts + 2 manifest (khai báo cả khe community), `check:app-slots`, kit mount check |
| cr120-single-source | 1 | Opus | hub-routing-backfill gộp trước | hub 0090, 0091 | slot-resolve/slot-assign/library, `ensureSlotDefaults` |
| cr120-runtime-on | 1 | Opus (kit/adapter) + Sonnet (web) | — | không | `flowRuntimeOn`, workspace-web flow adapters, xoá đường UI cũ |
| cr120-community-flows | 1 | Opus (pack, adapter, RLS) + Sonnet (FlowPanel community) | slot-contract (kiểu manifest theo §2) | hub 0092, community 0008 | packs/community, G1, modules/community |
| cr120-invariants | 1 | Sonnet (Opus duyệt SQL) | — | không | ops check, e2e deployed, rubric |
| cr120-one-shell (đang chạy) | 1 | Sonnet | — | không | workspace-web shell/AppShell, settings layout, CONVENTIONS (§8b) |
| cr120-contracts-flow | 2 | Opus (engine nodes) + Sonnet (editor/renderer) | đợt 1 | hub 0093 | G2–G6, def `contracts.intake` |
Gộp: slot-contract → single-source → community-flows → runtime-on → invariants; one-shell gộp độc lập (chỉ web). DLC không đụng (`dlc:check`).

## 8b. UI nhất quán + một khung (người dùng 2026-11-05, lát cr120-one-shell)
| # | Quyết định |
|---|---|
| 1 | MỘT `AppShell` mọi module: topbar chung (brand, ô tìm theo module, chuông, trợ lý, menu tài khoản) + sidebar từ manifest, chỉ router `Link`; không icon ↗, không reload khi đổi app; bỏ header/sidebar riêng Community (lỗi prod: link SHT là `<a>` thường) |
| 2 | Giao diện = MỘT nút icon mặt trời/trăng (`aria-pressed`), bỏ radio "Sáng/Tối" |
| 3 | Tối giản shell + mọi trang cấu hình (SHT Cài đặt + Ứng dụng & quy trình, dialog Cài đặt Community): MỘT settings layout (nav trái + nội dung), cùng header/control/khoảng cách, ít viền/bóng, icon cho hành động hiển nhiên, nút/empty state thống nhất; không đổi hành vi |
| 3b | Loại bài Community có token màu riêng (Cần bán xanh lá, Cần mua xanh dương, Thông báo hổ phách; sáng + tối, AA) ở badge, viền thẻ, nút composer, tab lọc; cam thương hiệu chỉ cho hành động chính |
| 4 | Test: e2e đổi app không reload cả hai chiều; luật UI trong `docs/CONVENTIONS.md`: "mọi module dùng AppShell + settings layout chung" |

## 9. Hiệu năng (Luật 4c)
| Đường | Ngưỡng |
|---|---|
| `resolveSlot` | 1 SQL, p95 ≤ 5 ms (`slot-resolve.perf.int.test.ts`, thêm 10 000 tenant) |
| `ensureSlotDefaults` | 1 SQL/khe, ≤ 200 ms / 1 000 tenant |
| flow view · summary | p95 ≤ 30 ms · ≤ 50 ms lô 100 |
| tạo bài community | p95 ≤ baseline × 1,1 (screen chạy nền) |
| contracts.list · chat.first-delta | như CR-118 §7 |

## 10. Kế hoạch test
- Unit: `check-app-slots`; allowedKinds khi lưu def; renderer `agent`; nhánh post-moderation.
- Int (evotest, file của lát): 0090 gán cũ ⇒ luật mặc định, chạy lại vô hại, RLS; resolveSlot không đọc bảng cũ; `ensureSlotDefaults` idempotent; act qua FlowRuntime = use case cũ; `off` ⇒ đường cũ; bài flagged ẩn tới khi duyệt, agent lỗi ⇒ review, join/report chéo tenant 403/404.
- e2e (viết, chạy MỘT lần cuối đợt, shard): duyệt HĐ qua FlowPanel; bài gắn cờ ⇒ duyệt ⇒ hiện; đối tác xin tham gia ⇒ duyệt.
- Cuối đợt: `test:frozen`, `dlc:check`, perf `-Exclusive` (điều phối); review + security Opus.

## §Một trang Quy trình (UX, lát cr120-flows-one-page)
Người dùng: "sao phải chia, khó hiểu, tùm lum thứ". Quy tắc: MỘT khái niệm "Quy trình" = chuỗi bước công ty dùng cho từng việc (duyệt, nhận hồ sơ, kiểm duyệt bài…).
- **Trang `/processes` (tenant_admin; platform khi đã chọn công ty):** mọi quy trình công ty có, nhóm theo app (Sổ Hợp Tác, Community, Chung). Dòng: tên · khi nào chạy (việc của khe + điều kiện luật, vd "Duyệt hợp đồng · HĐ mua từ Phòng Kinh doanh") · nguồn ("Platform cung cấp" chỉ xem sơ đồ + sửa luật chọn / "Công ty tạo" đủ Bật·Chạy·Sửa·Xoá) · trạng thái ("Đang dùng" / "Tắt"). Chip lọc: app, nguồn, trạng thái. Không tab; mẫu ở "Tạo quy trình › Tạo từ mẫu".
- **Dữ liệu:** không endpoint mới — capabilities (khe theo app) + routing mỗi khe (tập gán, luật, `current_def_id`) + `/process-defs` (gói + `kind=sample`) + tên phòng ban; mỗi nguồn một truy vấn, sơ đồ nạp khi bấm; chunk lười.
- **Khối "Quy trình" duy nhất ở thẻ app trang công ty (platform):** công tắc "Duyệt theo quy trình" (feature `contracts-approval-engine`, bỏ khỏi "Tính năng thêm"), tập gán + luật chọn mở sẵn, "Mặc định" là một dòng; bỏ ô chọn/Gán/Về mặc định cũ.
- **workspace-web Cài đặt › Ứng dụng & quy trình:** giữ bộ sửa luật; link "Xem tất cả quy trình" → trang này.
- **Platform chưa chọn công ty:** Thư viện / Mẫu · chạy thử giữ nguyên.