# CR-122 · Lát (tasks)

Spec: [spec.md](spec.md) · Nguồn: [flow-model.md](../../platform/flow-model.md) mục I · ADR-0038. Trạng thái: chưa làm, chờ readiness.
Luật: ≤ 4 agent/đợt (D1), lát ≤ 60 phút (D2), Sonnet viết / Opus chỉ phần chạy-khoá-trigger-migration-soát (D3), unit+int của file mình sửa (D4), **e2e chỉ viết, chạy MỘT lần ở Q1**, một agent qc. **UI làm một đợt (U1+U2) rồi ĐÓNG BĂNG trước khi qc sửa e2e.** Không lát nào chạm DLC (`dlc:check` xanh mỗi lát). Mọi lát: Delta (openspec) + mục perf trong brief.

## Số migration giao trước (hub = `packages/db/migrations-hub`, sau 0104; journal cuối `when` 1805300000000)

| Số | `when` journal | Lát | Nội dung |
|---|---|---|---|
| 0105 | 1805400000000 | E1 | `hub.flow_events` (hàng đợi sự kiện, unique `(tenant_id, event_id)`, RLS) |
| 0106 | 1805500000000 | E1 | `hub.company_flows` (+ cột `trigger`/`source` của FlowDef, index chọn flow khớp, RLS) |
| 0107 | 1805600000000 | M1 | backfill khe → `FlowDef` + `company_flows` (theo tập, chạy lại vô hại) |
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
| U2 danh sách công ty | 2 | Sonnet | thường · nhanh | E1, U1 | — | — |
| M1 backfill + bóng | 2 | Sonnet high + Opus low soát (dữ liệu khách) | cao (migration) · đầy đủ | E1, A1, A2 | 0107 | `FLOW_TRIGGERS` |
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
- **FILE:** `packages/db/migrations-hub/0107_*.sql` + journal; `tools/scripts/src/` (mô phỏng 4 HĐ mẫu mỗi công ty, thay `check-app-slots.ts` bằng `check-app-events.ts`); `apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.ts` (sự kiện bắt buộc × công ty thiếu flow không điều kiện = 0; so lệch bóng); `tools/scripts/src/seed-niti.ts`, `rename-process-defs.ts`; `deploy/prod-sohoptac2/preflight-cr121.sql` (kiểm bổ sung).
- **Xong khi:** int backfill (chạy hai lần vô hại, "công ty cũ thấy dữ liệu"); mô phỏng đường đi mới = cũ; 28 run cũ không đổi; Opus low soát diff dữ liệu khách. **Perf:** migration theo tập, một câu mỗi bảng.

### Q1 · e2e G1–G3 (Sonnet, một agent qc)
- **FILE:** `e2e/**` (job mới G1, G2, G3 theo spec §3; hành trình thật D5 trên công ty Demo), `tests/.lock` (qc ghi).
- **Xong khi:** viết sau khi UI đóng băng; **chạy MỘT lần** bằng script chia slot (evotest), G1–G3 xanh; chụp màn hình soát Luật GỐC 3 (không có chữ "khe"). **Perf:** không.

### R1 · gỡ cũ (Sonnet + Opus low soát)
- **FILE:** `packages/db/migrations-hub/0108_*.sql`; gỡ `slot-*.repo.ts`, `routing*.ts`, `slot-defaults.ts`, `packs/kit/adapters/slot-*.ts`, `check-app-slots.ts`, `approval-flow.*`, `approval-engine*`, `FlowSlotAdapter`; `FLOW_TRIGGERS`; grep liệt kê mọi chỗ đọc đã chuyển (D6).
- **Xong khi:** typecheck + `check:boundaries`; `dlc:check` xanh (cổng `dlc.*` còn); test cũ của phần gỡ xoá cùng. **Chỉ chạy** khi Q1 xanh, NiTi đã bật, 0 lượt cũ mở, và người dùng xác nhận deploy.

## Delta (so với docs/current)

Không thay đổi hành vi (lý do: lát tài liệu — chốt spec/ADR/lát CR-122, chưa có code). Delta thật do từng lát khai khi làm; danh sách tài liệu phải sửa: spec.md §8.
