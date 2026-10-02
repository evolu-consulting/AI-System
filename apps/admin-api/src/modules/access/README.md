# access

FR: ADM-FR-36 (Kiểm tra quyền / Quyền hiệu lực), ADM-BR-11, ADM-BR-12, ADM-FR-24 (phần group/grant của "Ai dùng được"). Spec: `docs/specs/M3-permissions/spec.md` §3 "Kiểm tra quyền", plan §3.2, §4, §5.6.

- Điểm vào: `access.routes.ts` (`GET /admin/users/:id/effective-access`, mount trước router users).
- `access.rules.ts`: `computeEffectiveAccess` (hàm thuần, chuẩn tham chiếu); `access.repo.ts`: SQL đọc (+ `visibleUserCounts` = SQL tham chiếu của Hub); `access.service.ts`: ghép + map contract, xuất `commandTenantExtras` cho module commands.
- Chỉ đọc, không khoá, không bump. Agent: `{available: false}` tới M5.
- Phụ thuộc: `users.rules` (`canSeeUser`, `Actor`), `@ai/db` (`readConfigVersion`).
