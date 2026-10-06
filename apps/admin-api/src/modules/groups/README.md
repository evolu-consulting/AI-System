# groups

FR: ADM-FR-62 (group + thành viên), ADM-FR-55 (`version`/409), ADM-BR-09 (cách ly tenant). Spec: `docs/specs/M3-permissions/spec.md` §3 "Groups", plan §5.4.

- Điểm vào: `groups.routes.ts` (`/admin/groups*`, platform_admin + tenant_admin).
- `groups.service.ts`: list/get/tạo/PATCH/xoá; `groups.members.ts`: list/thêm từng phần (+ `dry_run`)/bớt thành viên; `groups.rules.ts`: hàm thuần (beta-testers, `changedGroupFields`, `planMemberAdd`); `groups.repo.ts`: SQL (lọc `tenant_id` + RLS).
- Ghi qua `lib/config/config-write.ts` (bump `config_version` + NOTIFY `config_changed` sau commit, entity `group`).
- Khoá (plan §6 hạng 3–4): PATCH/DELETE group `FOR NO KEY UPDATE`; thành viên giữ group `FOR SHARE` rồi chèn theo `user_id` tăng.
- `beta-testers` do trigger DB tạo cùng mọi tenant (migration `0006`); xoá → 409 `BETA_GROUP_PROTECTED`.
- Phụ thuộc: `users.rules` (`resolveTenantScope`, `Actor`). Users hiển thị `groups[]` bằng SQL riêng ở `users.repo`.
- X1 `groups.hub.ts`: `agent_count` (list + detail) đọc `hub.agent_grants` nếu role có quyền SELECT, không thì 0 (ADM-FR-37).
