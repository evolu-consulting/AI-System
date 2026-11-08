---
id: cr120-slot-contract
lát: cr120-slot-contract
cr: CR-120 (phần A, §2) · ADR-0036
làn: nhanh
migration: không
phụ thuộc: —
---
## Plan (ngắn)
1. `AppSlotDecl` (`packages/contracts/src/app-manifest/manifest.ts`) thêm `purpose`, `required` (mặc định true), `defaultDefKey`, `allowedKinds`, `trigger`.
2. Manifest: contracts = `contracts.approval` (add-on engine duyệt) + `contracts.intake` (LUÔN BẬT, người dùng 2026-11-05); community = 3 khe luôn bật.
3. Luật thuần `appSlotIssues` + `bun run check:app-slots` (lefthook khi đổi manifest, trong `bun run check` ⇒ CI).
4. hub kit: sau khi mọi gói mount, khe manifest thiếu `SlotSpec`/`FlowSlotAdapter` (adapter chỉ kiểm khi runtime bật) ⇒ `logger.error("slot-contract-gap")`, không chặn boot.
5. UI: admin /apps tab Quy trình + workspace Cài đặt › Ứng dụng & quy trình liệt kê mọi khe theo manifest; khe hub/công ty chưa có ⇒ cảnh báo.

## Làm
- contracts: `manifest.ts`, `contracts.manifest.ts`, `community.manifest.ts`, `slots.rules.ts` (+ test), `index.ts`.
- tools: `check-app-slots.ts`; `package.json` (script + chuỗi `check`), `lefthook.yml` (job glob manifest).
- hub-api: `kit/domain/slot-contract.rules.ts` (+ test), `kit/adapters/slot-contract.check.ts`, `packs.after-mount.ts` (chuyển `rejectToolCollisions` ra khỏi `packs.mount.ts` — file chạm trần 400 dòng), `contracts/flow.mount.ts` (+1 dòng đăng ký adapter).
- admin-web: `lib/slot-rows.ts` (+ test), `SlotDeclInfo.tsx`, `SlotCard.tsx`, `ProcessesTab.tsx`, `AppDetailPage.tsx`. workspace-web: `lib/app-slots.ts` (+ test), `AppsPane.tsx`. i18n vi/en.

## Không làm / Chạm
- Không migration: def `hd-tiep-nhan` (contracts.intake) seed ở hub 0093 (cr120-contracts-flow); 3 def community ở hub 0092 (cr120-community-flows). Chưa seed ⇒ UI cảnh báo thiếu + log `slot-contract-gap` (đúng ý đồ).
- Không SlotSpec/adapter cho khe mới (lát community-flows / contracts-flow). Không ops-watch (cr120-invariants đọc `currentSlotContractGaps()` nếu cần).
- File chung chạm tối thiểu: `package.json`, `lefthook.yml`, `packs.mount.ts` (1 import + 1 dòng gọi, bỏ hàm đã chuyển), `contracts/flow.mount.ts` (2 dòng), `AppsPane.tsx`.

## Test tối thiểu
- `bun test packages/contracts/src/app-manifest apps/hub-api/src/modules/packs/kit/domain/slot-contract.rules.test.ts apps/admin-web/src/features/apps/lib/slot-rows.test.ts apps/workspace-web/src/features/settings/lib/app-slots.test.ts`
- `bun run check:app-slots`; typecheck contracts/hub-api/admin-web/workspace-web.

## Quyết định trong lúc làm
- Luật thêm (người dùng 2026-11-05): mỗi app ≥ 1 khe LUÔN BẬT (`required` ∧ không `addon`) ⇒ `no_always_on_slot`; thêm luật tiền tố key khe = key app.
- `allowedKinds` chỉ dùng loại đang có trong `FLOW_STEP_KINDS`; `agent` (G1) do community-flows thêm vào enum rồi bổ sung vào allowedKinds của khe community/intake.
- `defaultDefKey`: approval = `hd-mac-dinh` (seed 0069); intake = `hd-tiep-nhan`; community = `community-post-moderation` / `community-partner-join` / `community-report` — lát seed phải dùng đúng key này.
- Thứ tự khe contracts giữ `contracts.approval` trước (test preview dùng `slots[0]`).
- Trigger (chỉ hiển thị): `contract.submitted`, `contract.uploaded`, `post.created`, `partner.join_requested`, `report.created`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/cau-hinh-app.md
#### Yêu cầu: App phải khai báo khe quy trình
Manifest mỗi app khai báo ít nhất một khe quy trình và ít nhất một khe luôn bật; mỗi khe có mục đích, quy trình mặc định, loại bước được phép và sự kiện mở lượt. Kiểm tĩnh chặn commit/CI khi sai.
- Kịch bản: khi app không có khe hoặc chỉ có khe cần tính năng thêm thì `check:app-slots` đỏ [test: packages/contracts/src/app-manifest/slots.rules.test.ts » app 0 khe ⇒ đỏ no_slots; packages/contracts/src/app-manifest/slots.rules.test.ts » chỉ có khe cần add-on hoặc không bắt buộc ⇒ đỏ no_always_on_slot]
- Kịch bản: khi khe có loại bước rỗng/lạ, key quy trình mặc định sai dạng, mục đích/sự kiện rỗng hoặc quá dài, key khe sai dạng/trùng thì đỏ [test: packages/contracts/src/app-manifest/slots.rules.test.ts » allowedKinds rỗng/lạ, defaultDefKey sai dạng, purpose/trigger rỗng hoặc quá dài ⇒ đỏ; packages/contracts/src/app-manifest/slots.rules.test.ts » key khe sai dạng, khác tiền tố app, trùng trên toàn tập ⇒ đỏ]
- Kịch bản: Sổ Hợp Tác có khe Tiếp nhận hợp đồng luôn bật + khe Duyệt hợp đồng theo tính năng thêm; Community có 3 khe (duyệt bài, đối tác xin tham gia, báo cáo vi phạm) [test: packages/contracts/src/app-manifest/slots.rules.test.ts » manifest thật (contracts, community) hợp lệ: mỗi app ≥ 1 khe luôn bật]
- Kịch bản: khi hub khởi động mà khe manifest thiếu đăng ký khe hoặc (runtime bật) thiếu adapter thì ghi log lỗi, không chặn khởi động [test: apps/hub-api/src/modules/packs/kit/domain/slot-contract.rules.test.ts » khe manifest thiếu SlotSpec ⇒ gap spec, runtime bật mà thiếu adapter ⇒ gap adapter]
#### Yêu cầu: Tab Quy trình của app hiện mọi khe khai báo
Trang app ở admin liệt kê mọi khe theo manifest kèm mục đích, sự kiện mở lượt và luôn bật / cần tính năng thêm; khe chưa có trên hub hiện cảnh báo thiếu quy trình mặc định.
- Kịch bản: khi manifest có khe mà hub chưa có thì vẫn hiện thẻ khe với cảnh báo; khe hub ngoài manifest hiện sau [test: apps/admin-web/src/features/apps/lib/slot-rows.test.ts » mọi khe manifest có hàng (thiếu hub ⇒ view null), khe hub ngoài manifest đứng sau]

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: Cài đặt › Ứng dụng & quy trình hiện mọi khe khai báo
Mục Ứng dụng & quy trình liệt kê mọi khe của app theo manifest kèm tên và mục đích; khe công ty chưa có quy trình hiện cảnh báo thay vì bị ẩn.
- Kịch bản: khi công ty bật Community mà chưa có khe nào thì vẫn thấy 3 khe với cảnh báo thiếu [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: khe năng lực ngoài manifest vẫn hiện sau khe manifest [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]

## Việc còn lại
- Seed def `hd-tiep-nhan` (0093, contracts-flow) + 3 def community (0092, community-flows) + SlotSpec/adapter ⇒ hết log `slot-contract-gap`.
- e2e UI (thẻ khe + cảnh báo) viết ở lượt e2e cuối đợt (qc, `e2e/**` khoá).
- `allowedKinds` thêm `agent` khi G1 vào `FLOW_STEP_KINDS`; editor chặn loại ngoài `allowedKinds` (422 `STEP_KIND_NOT_ALLOWED`) thuộc lát editor.
