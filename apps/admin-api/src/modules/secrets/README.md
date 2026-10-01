# secrets

FR: ADM-FR-50 (secret Dify: list/tạo/thay giá trị/sửa ghi chú/xoá), ADM-BR-04 (giá trị không rời Admin), ADM-BR-14.
Spec: `docs/specs/M2-catalog-command/spec.md` §3 (`/admin/secrets*`), M2-R01…R06; plan §3.2, §5.

| File | Vai trò |
|---|---|
| `secrets.routes.ts` | `requireAuth` + `requireRole(platform_admin)`; `VALIDATION_ERROR` message tĩnh (G12); `:name` khớp regex nguyên văn |
| `secrets.service.ts` | mã hoá (`lib/secret-crypto`) rồi ghi; khoá `FOR NO KEY UPDATE`; `lockSecretRef` (`FOR SHARE`) cho workflows |
| `secrets.repo.ts` | select **liệt kê cột** (admin_rw không SELECT được `ciphertext`/`iv`); `used_by` = key workflow |
| `secrets.rules.ts` | `secretLast4`, `checkSecretDelete` |

Bẫy: không bao giờ log body/giá trị; request log của `/admin/secrets*` chỉ có path (không query). `deps.secretKey` vắng → POST/PUT 500.
Không có route giải mã ở M2; Hub giải mã theo định dạng plan §3.2 (contract).
