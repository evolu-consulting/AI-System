"""CR-114 hub-otel · định dạng log gọn cho agent đọc (`LOG_FORMAT=kv`) — cùng khuôn với hub-api
(`apps/hub-api/src/lib/log-kv.ts`): một dòng `t=<epoch s> lvl=info e=<dotted.event> run=<6 ký tự>
ag=<tên agent đầy đủ> ms=<n> tk=<in>/<out> trace=<8 ký tự> …`. Tên sự kiện là chữ (không mã số);
id rút 6 ký tự (id đầy đủ nằm trong DB); giá trị chỉ số/chữ, chuỗi chỉ đặt trong ngoặc kép khi có
khoảng trắng/`=`/`"`; dòng ≤ 400 ký tự. Che bí mật làm TRƯỚC (processor `redact_processor` trong
`log.py`); hàm ở đây chỉ định dạng.
"""

import json
import math
import re
import time
from collections.abc import Mapping, Sequence
from typing import cast

KV_MAX_LINE = 400
ID_LEN = 6

_ID_ALIASES = {
    "run_id": "run",
    "job_id": "job",
    "tenant_id": "tn",
    "user_id": "usr",
    "request_id": "req",
    "step_id": "step",
    "worker_id": "wk",
}
_AGENT_KEYS = ("agent", "agent_key", "agent_name")
_MS_KEYS = ("ms", "duration_ms", "latency_ms")
_TK_IN = ("input_tokens", "tokens_in", "tk_in")
_TK_OUT = ("output_tokens", "tokens_out", "tk_out")
_EVENT_SEP = re.compile(r"[^a-z0-9.]+")
_KEY_BAD = re.compile(r"[^a-z0-9_.-]")
_NEEDS_QUOTE = re.compile(r'[\s="\\]')
_CTRL = re.compile(r"[\x00-\x1f]")


def event_name(msg: str) -> str:
    """`job.output_retry` / `run started` → `job.output.retry` / `run.started` (≤ 64 ký tự)."""
    e = _EVENT_SEP.sub(".", msg.strip().lower())
    e = re.sub(r"\.{2,}", ".", e).strip(".")
    return e[:64] if e else "log"


def _short(v: object) -> str:
    return str(v)[:ID_LEN]


def _is_num(v: object) -> bool:
    return isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)


def kv_value(v: object) -> str | None:
    """None (bỏ khoá) · số/bool trần · chuỗi trần nếu một từ · còn lại trong ngoặc kép (escape)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int | float):
        return str(v)
    if isinstance(v, str):
        s = v
    elif isinstance(v, list | tuple) and not any(
        isinstance(x, Mapping | list | tuple) for x in cast("Sequence[object]", v)
    ):
        s = ",".join(str(x) for x in cast("Sequence[object]", v))
    else:
        s = json.dumps(v, default=str, separators=(",", ":"), ensure_ascii=False)
    if s and not _NEEDS_QUOTE.search(s) and not _CTRL.search(s):
        return s
    esc = (
        s.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )
    return f'"{_CTRL.sub("", esc)}"'


def _first(d: Mapping[str, object], keys: Sequence[str]) -> object | None:
    for k in keys:
        if d.get(k) is not None:
            return d[k]
    return None


def _last_line(text: str) -> str:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return lines[-1] if lines else ""


def _headline(f: dict[str, object]) -> list[tuple[str, object]]:
    """Rút id/agent/ms/tk khỏi `f` (xoá khỏi `f`), trả theo thứ tự cố định."""
    out: list[tuple[str, object]] = []
    for long, short in _ID_ALIASES.items():
        v = f.pop(long, None)
        if v is not None:
            out.append((short, _short(v)))
    out.append(("ag", _first(f, _AGENT_KEYS)))
    ms = _first(f, _MS_KEYS)
    if _is_num(ms):
        out.append(("ms", round(cast("float", ms))))
    tin, tout = _first(f, _TK_IN), _first(f, _TK_OUT)
    if _is_num(tin) or _is_num(tout):
        out.append(("tk", f"{tin if _is_num(tin) else 0}/{tout if _is_num(tout) else 0}"))
    for k in (*_AGENT_KEYS, *_MS_KEYS, *_TK_IN, *_TK_OUT, "ts", "timestamp"):
        f.pop(k, None)
    return out


def _rest_value(k: str, v: object) -> object:
    if k == "exception" and isinstance(v, str):
        return _last_line(v)  # chỉ dòng lỗi cuối, không cả traceback
    return _short(v) if k.endswith("_id") and v else v


def format_kv(
    event_dict: Mapping[str, object],
    *,
    level: str | None = None,
    trace: str | None = None,
    now: float | None = None,
) -> str:
    """`event_dict` đã che bí mật. `tk`/`ms`/id/agent rút ra trước; phần còn lại `key=value`."""
    f = dict(event_dict)
    lvl = level or str(f.pop("level", "info"))
    f.pop("level", None)
    msg = str(f.pop("event", ""))
    pairs: list[tuple[str, object]] = [
        ("t", int(now if now is not None else time.time())),
        ("lvl", lvl),
        ("e", event_name(msg)),
        *_headline(f),
        ("trace", trace[:8] if trace else None),
        *((_KEY_BAD.sub("_", k.lower()), _rest_value(k, v)) for k, v in f.items()),
    ]
    parts = [f"{k}={s}" for k, v in pairs if (s := kv_value(v)) is not None]
    line = " ".join(parts)
    return f"{line[: KV_MAX_LINE - 1]}~" if len(line) > KV_MAX_LINE else line
