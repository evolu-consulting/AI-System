# CR-122 · Lát (tasks)

Spec: [spec.md](spec.md) · Nguồn: [flow-model.md](../../platform/flow-model.md) mục I · ADR-0038. Trạng thái: chưa làm, chờ readiness.
Luật: ≤ 4 agent/đợt (D1), lát ≤ 60 phút (D2), Sonnet viết / Opus chỉ phần chạy-khoá-trigger-migration-soát (D3), unit+int của file mình sửa (D4), **e2e chỉ viết, chạy MỘT lần ở Q1**, một agent qc. **UI làm một đợt (U1+U2) rồi ĐÓNG BĂNG trước khi qc sửa e2e.** Không lát nào chạm DLC (`dlc:check` xanh mỗi lát). Mọi lát: Delta (openspec) + mục perf trong brief.

## Số migration giao trước (hub = `packages/db/migrations-hub`, sau 0104; journal cuối `when` 1805300000000)

| Số | `when` journal | Lát | Nội dung |
|---|---|---|---|
| 0105 | 1805400000000 | E1 | `hub.flow_events` (hàng đợi sự kiện, unique `(tenant_id, event_id)`, RLS) |
| 0106 | 1805500000000 | E1 | `hub.company_flows` (+ cột `trigger`/`source` của FlowDef, index chọn flow khớp, RLS) |
| 0107 | — | bỏ trống | M1 đổi sang 0111 (0109/0110 đã áp trên máy khác sẽ bỏ qua `when` nhỏ hơn) |
| 0108 | 1805700000000 | R1 | gỡ bảng/view khe cũ (bản phát hành SAU, khi 0 lượt cũ mở) |
| 0109 | 1805800000000 | dự phòng | lát nào phát sinh (xin điều phối, không tự lấy) |

Cờ: `FLOW_TRIGGERS` theo công ty (tắt = bóng: đường khe cũ mở lượt, dispatcher chỉ ghi "lẽ ra chạy"); đọc ở E1, dùng ở A1/A2/M1/Q1.

## Bảng lát

| Lát | Đợt | Model · effort | Rủi ro / làn | Phụ thuộc | Migration | Cờ |
|---|---|---|---|---|---|---|
| F0 contract | 1 | Opus medium (thiết kế contract nhiều lát dựa vào) | cao · đầy đủ | — | — | — |
| E1 trigger | 1 | Opus medium (hàng đợi/khoá/idempotent/tenant) | cao · đầy đủ | F0 | 0105, 0106 | đọc `FLOW_TRIGGERS` |
| E2 node | 1 | Opus medium (phần chạy Duyệt/Nếu/Kết thúc) | cao · đầy đủ | F0 | — | — |
| U1 trình sửa | 1 | Sonnet | thường · nhanh | F0 | — | — |
| E3 ký số | 2 | Opus medium (chờ sự kiện ký) + Sonnet high (adapter) | cao · đầy đủ | E2 | — | — |
| A1 contracts | 2 | Sonnet high + Opus low soát | cao (HĐ, tenant) · đầy đủ | E1, E2 | — | `FLOW_TRIGGERS` |
| A2 community | 2 | Sonnet high + Opus low soát | trung bình · nhanh + soát | E1, E2 | — | `FLOW_TRIGGERS` |
| N1 node module (FR-25) + nới CHECK xuất bản | 2 | Opus medium (agent engine/contract) | thường · nhanh | F0, E1b | 0110 | — |
| N2 kiểm nối + AI gợi ý cầu nối (FR-26) | 2 | Sonnet high (hub: kiểm IO + endpoint gợi ý qua Agent Hub) | thường · nhanh | N1 | — | — |
| U2 danh sách công ty | 2 | Sonnet | thường · nhanh | E1, U1, N1, N2 | — | — |
| M1 backfill + bóng | 2 | Sonnet high + Opus low soát (dữ liệu khách) | cao (migration) · đầy đủ | E1, A1, A2 | 0111 | `FLOW_TRIGGERS` |
| Q1 e2e G1–G3 | 3 | Sonnet (qc, một agent) | — | U1+U2 đóng băng, M1, E3 | — | bật Demo |
| R1 gỡ cũ | 3 | Sonnet (+ Opus low soát) | cao (xoá bảng) · đầy đủ | Q1 xanh, NiTi bật, 0 lượt cũ mở, người dùng xác nhận | 0108 | gỡ cờ |

Đợt 1: F0 → (E1, E2, U1 song song, ≤ 3 agent). Đợt 2: E3, A1, A2, U2, M1 (≤ 4 cùng lúc; A1/A2/M1 đụng khu vực khác nhau, E3 và A1 cùng `packs/contracts` ⇒ **E3 trước A1** hoặc nối tiếp). Đợt 3: Q1, cutover Demo → NiTi, R1.

## Chi tiết lát

### F0 · contract (Opus medium)
- **FILE:** `packages/contracts/src/hub-admin/process-library.ts` (FlowDef, `trigger`, `next_step`, `outcome`), `process-routing.ts` + `process-company.ts` (thay bằng `company_flows` view model), `packages/contracts/src/flow` (FlowView bỏ `slot`), `apps/hub-api/src/modules/packs/kit/public.ts` + `application/slot.ports.ts`, `application/flow.ports.ts` (cổng `FactsReader`, `OutcomeHandler`, manifest `events[]` thay `AppSlotDecl`), `docs/adr/0038-flow-trigger-model.md` (đã có).
- **Xong khi:** unit zod (FlowDef hợp lệ/sai; ≤ 20 bước, 1 trigger, ≥ 1 Kết thúc); typecheck toàn repo xanh; `check:boundaries` không tăng baseline. Không gỡ gì cũ (cộng thêm).
- **Perf:** không. **Migration:** không.

### E1 · trigger (Opus medium)
- **FILE:** `packages/db/src/schema/hub-processes.ts`, `hub-process-library.ts` (+ bảng mới), `packages/db/migrations-hub/0105_*.sql`, `0106_*.sql`, `meta/_journal.json`; `apps/hub-api/src/modules/processes/library/` (thay `routing.repo.ts`, `routing.service.ts`, `slot-resolve.repo.ts`, `slot-assign.repo.ts`, `slot-route.repo.ts`, `slot-assigned.repo.ts` bằng `company-flows.*` + clone dùng thay/quay về trong `library-company.service.ts`/`library-company.repo.ts`); `apps/hub-api/src/modules/processes/runs/launcher.ts`, `launcher-batch.ts` (mở lượt từ sự kiện); mới `processes/triggers/` (dispatcher `FOR UPDATE SKIP LOCKED`, match, `decides`); `apps/hub-api/src/server.ts` (đăng ký vòng nền); cổng đọc `dlc.*` giữ nguyên chữ ký `resolveSlot`.
- **Xong khi:** unit match + `decides`; int: idempotent 2 Hub `(tenant, event_id)`, clone dùng thay/quay về một tx, chặn tắt flow required duy nhất, RLS chéo tenant 2 bảng mới; `*.perf.int.test.ts` chọn flow khớp **p95 ≤ 5 ms**, số câu SQL/lô cố định; `dlc:check` xanh.
- **Perf:** đường nóng mới (dispatcher + chọn flow). Số thật trước→sau trong báo cáo.

### E2 · node (Opus medium)
- **FILE:** `apps/hub-api/src/modules/processes/nodes/` (mới `review/`, `finish/`; sửa `if/` thêm nguồn `fact` + `next_step`; `registry.ts`, `registry.launch.ts`, `types.ts`), `processes/gates/`, `processes/runs/apply*.ts` (Kết thúc → `OutcomeHandler`; dừng "Cần xử lý" H2), `nodes/tool/` (node Công cụ cho Dify/MCP/tool app trong catalog đã bật). Snapshot cũ (`after.branch`, `contracts-route`, `contracts-finalize`) vẫn chạy.
- **Xong khi:** unit từng node; int: Duyệt độc lập (duyệt/từ chối/trả lại, nhắc, chuyển cấp), Nếu fact + gộp nhánh + trường trống ⇒ Sai + lịch sử, Kết thúc idempotent khi gọi lại, giá trị đổi sau khi rẽ ⇒ dừng "Cần xử lý", lượt snapshot cũ chạy nốt, Công cụ gọi tool giả trả trường khai báo.
- **Perf:** `FactsReader` một câu SQL (đếm câu trong test).

### U1 · trình sửa (Sonnet)
- **FILE:** `apps/admin-web/src/features/processes/` — `pages/ProcessEditorPage.tsx`, `components/canvas/*`, `components/library/LibraryEditorBody.tsx`, `lib/slot-canvas.ts` (→ canvas FlowDef), `lib/system-nodes.ts`, `nodes/registry.ts`, `components/library/FlowWhenEditor.tsx` (gỡ; điều kiện dùng control CondEditor chung cho Bắt đầu khi + Nếu), `FlowFormEditor.tsx`/`SlotStageForm.tsx` (gỡ editor Form theo khe), `PublishDialog.tsx`, `lib/company-copy.ts`.
- **Xong khi:** unit mapper canvas ⇄ FlowDef; component test node Bắt đầu khi/Nếu/Duyệt/Kết thúc/Công cụ; bảng node theo manifest app; e2e **viết, không chạy**.
- **Perf:** bundle admin-web `check:bundle` không vượt. **Đóng băng sau U2.**

### E3 · ký số (Opus medium + Sonnet high)
- **FILE:** `apps/hub-api/src/modules/packs/contracts/application/esign-flow.usecase.ts`, `esign-sync.ts`, `esign-sweep.ts`, `esign.usecase.ts`, `esign.ports.ts`; node app Ký số đăng ký qua cổng gói (kit `pack-signal.ts` ở `processes/runs/`). Phần gửi/đồng bộ nhiều nhà cung cấp giữ nguyên.
- **Xong khi:** int: Ký số gửi + chờ `esign.completed|declined` có hạn, rẽ Đã ký/Từ chối, sự kiện trùng idempotent; unit adapter. **Perf:** không.

### A1 · contracts (Sonnet high + Opus low soát)
- **FILE:** `apps/hub-api/src/modules/packs/contracts/application/` — `approval-flow*.usecase.ts`, `approval-engine*.ts`, `approval-engine-slot.ts`, `domain/approval-slot*.rules.ts` (gỡ sau khi thay), `intake.mount.ts`, `packs.after-mount.ts`; mới phát sự kiện `contract.submitted|uploaded|approved` cùng tx; `FactsReader` (giá trị, loại HĐ, phòng người tạo, đối tác mới) + `OutcomeHandler` (Đã duyệt khoá + gắn SP / Từ chối / Trả lại); bỏ `withConfirmStep`; `apps/workspace-web/src/features/settings/lib/routing-def.ts`, `app-slots.ts` (gỡ Cài đặt › Quy trình duyệt cũ).
- **Xong khi:** int: gửi duyệt ghi sự kiện cùng tx, `OutcomeHandler` idempotent, Trả lại về Nháp; soát Opus low diff dữ liệu/RLS. **Perf:** sự kiện cùng tx, không thêm vòng lặp theo hàng.

### A2 · community (Sonnet high + Opus low soát)
- **FILE:** `apps/hub-api/src/modules/packs/community/adapters/flows.service.ts`, `flows.repo.ts`, `flows.routes.ts`, `flow-slots.ts`, `community.mount.ts`, `domain/flow-slots.rules.ts` (gỡ khe 3 bước cố định); phát `post.created|partner.join_requested|report.created` cùng tx; `FactsReader` + `OutcomeHandler` (Hiện/Ẩn/Nhận/Từ chối/Cảnh báo).
- **Xong khi:** int mỗi sự kiện một đường chính + Kết thúc idempotent; chặn đọc chéo tenant giữ. **Perf:** không.

### U2 · danh sách flow công ty (Sonnet)
- **FILE:** `apps/admin-web/src/features/tenants/flows/` — `components/SlotRouting.tsx`, `RoutingRules.tsx`, `DrawerAssign.tsx`, `hooks/use-slot-routing.ts`, `api.ts` (thay bằng danh sách `company_flows`: nhóm app, Bắt đầu khi, nguồn, trạng thái + lý do, kéo thả thứ tự, Sao chép để sửa/Bật-Tắt/Quay về bản gốc, cảnh báo `decides`); `apps/admin-web/src/features/apps/lib/flow-view.ts`, `slot-rows.ts`; `apps/workspace-web` FlowPanel (`packages/web-kit/src/routing-current.ts` → tra theo `ref`).
- **Xong khi:** unit/component trạng thái + lý do; int API company-flows (đã có ở E1) qua UI-mapper; e2e **viết, không chạy**; chữ "khe" biến mất khỏi UI (grep).
- **Perf:** không. **Sau U2: ĐÓNG BĂNG UI (U1+U2).**

### M1 · backfill + cờ bóng (Sonnet high + Opus low soát)
- **FILE:** `packages/db/migrations-hub/0111_*.sql` + journal; `tools/scripts/src/` (mô phỏng 4 HĐ mẫu mỗi công ty, thay `check-app-slots.ts` bằng `check-app-events.ts`); `apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.ts` (sự kiện bắt buộc × công ty thiếu flow không điều kiện = 0; so lệch bóng); `tools/scripts/src/seed-niti.ts`, `rename-process-defs.ts`; `deploy/prod-sohoptac2/preflight-cr121.sql` (kiểm bổ sung).
- **Xong khi:** int backfill (chạy hai lần vô hại, "công ty cũ thấy dữ liệu"); mô phỏng đường đi mới = cũ; 28 run cũ không đổi; Opus low soát diff dữ liệu khách. **Perf:** migration theo tập, một câu mỗi bảng.

### Q1 · e2e G1–G3 (Sonnet, một agent qc)
- **FILE:** `e2e/**` (job mới G1, G2, G3 theo spec §3; hành trình thật D5 trên công ty Demo), `tests/.lock` (qc ghi).
- **Xong khi:** viết sau khi UI đóng băng; **chạy MỘT lần** bằng script chia slot (evotest), G1–G3 xanh; chụp màn hình soát Luật GỐC 3 (không có chữ "khe"). **Perf:** không.

### R1 · gỡ cũ (Sonnet + Opus low soát)
- **FILE:** `packages/db/migrations-hub/0108_*.sql`; gỡ `slot-*.repo.ts`, `routing*.ts`, `slot-defaults.ts`, `packs/kit/adapters/slot-*.ts`, `check-app-slots.ts`, `approval-flow.*`, `approval-engine*`, `FlowSlotAdapter`; `FLOW_TRIGGERS`; grep liệt kê mọi chỗ đọc đã chuyển (D6).
- **Xong khi:** typecheck + `check:boundaries`; `dlc:check` xanh (cổng `dlc.*` còn); test cũ của phần gỡ xoá cùng. **Chỉ chạy** khi Q1 xanh, NiTi đã bật, 0 lượt cũ mở, và người dùng xác nhận deploy.

## Delta (so với docs/current)

Không thay đổi hành vi (lý do: lát tài liệu — chốt spec/ADR/lát CR-122, chưa có code). Delta thật do từng lát khai khi làm; danh sách tài liệu phải sửa: spec.md §8.

## Bản đồ file (Haiku 2026-11-06, Luật 0d.2)
Kiểm: ~90 mục đường dẫn trong cột FILE (kể cả thư mục và mẫu `*`) bằng cách kiểm tồn tại trên đĩa và Grep tên hàm/khối. (mới) = chưa có, sẽ tạo.

### F0
- `packages/contracts/src/hub-admin/process-library.ts` — FlowDef (trigger, next_step, outcome) — thêm trường mới, bỏ slot_body; zod: ≤ 20 bước, 1 trigger, ≥ 1 Kết thúc.
- `packages/contracts/src/hub-admin/process-routing.ts`, `process-company.ts` — (đọc) — cộng thêm view model company_flows, chưa gỡ.
- `packages/contracts/src/flow/view.ts`, `form.ts`, `index.ts` — FlowView — bỏ field `slot`.
- `packages/contracts/src/app-manifest/manifest.ts` — `AppSlotDecl` (dòng 42) — thêm `events[]` bên cạnh, giữ đến R1. (không có trong bảng FILE)
- `apps/hub-api/src/modules/packs/kit/public.ts` — export cổng — khai báo FactsReader, OutcomeHandler, events[].
- `apps/hub-api/src/modules/packs/kit/application/slot.ports.ts` — `SlotSpec` (dòng 49) — cộng cổng mới; gỡ SlotSpec ở R1.
- `apps/hub-api/src/modules/packs/kit/application/flow.ports.ts` — cổng flow — thêm FactsReader/OutcomeHandler.
- `docs/adr/0038-flow-trigger-model.md` — (có sẵn) — tham chiếu, không sửa.

### E1
- `packages/db/src/schema/hub-process-library.ts` — (đọc) — thêm định nghĩa Drizzle cho `company_flows`, RLS tenant.
- `packages/db/src/schema/hub-processes.ts` — (đọc) — bảng mới `flow_events`.
- `packages/db/migrations-hub/0105_*.sql` (mới) — hub.flow_events: unique (tenant_id, event_id), RLS.
- `packages/db/migrations-hub/0106_*.sql` (mới) — hub.company_flows + cột trigger/source, index chọn flow khớp, RLS.
- `packages/db/migrations-hub/meta/_journal.json` — journal — thêm when 1805400000000 và 1805500000000.
- `apps/hub-api/src/modules/processes/library/slot-resolve.repo.ts` — `resolveSlot` (dòng 54) — giữ chữ ký cho cổng dlc.*; phần còn lại thay bằng company-flows.*.
- `apps/hub-api/src/modules/processes/library/routing.repo.ts`, `routing.service.ts`, `slot-assign.repo.ts`, `slot-route.repo.ts`, `slot-assigned.repo.ts` — chuyển sang company-flows.* (gỡ ở R1).
- `apps/hub-api/src/modules/processes/library/library-company.service.ts`, `library-company.repo.ts` — clone "Sao chép để sửa" và quay về bản gốc trong một tx.
- `apps/hub-api/src/modules/processes/runs/launcher.ts`, `launcher-batch.ts` — mở lượt từ sự kiện; lượt chụp snapshot lúc bắt đầu.
- `apps/hub-api/src/modules/processes/triggers/` (mới) — dispatcher `FOR UPDATE SKIP LOCKED`, match, `decides`.
- `apps/hub-api/src/server.ts` — đăng ký vòng nền dispatcher.
- Cờ `FLOW_TRIGGERS` theo công ty: (mới) — chưa thấy nơi đọc cờ; E1 tạo.

### E2
- `apps/hub-api/src/modules/processes/nodes/review/` (mới) — node Duyệt độc lập (duyệt/từ chối/trả lại, nhắc, chuyển cấp).
- `apps/hub-api/src/modules/processes/nodes/finish/` (mới) — node Kết thúc gọi OutcomeHandler trong tx, idempotent.
- `apps/hub-api/src/modules/processes/nodes/if/` (có) — thêm nguồn `fact` qua FactsReader, `next_step`; trường trống ⇒ nhánh Sai.
- `apps/hub-api/src/modules/processes/nodes/tool/` (có) — node Công cụ cho Dify/MCP/tool catalog đã bật.
- `apps/hub-api/src/modules/processes/nodes/registry.ts`, `registry.launch.ts`, `types.ts` — đăng ký hai node mới.
- `apps/hub-api/src/modules/processes/gates/` (có) — chỗ gọi gate của Duyệt độc lập; chưa đọc dòng cụ thể.
- `apps/hub-api/src/modules/processes/runs/apply*.ts` — CẦN XÁC MINH: tên `apply*` có thể là luồng Apply (PR) cũ, không phải Kết thúc; dừng "Cần xử lý" (H2) đặt ở đâu chưa rõ.

### E3
- `apps/hub-api/src/modules/packs/contracts/application/esign-flow.usecase.ts` — gửi ký + chờ `esign.completed|declined` có hạn; rẽ Đã ký / Từ chối.
- `apps/hub-api/src/modules/packs/contracts/application/esign-sync.ts`, `esign-sweep.ts` — đồng bộ/quét — giữ nguyên, nối sự kiện.
- `apps/hub-api/src/modules/packs/contracts/application/esign.usecase.ts`, `esign.ports.ts` — cổng gói ký — giữ đa nhà cung cấp.
- `apps/hub-api/src/modules/processes/runs/pack-signal.ts` — kit đăng ký node Ký số qua cổng gói.
- `apps/hub-api/src/modules/packs/contracts/adapters/docusign.provider.ts`, `esign.fake.ts` — adapter (không có trong bảng FILE; giữ nguyên).

### A1
- `apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.ts` — `startEngineApproval` (dòng 248) — mở lượt khi `contract.submitted`.
- `apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.ts` — `slotFlowOf` (dòng 82) — gỡ sau khi thay.
- `apps/hub-api/src/modules/packs/contracts/application/approval-flow.usecase.ts`, `approval-flow-slot.usecase.ts` — gửi duyệt ghi sự kiện cùng tx; gỡ khe.
- `apps/hub-api/src/modules/packs/contracts/application/approval-engine.ports.ts` — cổng FactsReader + OutcomeHandler (Đã duyệt khoá HĐ + gắn SP / Từ chối / Trả lại).
- `apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules.ts` — `withConfirmStep` (dòng 48), `compileSlotStages` (dòng 149) — gỡ (H3).
- `apps/hub-api/src/modules/packs/contracts/domain/approval-slot-catalog.rules.ts`, `approval-slot-default.rules.ts` — gỡ sau khi thay.
- `apps/hub-api/src/modules/packs/contracts/intake.mount.ts` — đăng ký phát `contract.submitted|uploaded`.
- `apps/hub-api/src/modules/packs/packs.after-mount.ts` — gắn cổng/handler sau mount (đường dẫn sửa, xem dưới).
- `apps/workspace-web/src/features/settings/lib/routing-def.ts`, `app-slots.ts` — gỡ Cài đặt › Quy trình duyệt cũ.

### A2
- `apps/hub-api/src/modules/packs/community/adapters/flows.service.ts` — phát `post.created|partner.join_requested|report.created` cùng tx; OutcomeHandler Hiện/Ẩn/Nhận/Từ chối/Cảnh báo.
- `apps/hub-api/src/modules/packs/community/adapters/flows.repo.ts`, `flows.routes.ts` — chặn đọc chéo tenant giữ nguyên.
- `apps/hub-api/src/modules/packs/community/adapters/flow-slots.ts` — khe 3 bước cố định — gỡ.
- `apps/hub-api/src/modules/packs/community/community.mount.ts` — đăng ký FactsReader/handler (đường dẫn sửa, xem dưới).
- `apps/hub-api/src/modules/packs/community/domain/flow-slots.rules.ts` — gỡ khe cố định (test: `flow-slots.rules.test.ts`).
- `apps/hub-api/src/modules/packs/community-flow.mount.ts` — (không có trong bảng FILE) — kiểm trước khi sửa.

### U1
- `apps/admin-web/src/features/processes/pages/ProcessEditorPage.tsx` — trình sửa; canvas FlowDef mặc định, chế độ danh sách nhớ theo người dùng.
- `apps/admin-web/src/features/processes/components/canvas/ProcessCanvas.tsx`, `CanvasView.tsx`, `StageNode.tsx`, `IfNode.tsx` — canvas dùng chung; thêm node Bắt đầu khi/Duyệt/Kết thúc/Công cụ.
- `apps/admin-web/src/features/processes/components/library/LibraryEditorBody.tsx` — thân trình sửa Thư viện.
- `apps/admin-web/src/features/processes/lib/slot-canvas.ts` — mapper canvas ⇄ FlowDef (thay).
- `apps/admin-web/src/features/processes/lib/system-nodes.ts`, `apps/admin-web/src/features/processes/nodes/registry.ts` — bảng node theo manifest app.
- `apps/admin-web/src/features/processes/components/library/FlowWhenEditor.tsx` — gỡ; điều kiện dùng control chung (`FlowCondRow.tsx` là cơ sở).
- `apps/admin-web/src/features/processes/components/library/FlowFormEditor.tsx`, `SlotStageForm.tsx` — gỡ editor Form theo khe.
- `apps/admin-web/src/features/processes/components/library/PublishDialog.tsx`, `CompanyCopyBody.tsx`, `apps/admin-web/src/features/processes/lib/company-copy.ts` — xuất bản và copy công ty, bỏ khe (CompanyCopyBody không có trong bảng FILE).

### U2
- `apps/admin-web/src/features/tenants/flows/components/SlotRouting.tsx`, `RoutingRules.tsx`, `DrawerAssign.tsx` — thay bằng danh sách company_flows; gỡ.
- `apps/admin-web/src/features/tenants/flows/hooks/use-slot-routing.ts`, `api.ts` — hook và API company-flows (API đã có ở E1).
- `apps/admin-web/src/features/apps/lib/flow-view.ts`, `slot-rows.ts` — bỏ khe, dòng theo app.
- `packages/web-kit/src/routing-current.ts` — tra theo `ref`.
- `apps/workspace-web/src/platform/flow/ui/FlowPanel.tsx` — FlowPanel (đường dẫn sửa); `FlowRuntime` tại `apps/workspace-web/src/platform/flow/port.ts` (dòng 11).
- `apps/workspace-web/src/features/settings/components/FlowRules.tsx`, `apps/RoutingEditor.tsx` — (không có trong bảng FILE) — gỡ theo FR-23.

### M1
- `packages/db/migrations-hub/0111_*.sql` (mới) + `meta/_journal.json` — backfill theo tập, when 1806100000000.
- `tools/scripts/src/check-app-slots.ts` — thay bằng `check-app-events.ts` (mới); root `package.json` dòng 116 `check:app-slots`.
- `tools/scripts/src/seed-niti.ts`, `rename-process-defs.ts` — seed/đổi tên; bật đủ cấu hình (D7).
- `apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.ts` — sự kiện bắt buộc × công ty thiếu flow không điều kiện = 0; so lệch bóng.
- `apps/hub-api/scripts/process-library-backfill.ts` — (không có trong bảng FILE) — script backfill đã có, kiểm trước khi viết mới.
- `deploy/prod-sohoptac2/preflight-cr121.sql` — kiểm bổ sung; dòng 77, 79, 109, 113, 166 đọc `process_routing_rules`.

### Q1
- `e2e/**` (có) — thêm job G1, G2, G3; viết, không chạy trước Q1.
- `tests/.lock` (có) — qc ghi lock.

### R1
- `packages/db/migrations-hub/0108_*.sql` (mới) — gỡ bảng/view khe cũ.
- `apps/hub-api/src/modules/processes/library/slot-assign.repo.ts`, `slot-assigned.repo.ts`, `slot-route.repo.ts`, `slot-defaults.ts` (`ensureSlotDefaults` dòng 54), `slots.ts` — gỡ; `slot-resolve.repo.ts` gỡ phần ngoài `resolveSlot`.
- `apps/hub-api/src/modules/processes/library/routing.service.ts`, `routing.repo.ts`, `routing.rules.ts`, `routing-active.rules.ts` — gỡ.
- `apps/hub-api/src/modules/packs/kit/adapters/slot-registry.ts`, `slot-contract.check.ts` — gỡ; `kit/domain/slot-contract.rules.ts` (không có trong bảng) gỡ cùng.
- `tools/scripts/src/check-app-slots.ts` — gỡ; root `package.json` dòng 116 gỡ `check:app-slots`.
- `apps/hub-api/src/modules/packs/contracts/application/approval-flow*.ts`, `approval-engine*.ts`; `FlowSlotAdapter` — KHÔNG TÌM THẤY định nghĩa trong repo (tên có thể đã đổi); xác minh trước khi gỡ.

Đường dẫn sai trong bảng lát đã sửa:
- F0: `packs/application/slot.ports.ts`, `packs/application/flow.ports.ts` → `packs/kit/application/slot.ports.ts`, `packs/kit/application/flow.ports.ts`.
- A1: `packs/contracts/packs.after-mount.ts` → `packs/packs.after-mount.ts`.
- A2: `community.mount.ts` (nằm trong adapters/ theo mô tả) → `packs/community/community.mount.ts`.
- U2: "FlowPanel apps/workspace-web" → `apps/workspace-web/src/platform/flow/ui/FlowPanel.tsx`.
- Thiếu trong bảng, đã thêm: `manifest.ts` (AppSlotDecl), `community-flow.mount.ts`, `process-library-backfill.ts`, `FlowWhenEditor` dependencies.
- Mới (chưa có): `processes/triggers/`, `nodes/review/`, `nodes/finish/`, `0105`–`0108`, `check-app-events.ts`.
- Không tìm thấy: `FlowSlotAdapter`; `process_routing_rules` không có định nghĩa Drizzle (chỉ SQL trong migrations 0087, 0096; prod preflight đọc trực tiếp).
