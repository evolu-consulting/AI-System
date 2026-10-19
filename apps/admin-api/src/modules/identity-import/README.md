# identity-import — chuyển user mgmt-app sang admin-api (N5)

FR: N5-FR-01…07, N5-NFR-01/02 (`docs/specs/N5-identity/spec.md`). ADR-0018 §1–2.

- Điểm vào: `identity-import.cli.ts` (CLI admin chạy một lần, dry-run mặc định, `--apply` để ghi); `identity-import.run.ts`
  (`runIdentityImport(db, raw, opts)` — test int dùng).
- Lớp: `domain/` (luật thuần: hash, slug, username, plan org/user) · `application/` (use case + port `ImportStore`) ·
  `adapters/` (zod file, SQL theo tập, tx `withConfigWrite` scope platform).
- Phụ thuộc: `packs/packs.rules` (Group/grant gói `contracts`), `lib/audit`, `lib/config` (NOTIFY sau commit).
- Mật khẩu: argon2id đủ mạnh ⇒ nhập hash; scrypt mgmt-app (`scrypt$<salt>$<dk>`) ⇒ lưu `$scrypt-legacy$…`, login
  verify rồi rehash argon2id (N5b, `auth.legacy.ts`, tới sunset); còn lại ⇒ hash không dùng được +
  `must_change_password` + audit `summary.reset_required` (N3 gửi link). Không log/báo cáo hash.
- Test: `domain/import.rules.test.ts`, `tests/acceptance/N5/**` (int + perf 10.000 user).
