# Gate · Mốc dọn-seed (seed tối giản cho QAS) — CR-081

**Kết quả: DUYỆT (người dùng, 2026-10-16).** Vào BUILD trên `main` (không push).

## Quyết định (Intake chốt + 6 câu hỏi)
- Seed mặc định (dev + QAS) = **minimal**: `orchestrator` + `assistant` + `dify-tom`/`dify-tro-ly` + providers + workflows.
- Opt-in qua cờ **`HUB_SEED_FIXTURES=1`** (file `*.full.yaml`): 16 agent vai, 7 process_templates (`sdlc, sdlc-delivery, hoa-don, bug-fix, fixbug-apply, fixbug-pr, fixbug-evolu`) + `entitlements/grants/agent_teams/team_entitlements/tenant_processes` tương ứng.
- Q1 GIỮ `assistant`+`dify-*`; Q2 BỎ demo evolu "Evolu Consultant"/"Invoices" + phòng "Evolu team"; Q3 không orchestrator per-tenant; Q4 acme/beta giữ opt-in `HUB_DEV_CONTRACT_FIXTURE=1`; Q5 cơ chế P1; Q6 QAS để trống (QC tự tạo qua UI).
- Tenant evolu + 5 user GIỮ. Không tái dụng `HUB_SEED_PROFILE`.

## Phạm vi BUILD
- **backend-lead**: tách `*.full.yaml`; cờ `HUB_SEED_FIXTURES` ở `readSeedDir`/`seed.ts` + `config/env.ts`; bỏ demo evolu ở `tools/hub-dev/fixture.ts`; wiring `initial.sh`/`start.sh`/hub-dev; cập nhật unit seed test co-located.
- **qc**: đặt `HUB_SEED_FIXTURES=1` ở test khoá dùng mẫu (P-a `seed.int`/`scenario` + e2e, K1 `seed.int`, P-c/P-c2 `defs`) — chỉ thêm cờ, không đổi assertion; chạy lại full.

## An toàn / hard stop
- Không contract mới, không ADR/dịch vụ mới. Đổi seed **không xoá** dữ liệu DB đang có (QAS sạch thật cần `db:reset`/migrate — bước deploy riêng).
- Tính năng tạo agent (Studio) / process def + stage autofix/apply (Admin) **không đụng**.

## Gate lại
P-process-engine (D18), K1-knowledgehub (CR-070 §2), P-c-autofix, P-c2-pr — đều ghi "Cập nhật CR-081 · Gate lại"; đạt lại khi test khoá xanh với cờ fixture.

## Đóng mốc (2026-10-17, phiên chính)

Kiểm lại trên `evolu-platform` (DB dev seed tối giản, không còn `process_defs` mẫu, `HUB_SEED_FIXTURES` không đặt): `P-a` + `K1` 516/517, `P-a/step0` + `K1 seed` + `P-c` + `P-c2` 295/295. Ca đỏ duy nhất P1-82 (`thread.int`) chập chờn 1/3 lần, không liên quan seed ⇒ TECH-DEBT #192. Test int khoá **không cần** cờ fixture (tự tạo def); e2e P-a đã đặt cờ trong `e2e/P-a/_pa-stack.ts`. Bốn spec Gate lại (P-process-engine, K1, P-c-autofix, P-c2-pr) coi như đạt lại. **Mốc dọn-seed: ĐÓNG.**
