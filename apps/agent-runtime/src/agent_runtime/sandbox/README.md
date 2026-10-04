# sandbox/ — cách ly job host (plan-runtime §5, WRK-BR-02, WRK-BR-07)

| File | Nội dung |
|---|---|
| `paths.py` | luật thuần: đường dẫn sau `realpath` phải nằm trong `work/<job_id>/`; nhãn `home`/`other_job`/… |
| `hook.py` | hook `PreToolUse` (dict đúng hình SDK): chặn tool ngoài danh sách + đường dẫn; `glob`/`pattern` chứa `..` hoặc `{` → deny (fail-closed; spike PY-02: Glob có mở rộng brace/lớp ký tự); `StructuredOutput` chỉ cho job agent (S2) |
| `env.py` | env tường minh của job host (danh sách trắng, không secret) |
| `process.py` | giết group + cây `ppid` (SIGTERM → SIGKILL → quét `/proc`), subreaper, thu zombie mồ côi, `PR_SET_DUMPABLE=0` ở cha |

Chỉ nhắm Linux. Không import `config`/`db`/`events` (import-linter).
