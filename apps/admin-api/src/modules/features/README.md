# features

FR: ADM-FR-30 (CRUD feature, key bất biến), ADM-FR-31 (entitlement tenant), ADM-FR-33 (kill switch = `status`), ADM-FR-34 (beta), BR-10, BR-12.
Spec: `docs/specs/M2-catalog-command/spec.md` §3 (`/admin/features*`), M2-R19…R22, R24, R25; plan §5, §5.1.

| File | Vai trò |
|---|---|
| `features.routes.ts` | `requireAuth` + `requireRole(platform_admin)`; parse contract → service |
| `features.service.ts` | CRUD; khoá commands (id tăng) → feature `FOR NO KEY UPDATE`; xuất `coreFeatureId`, `setCommandFeatures`, `featureRefsByCommands`, `bumpFeaturesOfCommand`, `missingFeatureIds` cho commands |
| `features.entitlements.ts` | list/cấp/thu hồi (`revoked_at`, giữ hàng); feature `FOR SHARE` |
| `features.members.ts` | ghi `feature_commands` hai chiều + bump `version` bên kia (module này sở hữu bảng) |
| `features.repo.ts` | list/detail/đếm (subquery, không N+1), entitlement upsert |
| `features.rules.ts` | `core` bảo vệ, mồ côi, diff, `changedFeatureFields` |

Bẫy: `core` không có hàng entitlement (tự hiệu lực). Xoá feature không tăng version command. `testHooks.afterLock` ("feature.save" / "feature.delete") chỉ có khi `appEnv=test`.
