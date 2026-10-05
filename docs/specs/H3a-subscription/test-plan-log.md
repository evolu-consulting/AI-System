# Test plan · H3a-subscription · nhật ký chạy (qc)

Kết quả "đỏ đúng lý do" (`WORKFLOW.md` "Luật khoá test") theo task. Phụ lục của [`test-plan.md`](test-plan.md).

## QW-PU · unit Python thuần `apps/agent-runtime/tests/acceptance/test_quota_rules.py` (P01–P12)

Chạy 2026-10-06 trong WSL (venv `~/.venvs/agent-runtime`, `RUFF_CACHE_DIR=/tmp/rc`), code hiện tại = stub PY-00:
- `ruff check` + `ruff format --check`: sạch · `pyright tests/acceptance/test_quota_rules.py`: 0 lỗi.
- `pytest tests/acceptance/test_quota_rules.py`: **144 ca — 139 đỏ, 5 xanh**.
  - 139 đỏ **đúng lý do**: cả 139 đều `NotImplementedError` từ thân stub `quota_rules` (P01–P10); 0 lỗi dựng dữ liệu / import / `TypeError` / `ValidationError`.
  - 5 xanh trước code (dự kiến): P11 (hằng `COOLDOWN_MAX`, regex type) · P12 ×4 (`mapping.result_signal` H1: 429 thắng chữ auth, 401 ⇒ `logged_out`, chữ usage limit ⇒ `rejected`, `is_error=False` ⇒ `None`).

| ID | Hàm | Số ca | Kết quả hiện tại |
|---|---|---|---|
| P01 | `cooldown_until` | 7 | đỏ `NotImplementedError` |
| P02 | `clean_type` | 10 | đỏ `NotImplementedError` |
| P03 | `clean_util` | 11 | đỏ `NotImplementedError` |
| P04 | `warn_window` | 5 | đỏ `NotImplementedError` |
| P05 | `raw_shape` | 7 | đỏ `NotImplementedError` |
| P06 | `probe_due` | 31 (24 dòng bảng + 6 `probe_s=0` + `db_now`) | đỏ `NotImplementedError` |
| P07 | `auth_logged_in` | 9 | đỏ `NotImplementedError` |
| P08 | `probe_result` | 15 | đỏ `NotImplementedError` |
| P09 | `probe_transition` | 20 | đỏ `NotImplementedError` |
| P10 | `parse_fake_probe` | 24 | đỏ `NotImplementedError` |
| P11 | hằng | 1 | xanh |
| P12 | `mapping.result_signal` | 4 | xanh |

Ghi chú cho PY-01:
- `seen` của `probe_result` trong test là đối tượng vịt (`rate_limit` có `status`, `resets_at`, `rate_limit_type`, `utilization`, `raw_shape`; `usage: UsageEv`) vì `RateLimit` chỉ có trường mới từ PY-02 — thân PY-01 đọc thuộc tính, không `isinstance(RateLimit)`.
- P11 dùng `RATE_TYPE_PATTERN` (tên trong stub PY-00) thay `RATE_TYPE_RE` của `rt §3`; nếu PY-01 thêm `RATE_TYPE_RE` thì vẫn phải giữ `RATE_TYPE_PATTERN`.
- `probe_result` bước (b) trả `step="turn"`; `message` không chép chữ của `final.text`.
- Chưa khoá: Q-PU (`test:lock:write`) là bước riêng.
