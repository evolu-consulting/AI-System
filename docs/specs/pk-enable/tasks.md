# Lát pk-enable — UAT CR-095 B3 + B4 (bật gói cho tenant)

Nguồn: `docs/uat/cr095/report.md` (B3, B4). Spec: N1 [D-05](../N1-pack-frame/spec-decisions.md) — bật gói = route admin-api **chỉ platform_admin**.

| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | B4 · int test trước: tenant mới + bật gói ⇒ owner dùng được trợ lý; tenant khác không có gì; agent seed sau ⇒ bù | đầy đủ (quyền/tenant) | xong — `tests/acceptance/N1/pack-assistant.int.test.ts` |
| 2 | B4 · `packs.pack_agents` + `packs.grant_agents(k, tenants[], actor)` SECURITY DEFINER (`migrations-packs/0005`); contracts → `mgmt-assistant` (`migrations-pack-contracts/0021`) | đầy đủ | xong |
| 3 | B4 · gọi trong tx bật gói: `PUT /admin/tenants/:id/packs/:k` + identity-import (tenant mới); NOTIFY `hub_config_changed` trong tx; `hub:seed` gọi bù cho mọi tenant đã bật | đầy đủ | xong |
| 4 | B3 · admin-web tab "Gói" ở chi tiết tenant (platform_admin): bật PUT / tắt hỏi xác nhận DELETE; contracts-web câu "chưa bật gói" trỏ đơn vị vận hành | nhanh | xong — e2e `e2e/tenant-packs.spec.ts`, unit `tenant-packs.test.ts`, `PackGate.test.tsx` |

## Quyết định trong lúc làm
- B3: D-05 ⇒ chỉ platform_admin bật gói. Màn ở admin-web cho platform_admin; contracts-web bảo nhờ quản trị viên công ty liên hệ đơn vị vận hành. Không mở API cho tenant_admin.
- B4: admin-api không có quyền ghi bảng `hub` (D-03) ⇒ hàm SECURITY DEFINER, admin_api chỉ EXECUTE. Khoá `hub.config_meta` trước khi ghi hub (cùng chiều agent-grants/seed); hub tx không khoá bảng admin ⇒ không vòng khoá.
- B4: entitlement `ON CONFLICT DO NOTHING` — không bỏ `revoked_at` platform_admin đã đặt cho agent. Tắt gói KHÔNG thu hồi entitlement/grant trợ lý (như Group/grant gói được giữ); tool của trợ lý vẫn chặn theo `PACK_DISABLED`.
- B4: không ghi `hub.audit_log` riêng; audit `pack.enable` của admin đã ghi việc bật gói.
- e2e màn Gói: DB e2e gốc không chạy migration gói ⇒ giả `/admin/tenants/:id/packs*` bằng `page.route`; hành vi API phủ ở int N1.
- `access.yaml` giữ nguyên (grant `contracts-*` của acme trùng, vô hại; `seed.test.ts` khoá nội dung).

## Việc còn lại
- qc ghi `tests/.lock` cho test mới dưới `tests/**`, `e2e/**`.
