# autofix — Runtime tự-sửa mã P-c1 (WRK-FR-28, WRK-FR-29, WRK-BR-08; HUB-FR-126/127/128)

Job `agent.cli` có `payload.autofix`: dựng workspace ghi được, chạy agent với 4 tool `ws_*` TRONG container, kiểm diff bằng chương trình, báo kết quả về Hub (`POST /internal/jobs/:id/autofix-result`). Spec: `docs/specs/P-c-autofix/`, ADR-0011.

| File | Vai trò |
|---|---|
| `host.py` | `AutofixHost`/`AutofixJobRun`: vòng đời job (trước agent → agent → kiểm + báo cáo → dọn) |
| `prep.py` | pha trước agent (`AutofixCfg`, `Box`): sao snapshot, pha cài, base_patch |
| `workspace.py` | `prepare`/`copy_workspace`/`init_git`: bản sao ghi được, git cứng ngoài mount, nhánh `ai/<run>/<stage>`, `hand_over`, `rmtree_ro` |
| `check.py` + `gitscan.py` | kiểm diff theo thứ tự: đường dẫn → kích thước → bí mật (quét NỘI DUNG blob) → test |
| `report.py` | dựng `AutofixReport`, che bí mật, POST có retry |
| `oci.py` / `fake_oci.py` | gọi docker/podman (mảng đối số, không shell) · giả lập `RUNTIME_SANDBOX=fake` (chỉ `APP_ENV=test`) |
| `ws_tools.py` | MCP `ws_exec/read/write/edit` chạy trong job con, `exec` vào container |
| `rules.py` | luật thuần (argv, allowlist, trần, mẫu bí mật, `git_env`, env sandbox) |
| `sweeper.py` | xoá container `aif-*` mồ côi (mỗi 300 s) |

Ảnh: `apps/agent-runtime/sandbox-image/` (`bun run sandbox:image`). Test: `test_*.py` cạnh code, `tests/acceptance/pc/` (khoá), `bun run test:pc:sandbox` (Docker thật).
Phụ thuộc: `sources/` (snapshot `caps=autofix`), `queue/` (slot `RUNTIME_SANDBOX_MAX`), `sandbox/` (hook nhãn `workspace`), `providers/{claude,fake}/ws.py`.

Bẫy:
- Không container (`RUNTIME_SANDBOX=off`/ảnh thiếu/uid ∉ {0,1000}) ⇒ job `failed/container` ⇒ Hub `sandbox_unavailable`.
- Pha cài chạy script của repo với mạng (`aif-prep`) — cần tường lửa host (PRODUCTION-NOTES P-c1).
- git chạy NGOÀI container, env cứng; không đọc `.gitattributes` của repo (ghi `info/attributes`).
- `rmtree_ro` cần `/proc` (Linux). `ensure_schema` không tự migrate DB test cũ (áp tay `0031`).
