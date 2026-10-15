# Hướng dẫn test Autofix → PR GitHub thật (P‑c2 S1)

Test luồng đầy đủ Process Engine: **đọc source → chẩn đoán → vá → chạy test → review (gate người) → áp → mở Pull Request trên GitHub**. Nguồn: [`docs/specs/P-c2-pr/spec.md`](../specs/P-c2-pr/spec.md), [`docs/specs/P-c-autofix/spec.md`](../specs/P-c-autofix/spec.md), [ADR‑0011](../adr/0011-write-exec-sandbox.md). Lệnh chạy ở gốc repo.

> **Trạng thái:** luồng đã build + **đạt end‑to‑end qua mock GitHub + bare repo** (P‑c2 D1/D2/D3 APPROVED, SAFE). Chạy với **GitHub thật = S1, hard stop**: cần repo thử + PAT **của bạn**; tạo PR thật là side‑effect ra ngoài + secret thật ⇒ **bạn tự chạy**, tôi không tạo hộ. Vòng nền advance bước apply đã có sẵn trong `server.ts` (B2 đã vá) — **không cần shim**.

---

## 0. Không có gì hardcode

| Thành phần | Nơi cấu hình |
|---|---|
| Endpoint GitHub (`apiUrl`/`webHost`) | **Env** `HUB_GITHUB_API_URL` (mặc định prod `https://api.github.com`) + `HUB_GITHUB_WEB_HOST` (`github.com`). Vắng ⇒ **không mở PR** (fail‑closed) |
| Repo cần sửa + `apply_mode` | **DB theo tenant** — nguồn `git_remote` ở Admin `/admin/sources` |
| PAT (push + PR) | **Secret `source_credential`** (mã hoá bằng `HUB_SECRETS_KEY`) ở `/admin/source-credentials`; code chỉ giữ `credential_secret_id` |
| Nhánh đẩy | Sinh lúc chạy `ai/<run>/<stage>` (regex `AUTOFIX_BRANCH_RE`), không gắn repo |

---

## 1. Chuẩn bị phía GitHub (bạn làm)

1. **Repo thử** (riêng tư hoặc công khai) có sẵn một **bug + test bắt được bug** — ví dụ `src/calc.ts` có `add` trả `a - b`, `test/calc.test.ts` kỳ vọng `add(2,3)===5`. (Giống fixture UAT.)
2. **PAT fine‑grained** giới hạn **đúng repo đó**, quyền tối thiểu: **Contents: Read and write** + **Pull requests: Read and write**. (Không cần quyền khác.)
3. Nếu dùng `apply_mode=auto_merge`: bật **Allow auto‑merge** + branch protection/required checks trong Settings repo (việc merge do GitHub quyết, Hub không tự merge).

---

## 2. Chuẩn bị phía máy (sandbox cho bước vá/test)

Bước `fix` chạy agent sửa code **trong sandbox container** rồi `bun test`. Cần runtime sandbox (P‑c1):
- Dev nhanh: Docker Desktop đang chạy (Runtime giữ socket — chỉ dev).
- Dựng ảnh sandbox một lần: `bun run sandbox:image` (ảnh `ai-autofix-sandbox`, ~474 MB).
- Chi tiết prod (Podman rootless/WSL2, cgroup delegate, AVX2): xem [PRODUCTION‑NOTES](../PRODUCTION-NOTES.md) mục P‑c1.

Thiếu sandbox ⇒ bước `fix` báo lỗi sandbox (job `orphaned`), không tới được bước apply.

---

## 3. Config Hub (`.env.local`, không commit)

```
HUB_PROCESS_ENGINE=on
HUB_SEED_PROFILE=claude-sub-1          # agent THẬT để tạo patch thật (fake không sửa được code)
HUB_GITHUB_API_URL=https://api.github.com
HUB_GITHUB_WEB_HOST=github.com
# HUB_SECRETS_KEY đã có sẵn (keys:dev). Mất khoá = mất mọi PAT đã lưu.
```
Khởi động lại để nạp env + reseed:
```
./start.sh --kill-orphan
```
`./start.sh` bật Agent Runtime (WSL) — cần `claude` CLI đã đăng nhập trong WSL (script tự kiểm).

**Egress cần mở:** Hub → `api.github.com:443`; Agent Runtime → `github.com:443` (push git). TLS bắt buộc, Hub không theo redirect.

---

## 4. Config trong Admin (đăng nhập `tenant_admin`, vd `julian.bui` / evolu)

1. **Tạo khoá nguồn (PAT)** — admin‑web `/sources` → *Tạo khoá mới* (route `/admin/source-credentials`):
   - Dán PAT ở mục 1. Token **chỉ‑ghi** (lưu mã hoá, không xem lại được).
2. **Tạo nguồn `git_remote`** — admin‑web `/sources` → *Thêm nguồn*:
   - URL = HTTPS repo của bạn (`https://github.com/<org>/<repo>.git`).
   - Khoá nguồn = PAT vừa tạo.
   - **Chế độ áp** = `pr` (hoặc `auto_merge` nếu đã bật ở GitHub). `branch_only` chỉ đẩy nhánh, không mở PR.
   - *Kiểm tra kết nối* để chắc PAT/URL đúng (lỗi `SOURCE_CREDENTIAL_INVALID`/`SOURCE_UNRESOLVABLE` nếu sai).
3. **Bật tiến trình có bước apply** — mẫu `fixbug-pr` **tắt sẵn** trong seed. Trong `/processes`:
   - Chép `fixbug-pr` vào tenant, trỏ nguồn `repo` của nó sang **nguồn git_remote** vừa tạo, rồi **bật** (enabled).
   - Cấu trúc: bước `fix` (`sources:[repo]`, `autofix` với `test_cmd: "bun test"`) → review (gate người) → bước `apply` (`kind: apply`, `real_action`).

---

## 5. Chạy test

Trong một phòng, gõ lệnh với key tiến trình vừa bật (vd `fixbug-pr`):
```
!fixbug-pr add() trong src/calc.ts trả sai dấu, test add(2,3) kỳ vọng 5
```
Diễn tiến:
1. **Bước `fix`** — agent thật clone/fetch mirror repo (riêng tư thì dùng PAT qua kênh nội bộ), đọc source, sửa trong `/workspace` (`ws_*`), chạy `bun test` tới khi xanh → trả **diff đã kiểm**.
2. **Gate review** — bạn xem diff trong luồng run, bấm **Đạt**.
3. **Bước `apply`** (vòng nền tự chạy) — đẩy nhánh `ai/<run>/apply` lên repo bằng PAT, mở **PR** → lưu `pr_url` (chỉ nhận `https://` host `github.com`).
4. Mở `pr_url` → thấy PR thật trên GitHub, nhánh `ai/<run>/…`, diff đúng bản vá.

✅ **S1 đạt:** PR mở được trên github.com thật, diff đúng, không lộ token (log/PR/audit đều che). Báo tôi kết quả để đóng mốc **P‑c2 (`done`)**.

---

## 6. Sự cố thường gặp

| Triệu chứng (ApplyReport / error_code) | Nguyên nhân | Xử lý |
|---|---|---|
| Bước apply `provider_error`, không PR | Thiếu `HUB_GITHUB_API_URL`/`HUB_GITHUB_WEB_HOST`, hoặc egress Hub→api.github.com bị chặn | Set đủ 2 env + mở egress; khởi động lại |
| `auth` | PAT sai/hết hạn/thiếu quyền, hoặc không thấy repo | PAT phải Contents RW + Pull requests RW **đúng repo** (Hub không phân biệt "không quyền" vs "không thấy" để tránh dò) |
| `rate_limited` | GitHub giới hạn tần suất | Chờ rồi chạy lại (Hub tự thử lại 1 lần nếu `retry‑after` ≤ 60 s) |
| 422 `SOURCE_APPLY_UNSUPPORTED` khi lưu nguồn | `apply_mode=pr/auto_merge` nhưng host không hỗ trợ (chỉ `github.com` ở P‑c2) | Dùng `github.com` hoặc đặt `branch_only` |
| `pr_url` null + `provider_error` | PR trả host ≠ `HUB_GITHUB_WEB_HOST` | Kiểm `HUB_GITHUB_WEB_HOST=github.com` |
| `conflict{files}` | Nhánh mặc định đã đổi, 3‑way apply xung đột | Chạy lại (có rebase E4) hoặc sửa thủ công |
| Bước `fix` lỗi sandbox / `orphaned` | Chưa dựng ảnh sandbox hoặc Docker/Podman chưa sẵn | `bun run sandbox:image`; xem PRODUCTION‑NOTES P‑c1 |
| Agent báo "cần quyền truy cập repo" | Nguồn `repo` chưa trỏ đúng git_remote (chạy không có sources) | Kiểm bước 4.3 — `repo` phải trỏ nguồn đã cấu hình |

**Log Hub:** `.data/logs/combine.log` — lọc `apply`, `source`, `provider`, `process-sweep`. Token luôn bị che (`Authorization`).

---

## 7. Ranh giới bảo mật (giữ nguyên)

- PAT **chỉ** đi: bảng secrets (mã hoá) → kênh nội bộ Hub→Runtime (token theo job) → env `GIT_CONFIG_*` của tiến trình git. **Không** vào payload job / `work/<job>/` / container / log / PR / audit.
- Hub **chỉ** gọi ra `HUB_GITHUB_API_URL`; Runtime **chỉ** push `github.com`. Không mở egress khác.
- Đẩy **chỉ** nhánh `ai/<run>/<stage>` — không bao giờ đẩy/cưỡng bức nhánh mặc định. Bảo vệ nhánh ở GitHub là lớp chặn cuối.
- Repo riêng: mirror riêng theo `source_id`, kênh khoá chỉ trả cho job cùng tenant.
