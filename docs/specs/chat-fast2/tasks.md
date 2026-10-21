# chat-fast2 — AI System một bước cho tenant nhiều agent (demo, NitiGroup)

Tiếp `chat-fast` (cờ `HUB_FAST_ROUTE`, đã merge a1a959b3). Người dùng demo/NitiGroup thấy 2 agent (`assistant`, `mgmt-assistant`)
⇒ luật "AU = 1" không bao giờ áp. Hướng: dùng **agent mặc định của tenant** (CR-054, `hub.tenant_agent_defaults`) = `assistant`
làm trợ lý chung; Orchestrator chỉ còn khi `@orchestrator`, chế độ "hỏi lại" (`ask`) hoặc agent mặc định người gửi không được dùng.

## Làm

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Seed `assistant`: thêm `contracts-search/get/cks/ledger` vào `pack_tools` (+ câu prompt "chỉ đọc"). `/mcp` chỉ hiện tool khi gói bật cho tenant ∧ người gọi có quyền gói (`pack-tools.provider.ts`), chạy theo quyền + RLS người gọi ⇒ tenant không có gói contracts không thấy tool | ✅ |
| 2 | `untaggedRoute` (cờ bật): agent mặc định `forbidden` ⇒ về Orchestrator (`legacy`) thay vì 403; cờ tắt giữ 403 CR-054 (test khoá) | ✅ |
| 3 | `@orchestrator x` ở Hỏi AI (cờ bật) ⇒ `FORCE_ORCHESTRATOR`: Orchestrator đủ AU, bỏ agent mặc định/định tuyến nhanh; cờ tắt ⇒ như H2b (`AGENT_NOT_FOUND`) | ✅ |
| 4 | `demo-ai-fix.ts` (8): agent mặc định demo = `assistant` (`on_no_match=answer`), idempotent, chỉ demo; báo `agentsStale` nếu `assistant` chưa có tool contracts (⇒ chạy hub seed) | ✅ |
| 5 | Khoang hợp đồng giữ `@mgmt-assistant` (contracts-web gắn tag ⇒ run direct, không đi qua mặc định) — không đổi | ✅ |
| 6 | Unit `fast-route.rules.test.ts` (+4 ca) · `seed.test.ts` cập nhật | ✅ local |
| 7 | Int `tests/acceptance/chat-fast/default-route.int.test.ts`: được dùng ⇒ direct 1 job; không được dùng ⇒ Orchestrator + delegate `skipped not_allowed`; `@orchestrator` ⇒ Orchestrator | ✅ evotest 3/3 |
| 8 | Perf `dispatch.perf.int.test.ts` chạy lại | ✅ evotest: fast p95 73 ms (≤ 150), Orchestrator p95 100 ms |

## Bảo mật
Không đổi luật quyền: agent mặc định chỉ chạy thẳng khi nằm trong AU người gửi (`defaultRoute` → `visibleAgents`), `directOnSnapshot`
kiểm lại trên ảnh run; về Orchestrator thì mọi delegate qua `canDelegate`. Tool contracts của `assistant` = cùng provider `/mcp` như
`mgmt-assistant` (quyền gói + RLS người gọi, chỉ đọc, kết quả tool là dữ liệu).

## Đặt cho NitiGroup (Admin, không cần script)
1. platform admin: admin-web → **Agents** (tenant NitiGroup) → bật **Trợ lý** (`assistant`) cho tenant.
2. tenant admin NitiGroup: admin-web → **Agents** → **Trợ lý** → cấp quyền "Cả công ty" (hoặc các Group dùng hợp đồng) → đặt
   **Agent mặc định** = Trợ lý, "Khi không khớp" = Trả lời.
3. Hub seed mới (tool contracts cho `assistant`) phải chạy trước (`hub:seed` trong `setup.sh` của deploy).

## Máy chủ (sohoptac2) sau merge
`deploy.ps1` (build + `setup.sh`: migrate + hub seed) → `docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/demo-ai-fix.ts --tenant demo --apply` → NitiGroup theo mục trên.

## Ghi chú
- `tests/acceptance/V2-O/demo-ai-fix.int.test.ts` (khoá) đỏ sẵn, không do lát này: mong 1 tài liệu/3 đoạn nhưng ai-tiers-rag (6) đã thêm tài liệu QC-TC-01 ⇒ 2/6. Cần qc sửa (Tranh chấp test).
